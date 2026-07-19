"""Durable transactional domain events relayed to Redis Streams.

Writers append to a PostgreSQL outbox in their own transaction. The relay
publishes committed events idempotently and the projector isolates poison
messages in a Redis dead-letter stream.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from crate.config import get_durable_redis_url
from crate.db.domain_event_outbox import enqueue_outbox_event, persist_standalone_event

log = logging.getLogger(__name__)

_STREAM_KEY = "crate:domain_events"
_GROUP_NAME = "projector"
_SEQ_COUNTER_KEY = "crate:domain_events:seq"
_ATTEMPTS_KEY = "crate:domain_events:attempts"
_DEAD_LETTER_KEY = "crate:domain_events:dead_letter"
_MAX_LEN = 50000
_BLOCK_MS = 1000

_redis_client: Any | None = None
_group_created = False


def _get_redis() -> Any | None:
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis as _redis

        _redis_client = _redis.from_url(
            get_durable_redis_url(),
            decode_responses=True,
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        _redis_client.ping()
    except Exception:
        _redis_client = None
    return _redis_client


def _ensure_consumer_group() -> bool:
    global _group_created
    if _group_created:
        return True

    r = _get_redis()
    if not r:
        return False

    try:
        r.xgroup_create(_STREAM_KEY, _GROUP_NAME, id="0", mkstream=True)
        _group_created = True
    except Exception as exc:
        if "BUSYGROUP" in str(exc):
            _group_created = True
        else:
            log.debug("Could not create domain-event consumer group", exc_info=True)
            return False
    return True


def _publish_domain_event(
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    scope: str | None = None,
    subject_key: str | None = None,
) -> int:
    r = _get_redis()
    if not r:
        return 0
    try:
        r.xadd(
            _STREAM_KEY,
            {
                "event_type": event_type,
                "scope": scope or "",
                "subject_key": subject_key or "",
                "payload_json": json.dumps(payload or {}, default=str),
            },
            maxlen=_MAX_LEN,
            approximate=True,
        )
        return int(r.incr(_SEQ_COUNTER_KEY))
    except Exception:
        log.debug("Failed to append domain event %s", event_type, exc_info=True)
        return 0


def append_domain_event(
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    scope: str | None = None,
    subject_key: str | None = None,
    session=None,
) -> int:
    """Persist a domain event durably in the current or a short transaction."""

    if session is not None:
        enqueue_outbox_event(
            event_type,
            payload,
            scope=scope,
            subject_key=subject_key,
            session=session,
        )
        return 0
    persist_standalone_event(
        event_type,
        payload,
        scope=scope,
        subject_key=subject_key,
    )
    return 0


_OUTBOX_PUBLISH_LUA = """
local existing = redis.call('GET', KEYS[1])
if existing then
    local separator = string.find(existing, '|')
    if separator then
        return {string.sub(existing, 1, separator - 1), string.sub(existing, separator + 1), '0'}
    end
