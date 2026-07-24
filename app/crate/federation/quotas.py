"""Streaming quotas — Redis-backed active slot accounting and daily byte tracking.

Phase 3C: per-peer and per-subject limits with manual Admin controls.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from crate.federation.quota_scripts import (
    ACQUIRE_SLOT_LUA,
    RECONCILE_BYTES_LUA,
    RELEASE_SLOT_LUA,
    RESERVE_BYTES_LUA,
)

log = logging.getLogger(__name__)


def _observe_quota_denial(node_uid: str, subject_hash: str | None, reason: str) -> None:
    from crate.federation.abuse import observe_risk_signal

    observe_risk_signal(
        "quota_denial",
        peer_node_uid=node_uid,
        subject_hash=subject_hash,
        severity="low",
        reason_code=reason,
    )


# ── Redis key prefixes ────────────────────────────────────────────────────

SLOTS_PREFIX = "federation:slots"
BYTES_PREFIX = "federation:bytes"
REFCOUNT_PREFIX = "federation:slot_refs"

# ── Default limits ────────────────────────────────────────────────────────

DEFAULT_MAX_STREAMS_PER_PEER = 2
DEFAULT_MAX_STREAMS_PER_SUBJECT = 1
DEFAULT_DAILY_BYTES_PER_PEER = 2_000_000_000  # 2 GB
DEFAULT_DAILY_BYTES_PER_SUBJECT = 1_000_000_000  # 1 GB


# ── Slot accounting ───────────────────────────────────────────────────────


def _slots_key(node_uid: str) -> str:
    return f"{SLOTS_PREFIX}:{{{node_uid}}}:peer"


def _subject_slots_key(node_uid: str, subject_hash: str) -> str:
    return f"{SLOTS_PREFIX}:{{{node_uid}}}:subject:{subject_hash}"


def _refcount_key(node_uid: str, stream_id: str) -> str:
    return f"{REFCOUNT_PREFIX}:{{{node_uid}}}:{stream_id}"


def acquire_stream_slot(
    redis_client,
    node_uid: str,
    subject_hash: str | None = None,
    max_peer_slots: int = DEFAULT_MAX_STREAMS_PER_PEER,
    max_subject_slots: int = DEFAULT_MAX_STREAMS_PER_SUBJECT,
    logical_stream_key: str | None = None,
) -> tuple[bool, str | None, str | None]:
    """Try to acquire an active stream slot. Returns (allowed, denial_reason, stream_id)."""
    stream_id = (
        f"logical:{logical_stream_key}"
        if logical_stream_key
        else f"{node_uid}:{int(time.time() * 1000)}:{__import__('secrets').token_hex(4)}"
    )
    ref_key = _refcount_key(node_uid, stream_id) if logical_stream_key else None
    eval_method = getattr(redis_client, "eval", None)
    if callable(eval_method):
        now_ms = int(time.time() * 1000)
        ttl_ms = 60 * 60 * 1000
        result = eval_method(
            ACQUIRE_SLOT_LUA,
            2,
            _slots_key(node_uid),
            _subject_slots_key(node_uid, subject_hash or "anonymous"),
            now_ms,
            now_ms + ttl_ms,
            stream_id,
            max_peer_slots,
            max_subject_slots,
            ttl_ms,
        )
        if isinstance(result, (list, tuple)) and len(result) >= 2:
            allowed = bool(int(result[0]))
            reason = result[1]
            if isinstance(reason, bytes):
                reason = reason.decode("utf-8", errors="replace")
            outcome = (True, None, stream_id) if allowed else (False, str(reason), None)
            if not allowed:
                _observe_quota_denial(node_uid, subject_hash, str(reason))
            return outcome
    if ref_key and int(redis_client.get(ref_key) or 0) > 0:
        redis_client.incr(ref_key)
        redis_client.expire(ref_key, 3600)
        return True, None, stream_id

    peer_key = _slots_key(node_uid)
    peer_count = redis_client.scard(peer_key)
    if peer_count >= max_peer_slots:
        _observe_quota_denial(node_uid, subject_hash, "peer_stream_limit")
        return False, "peer_stream_limit", None

    if subject_hash:
        subject_key = _subject_slots_key(node_uid, subject_hash)
        subject_count = redis_client.scard(subject_key)
        if subject_count >= max_subject_slots:
            _observe_quota_denial(node_uid, subject_hash, "subject_stream_limit")
            return False, "subject_stream_limit", None

    redis_client.sadd(peer_key, stream_id)
    redis_client.expire(peer_key, 3600)
    if subject_hash:
        redis_client.sadd(subject_key, stream_id)
        redis_client.expire(subject_key, 3600)
    if ref_key:
        redis_client.set(ref_key, "1", ex=3600)

    return True, None, stream_id


def release_stream_slot(
    redis_client,
    node_uid: str,
    subject_hash: str | None = None,
    stream_id: str | None = None,
):
    """Release an active stream slot."""
    peer_key = _slots_key(node_uid)
    eval_method = getattr(redis_client, "eval", None)
    if callable(eval_method) and stream_id:
        result = eval_method(
            RELEASE_SLOT_LUA,
            2,
            peer_key,
            _subject_slots_key(node_uid, subject_hash or "anonymous"),
            stream_id,
        )
        if isinstance(result, int):
            return
    if stream_id and stream_id.startswith("logical:"):
        ref_key = _refcount_key(node_uid, stream_id)
        remaining = int(redis_client.decr(ref_key) or 0)
        if remaining > 0:
            redis_client.expire(ref_key, 3600)
            return
        redis_client.delete(ref_key)

    if stream_id:
        redis_client.srem(peer_key, stream_id)
    if subject_hash:
        subject_key = _subject_slots_key(node_uid, subject_hash)
        if stream_id:
            redis_client.srem(subject_key, stream_id)


def get_active_stream_count(redis_client, node_uid: str) -> int:
    return redis_client.scard(_slots_key(node_uid))


# ── Byte quota tracking ───────────────────────────────────────────────────


def _daily_bytes_key(node_uid: str) -> str:
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{BYTES_PREFIX}:{{{node_uid}}}:peer:{date_str}"


def _daily_subject_bytes_key(node_uid: str, subject_hash: str) -> str:
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{BYTES_PREFIX}:{{{node_uid}}}:subject:{subject_hash}:{date_str}"


def reserve_stream_bytes(
    redis_client,
    node_uid: str,
    bytes_count: int,
    *,
    subject_hash: str | None = None,
    max_peer_bytes: int = DEFAULT_DAILY_BYTES_PER_PEER,
    max_subject_bytes: int = DEFAULT_DAILY_BYTES_PER_SUBJECT,
) -> tuple[bool, str | None]:
    if bytes_count < 0:
        raise ValueError("bytes_count cannot be negative")
    peer_key = _daily_bytes_key(node_uid)
    subject_key = _daily_subject_bytes_key(node_uid, subject_hash or "anonymous")
    result = redis_client.eval(
        RESERVE_BYTES_LUA,
        2,
        peer_key,
        subject_key,
        bytes_count,
        max_peer_bytes,
        max_subject_bytes,
        86400 * 2,
    )
    allowed = bool(int(result[0]))
    reason = result[1]
    if isinstance(reason, bytes):
        reason = reason.decode("utf-8", errors="replace")
    if not allowed:
        _observe_quota_denial(node_uid, subject_hash, str(reason))
    return (True, None) if allowed else (False, str(reason))


def reconcile_stream_bytes(
    redis_client,
    node_uid: str,
    *,
    reserved_bytes: int,
    actual_bytes: int,
    subject_hash: str | None = None,
) -> None:
    adjustment = actual_bytes - reserved_bytes
    redis_client.eval(
        RECONCILE_BYTES_LUA,
        2,
        _daily_bytes_key(node_uid),
        _daily_subject_bytes_key(node_uid, subject_hash or "anonymous"),
        adjustment,
        86400 * 2,
    )


def check_byte_quota(
    redis_client,
    node_uid: str,
    subject_hash: str | None = None,
    max_peer_bytes: int = DEFAULT_DAILY_BYTES_PER_PEER,
    max_subject_bytes: int = DEFAULT_DAILY_BYTES_PER_SUBJECT,
) -> tuple[bool, str | None]:
    """Check if byte quotas allow streaming. Returns (allowed, denial_reason)."""
    peer_key = _daily_bytes_key(node_uid)
    peer_bytes = int(redis_client.get(peer_key) or 0)
    if peer_bytes >= max_peer_bytes:
        _observe_quota_denial(node_uid, subject_hash, "peer_byte_quota")
        return False, "peer_byte_quota"

    if subject_hash:
        subject_key = _daily_subject_bytes_key(node_uid, subject_hash)
        subject_bytes = int(redis_client.get(subject_key) or 0)
        if subject_bytes >= max_subject_bytes:
            _observe_quota_denial(node_uid, subject_hash, "subject_byte_quota")
            return False, "subject_byte_quota"

    return True, None


def record_bytes_sent(
    redis_client,
    node_uid: str,
    bytes_count: int,
    subject_hash: str | None = None,
):
    """Record bytes sent for daily quota tracking."""
    peer_key = _daily_bytes_key(node_uid)
    redis_client.incrby(peer_key, bytes_count)
    redis_client.expire(peer_key, 86400 * 2)

    if subject_hash:
        subject_key = _daily_subject_bytes_key(node_uid, subject_hash)
        redis_client.incrby(subject_key, bytes_count)
        redis_client.expire(subject_key, 86400 * 2)


def get_daily_bytes(redis_client, node_uid: str) -> int:
    return int(redis_client.get(_daily_bytes_key(node_uid)) or 0)


def get_subject_daily_bytes(redis_client, node_uid: str, subject_hash: str) -> int:
    return int(redis_client.get(_daily_subject_bytes_key(node_uid, subject_hash)) or 0)