end
local stream_id = redis.call(
    'XADD', KEYS[2], 'MAXLEN', '~', ARGV[1], '*',
    'event_uid', ARGV[2],
    'event_type', ARGV[3],
    'scope', ARGV[4],
    'subject_key', ARGV[5],
    'payload_json', ARGV[6]
)
local sequence = redis.call('INCR', KEYS[3])
redis.call('SET', KEYS[1], stream_id .. '|' .. sequence, 'EX', ARGV[7])
return {stream_id, tostring(sequence), '1'}
"""


def publish_outbox_event(event: dict[str, Any]) -> tuple[str, int]:
    r = _get_redis()
    if not r:
        raise RuntimeError("Redis is unavailable")
    event_uid = str(event["event_uid"])
    payload = event.get("payload_json") or {}
    payload_json = (
        payload if isinstance(payload, str) else json.dumps(payload, default=str)
    )
    result = r.eval(
        _OUTBOX_PUBLISH_LUA,
        3,
        f"crate:domain_events:published:{event_uid}",
        _STREAM_KEY,
        _SEQ_COUNTER_KEY,
        str(_MAX_LEN),
        event_uid,
        str(event.get("event_type") or ""),
        str(event.get("scope") or ""),
        str(event.get("subject_key") or ""),
        payload_json,
        str(7 * 24 * 60 * 60),
    )
    if not result or len(result) < 2:
        raise RuntimeError("Redis outbox publish returned no stream id")
    return str(result[0]), int(result[1])


def get_latest_domain_event_id(
    *, scope: str | None = None, subject_key: str | None = None
) -> int:
    """Return the latest monotonic sequence used for snapshot versioning."""

    del scope, subject_key
    r = _get_redis()
    if not r:
        return 0
    try:
        value = r.get(_SEQ_COUNTER_KEY)
        return int(value) if value else 0
    except Exception:
        return 0


def _decode_stream_messages(
    messages: list[tuple[str, dict[str, Any]]],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for msg_id, fields in messages:
        payload_raw = fields.get("payload_json", "{}")
        try:
            payload = json.loads(payload_raw)
        except (json.JSONDecodeError, TypeError):
            payload = {}
        result.append(
            {
                "id": msg_id,
                "event_uid": fields.get("event_uid", ""),
                "event_type": fields.get("event_type", ""),
                "scope": fields.get("scope", ""),
                "subject_key": fields.get("subject_key", ""),
                "payload_json": payload,
            }
        )
    return result


def list_domain_events(
    *,
    limit: int = 100,
    unprocessed_only: bool = True,
    consumer_name: str = "worker",
    block_ms: int = _BLOCK_MS,
) -> list[dict[str, Any]]:
    """Read domain events from Redis Streams.

    ``unprocessed_only=True`` uses a consumer group. It first retries
    this consumer's pending messages (`id="0"`) so projector crashes do
    not strand events forever, then falls back to new messages (`id=">"`).
    """

    r = _get_redis()
    if not r:
        return []

    count = max(1, min(limit, 1000))

    try:
        if not unprocessed_only:
            return _decode_stream_messages(r.xrange(_STREAM_KEY, "-", "+", count=count))

        if not _ensure_consumer_group():
            return []

        entries = r.xreadgroup(
            _GROUP_NAME,
            consumer_name,
            {_STREAM_KEY: "0"},
            count=count,
        )
        if not entries:
            entries = r.xreadgroup(
                _GROUP_NAME,
                consumer_name,
                {_STREAM_KEY: ">"},
                count=count,
                block=max(0, int(block_ms)),
            )
    except Exception:
        log.debug("Failed to read domain events from stream", exc_info=True)
        return []

    if not entries:
        return []

    messages: list[tuple[str, dict[str, Any]]] = []
    for _stream_name, stream_messages in entries:
        messages.extend(stream_messages)
    return _decode_stream_messages(messages)


def get_domain_event_runtime(*, limit: int = 10) -> dict[str, Any]:
    """Return Redis stream diagnostics for the domain-event bus."""

    safe_limit = max(1, min(int(limit or 10), 50))
    runtime: dict[str, Any] = {
        "redis_connected": False,
        "stream_key": _STREAM_KEY,
        "consumer_group": _GROUP_NAME,
        "latest_sequence": get_latest_domain_event_id(),
        "stream_length": 0,
        "dead_letter": 0,
        "pending": 0,
        "consumers": 0,
        "lag": 0,
        "last_delivered_id": None,
        "recent_events": [],
    }

    r = _get_redis()
    if not r:
        return runtime

    runtime["redis_connected"] = True

    try:
        runtime["stream_length"] = int(r.xlen(_STREAM_KEY) or 0)
    except Exception:
        log.debug("Failed to inspect domain-event stream length", exc_info=True)

    try:
        runtime["dead_letter"] = int(r.xlen(_DEAD_LETTER_KEY) or 0)
    except Exception:
        log.debug("Failed to inspect domain-event dead-letter length", exc_info=True)

    try:
        groups = r.xinfo_groups(_STREAM_KEY) or []
        group = next((item for item in groups if item.get("name") == _GROUP_NAME), None)
        if group:
            runtime["pending"] = int(group.get("pending", 0) or 0)
            runtime["consumers"] = int(group.get("consumers", 0) or 0)
            lag = group.get("lag")
            runtime["lag"] = int(lag) if lag not in (None, "") else 0
            runtime["last_delivered_id"] = group.get("last-delivered-id") or group.get(
                "last_delivered_id"
            )
    except Exception:
        log.debug("Failed to inspect domain-event consumer group", exc_info=True)

    try:
        recent = r.xrevrange(_STREAM_KEY, "+", "-", count=safe_limit)
        runtime["recent_events"] = _decode_stream_messages(recent)
    except Exception:
        log.debug("Failed to inspect recent domain events", exc_info=True)

    return runtime


def mark_domain_events_processed(event_ids: list, *, session=None) -> None:
    """Acknowledge processed events in the consumer group."""

    del session
    cleaned = [str(event_id) for event_id in event_ids if event_id]
    if not cleaned:
        return

    r = _get_redis()
    if not r or not _ensure_consumer_group():
        return

    try:
        r.xack(_STREAM_KEY, _GROUP_NAME, *cleaned)
    except Exception:
        log.debug("Failed to ack domain events", exc_info=True)


def mark_domain_event_failed(
    event: dict[str, Any],
    error: str | Exception,
    *,
    max_attempts: int = 5,
) -> int:
    """Record a projection failure and isolate poison messages in a DLQ."""
    event_id = str(event.get("id") or "")
    if not event_id:
        return 0
    r = _get_redis()
    if not r or not _ensure_consumer_group():
        return 0
    try:
        attempts = int(r.hincrby(_ATTEMPTS_KEY, event_id, 1))
        if attempts < max(1, int(max_attempts)):
            return attempts
        payload = event.get("payload_json") or {}
        r.xadd(
            _DEAD_LETTER_KEY,
            {
                "original_id": event_id,
                "event_uid": str(event.get("event_uid") or ""),
                "event_type": str(event.get("event_type") or ""),
                "scope": str(event.get("scope") or ""),
                "subject_key": str(event.get("subject_key") or ""),
                "payload_json": json.dumps(payload, default=str),
                "attempts": str(attempts),
                "last_error": str(error)[:4000],
            },
            maxlen=10000,
            approximate=True,
        )
        r.xack(_STREAM_KEY, _GROUP_NAME, event_id)
        r.hdel(_ATTEMPTS_KEY, event_id)
        return attempts
    except Exception:
        log.debug("Failed to record domain-event projection failure", exc_info=True)
        return 0


__all__ = [
    "append_domain_event",
    "get_domain_event_runtime",
    "get_latest_domain_event_id",
    "list_domain_events",
    "mark_domain_event_failed",
    "mark_domain_events_processed",
    "publish_outbox_event",
]
