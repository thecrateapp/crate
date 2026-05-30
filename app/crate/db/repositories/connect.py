from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Any, cast

from sqlalchemy import text

from crate.db.cache_runtime import get_redis
from crate.db.repositories.playback_state import project_live_position
from crate.db.tx import optional_scope, read_scope, transaction_scope

log = logging.getLogger(__name__)

ACTIVE_SESSION_TTL_SECONDS = 300
COMMAND_TTL_SECONDS = 300
COMMAND_STREAM_MAXLEN = 1000
MEMORY_STREAM_TTL_SECONDS = 900
CONNECT_COMMAND_TYPES = {
    "play",
    "pause",
    "resume",
    "seek",
    "next",
    "previous",
    "set_queue",
    "append_tracks",
    "set_volume",
    "set_repeat",
    "set_shuffle",
    "transfer_in",
    "transfer_out",
}

_memory_lock = RLock()
_memory_streams: dict[str, list[tuple[str, dict[str, Any]]]] = {}
_memory_stream_activity: dict[str, float] = {}
_memory_dedupe: dict[str, float] = {}
_memory_acks: dict[str, tuple[float, dict[str, Any]]] = {}
_memory_sequence = 0


class ConnectError(Exception):
    """Base error for user-scoped Connect command failures."""


class ConnectDeviceNotFound(ConnectError):
    pass


class ConnectDeviceUnavailable(ConnectError):
    pass


class ConnectPlaybackStateMissing(ConnectError):
    pass


class ConnectActiveSessionMissing(ConnectError):
    pass


class ConnectStaleCommand(ConnectError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _json(value: Any) -> str:
    return json.dumps(value, default=str)


def _coerce_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def _stream_key(user_id: int, device_id: str) -> str:
    return f"connect:commands:{user_id}:{device_id}"


def _dedupe_key(user_id: int, command_id: str) -> str:
    return f"connect:command-dedupe:{user_id}:{command_id}"


def _ack_key(user_id: int, command_id: str) -> str:
    return f"connect:command-ack:{user_id}:{command_id}"


def _cleanup_memory_expired(now: float | None = None) -> None:
    current = now or time.time()
    expired_dedupe = [
        key for key, expires_at in _memory_dedupe.items() if expires_at <= current
    ]
    for key in expired_dedupe:
        del _memory_dedupe[key]
    expired_acks = [
        key
        for key, (expires_at, _payload) in _memory_acks.items()
        if expires_at <= current
    ]
    for key in expired_acks:
        del _memory_acks[key]
    expired_streams = [
        key
        for key, touched_at in _memory_stream_activity.items()
        if touched_at + MEMORY_STREAM_TTL_SECONDS <= current
    ]
    for key in expired_streams:
        _memory_stream_activity.pop(key, None)
        _memory_streams.pop(key, None)


def reset_process_command_bus_for_tests() -> None:
    global _memory_sequence
    with _memory_lock:
        _memory_streams.clear()
        _memory_stream_activity.clear()
        _memory_dedupe.clear()
        _memory_acks.clear()
        _memory_sequence = 0


def _memory_stream_id() -> str:
    global _memory_sequence
    _memory_sequence += 1
    return f"{int(time.time() * 1000)}-{_memory_sequence}"


def _parse_stream_id(value: str) -> tuple[int, int]:
    first, _, second = str(value or "0-0").partition("-")
    try:
        return int(first), int(second or 0)
    except ValueError:
        return 0, 0


def _stream_id_after(candidate: str, last_id: str) -> bool:
    if last_id == "$":
        return False
    return _parse_stream_id(candidate) > _parse_stream_id(last_id)


def _device_from_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    capabilities = _coerce_json(row.get("capabilities_json"))
    return {
        "device_id": row.get("device_id"),
        "device_label": row.get("device_label"),
        "device_type": row.get("device_type"),
        "app_platform": row.get("app_platform"),
        "app_version": row.get("app_version"),
        "capabilities": capabilities if isinstance(capabilities, dict) else {},
        "last_session_id": row.get("last_session_id"),
        "last_seen_at": row.get("last_seen_at"),
        "revoked_at": row.get("revoked_at"),
    }


def _state_from_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "device_id": row.get("device_id"),
        "device_label": row.get("device_label"),
        "status": row.get("status"),
        "playback_session_id": row.get("playback_session_id"),
        "track_id": row.get("track_id"),
        "track_entity_uid": row.get("track_entity_uid"),
        "track_path": row.get("track_path"),
        "title": row.get("title") or "",
        "artist": row.get("artist") or "",
        "album": row.get("album") or "",
        "album_cover": row.get("album_cover"),
        "position_ms": row.get("position_ms") or 0,
        "duration_ms": row.get("duration_ms"),
        "current_index": row.get("current_index") or 0,
        "queue_revision": row.get("queue_revision"),
        "queue": _coerce_json(row.get("queue_json")) or [],
        "play_source": _coerce_json(row.get("play_source_json")),
        "repeat_mode": row.get("repeat_mode") or "off",
        "shuffle": bool(row.get("shuffle")),
        "unshuffled_queue": _coerce_json(row.get("unshuffled_queue_json")),
        "playback_rate": row.get("playback_rate") or 1,
        "app_platform": row.get("app_platform"),
        "device_type": row.get("device_type"),
        "updated_at": row.get("updated_at"),
        "expires_at": row.get("expires_at"),
    }


def _active_session_from_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "user_id": row.get("user_id"),
        "playback_session_id": row.get("playback_session_id"),
        "active_device_id": row.get("active_device_id"),
        "status": row.get("status"),
        "command_seq": row.get("command_seq") or 0,
        "state_revision": row.get("state_revision"),
        "updated_at": row.get("updated_at"),
        "expires_at": row.get("expires_at"),
    }


def _require_device(user_id: int, device_id: str, *, session=None) -> dict[str, Any]:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                    SELECT *
                    FROM user_devices
                    WHERE user_id = :user_id
                      AND device_id = :device_id
                      AND revoked_at IS NULL
                    LIMIT 1
                    """
                ),
                {"user_id": user_id, "device_id": device_id},
            )
            .mappings()
            .first()
        )
    device = _device_from_row(dict(row) if row else None)
    if device is None:
        raise ConnectDeviceNotFound(f"Device not found: {device_id}")
    return device


def _require_command_receiver(device: dict[str, Any]) -> None:
    capabilities = device.get("capabilities") or {}
    if not bool(capabilities.get("can_receive_commands")):
        label = device.get("device_label") or device.get("device_id")
        raise ConnectDeviceUnavailable(f"{label} cannot receive Connect commands")


def get_device_playback_state(
    user_id: int, *, device_id: str, session=None
) -> dict[str, Any] | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                    SELECT s.*, d.device_label
                    FROM user_playback_device_states s
                    JOIN user_devices d
                      ON d.user_id = s.user_id
                     AND d.device_id = s.device_id
                    WHERE s.user_id = :user_id
                      AND s.device_id = :device_id
                      AND d.revoked_at IS NULL
                      AND (s.expires_at IS NULL OR s.expires_at > NOW())
                    LIMIT 1
                    """
                ),
                {"user_id": user_id, "device_id": device_id},
            )
            .mappings()
            .first()
        )
    state = _state_from_row(dict(row) if row else None)
    if state is None:
        return None
    return project_live_position(state)


def get_active_session(user_id: int) -> dict[str, Any] | None:
    with read_scope() as session:
        active = _get_active_session(user_id, session=session)
    return active


def _get_active_session(user_id: int, *, session=None) -> dict[str, Any] | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                    SELECT *
                    FROM user_active_playback_sessions
                    WHERE user_id = :user_id
                      AND (expires_at IS NULL OR expires_at > NOW())
                    LIMIT 1
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
    return _active_session_from_row(dict(row) if row else None)


def _upsert_active_session(
    user_id: int,
    *,
    playback_session_id: str,
    active_device_id: str | None,
    status: str,
    state_revision: str | None,
    session=None,
) -> dict[str, Any]:
    now = _now()
    expires_at = now + timedelta(seconds=ACTIVE_SESSION_TTL_SECONDS)
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                    INSERT INTO user_active_playback_sessions (
                        user_id, playback_session_id, active_device_id, status,
                        command_seq, state_revision, updated_at, expires_at
                    )
                    VALUES (
                        :user_id, CAST(:playback_session_id AS uuid),
                        :active_device_id, :status, 1, :state_revision,
                        :now, :expires_at
                    )
                    ON CONFLICT (user_id) DO UPDATE SET
                        playback_session_id = EXCLUDED.playback_session_id,
                        active_device_id = EXCLUDED.active_device_id,
                        status = EXCLUDED.status,
                        command_seq = user_active_playback_sessions.command_seq + 1,
                        state_revision = EXCLUDED.state_revision,
                        updated_at = EXCLUDED.updated_at,
                        expires_at = EXCLUDED.expires_at
                    RETURNING *
                    """
                ),
                {
                    "user_id": user_id,
                    "playback_session_id": playback_session_id,
                    "active_device_id": active_device_id,
                    "status": status,
                    "state_revision": state_revision,
                    "now": now,
                    "expires_at": expires_at,
                },
            )
            .mappings()
            .one()
        )
    active = _active_session_from_row(dict(row))
    if active is None:
        raise RuntimeError("Failed to update active playback session")
    return active


def _advance_active_session(
    user_id: int,
    *,
    state_revision: str,
    status: str | None = None,
    session=None,
) -> dict[str, Any]:
    now = _now()
    expires_at = now + timedelta(seconds=ACTIVE_SESSION_TTL_SECONDS)
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                    UPDATE user_active_playback_sessions
                    SET command_seq = command_seq + 1,
                        status = COALESCE(:status, status),
                        state_revision = :state_revision,
                        updated_at = :now,
                        expires_at = :expires_at
                    WHERE user_id = :user_id
                      AND (expires_at IS NULL OR expires_at > NOW())
                    RETURNING *
                    """
                ),
                {
                    "user_id": user_id,
                    "status": status,
                    "state_revision": state_revision,
                    "now": now,
                    "expires_at": expires_at,
                },
            )
            .mappings()
            .first()
        )
    active = _active_session_from_row(dict(row) if row else None)
    if active is None:
        raise ConnectActiveSessionMissing("No active playback session")
    return active


def _active_status_for_command(command_type: str) -> str | None:
    if command_type in {"play", "resume"}:
        return "playing"
    if command_type == "pause":
        return "paused"
    return None


def _command_lock_key(user_id: int, command_id: str) -> int:
    digest = hashlib.blake2b(
        f"{user_id}:{command_id}".encode("utf-8"),
        digest_size=8,
    ).digest()
    return int.from_bytes(digest, byteorder="big", signed=True)


def _lock_command_id(session, user_id: int, command_id: str) -> None:
    session.execute(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": _command_lock_key(user_id, command_id)},
    )


def _outbox_stream_id(row_id: int, created_at: datetime | None) -> str:
    timestamp = created_at if isinstance(created_at, datetime) else _now()
    return f"{int(timestamp.timestamp() * 1000)}-{int(row_id)}"


def _command_from_outbox_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    created_at = row.get("created_at")
    payload = _coerce_json(row.get("payload_json"))
    return {
        "command_id": str(row.get("command_id")),
        "type": row.get("command_type"),
        "source_device_id": row.get("source_device_id"),
        "target_device_id": row.get("target_device_id"),
        "playback_session_id": str(row.get("playback_session_id"))
        if row.get("playback_session_id")
        else None,
        "command_seq": row.get("command_seq"),
        "payload": payload if isinstance(payload, dict) else {},
        "created_at": created_at,
        "stream_id": _outbox_stream_id(int(row["id"]), created_at),
        "deduplicated": False,
    }


def _get_outbox_command(
    session, user_id: int, command_id: str
) -> dict[str, Any] | None:
    row = (
        session.execute(
            text(
                """
                SELECT *
                FROM connect_command_outbox
                WHERE user_id = :user_id
                  AND command_id = CAST(:command_id AS uuid)
                LIMIT 1
                """
            ),
            {"user_id": user_id, "command_id": command_id},
        )
        .mappings()
        .first()
    )
    command = _command_from_outbox_row(dict(row) if row else None)
    if command is not None:
        command["deduplicated"] = True
    return command


def _persist_outbox_command(
    session, user_id: int, command: dict[str, Any]
) -> dict[str, Any]:
    created_at = command.get("created_at")
    if not isinstance(created_at, datetime):
        created_at = _now()
    expires_at = created_at + timedelta(seconds=COMMAND_TTL_SECONDS)
    row = (
        session.execute(
            text(
                """
                INSERT INTO connect_command_outbox (
                    user_id, target_device_id, command_id, command_type,
                    source_device_id, playback_session_id, command_seq,
                    payload_json, created_at, expires_at
                )
                VALUES (
                    :user_id, :target_device_id, CAST(:command_id AS uuid),
                    :command_type, :source_device_id,
                    CAST(:playback_session_id AS uuid), :command_seq,
                    CAST(:payload_json AS jsonb), :created_at, :expires_at
                )
                ON CONFLICT (user_id, command_id) DO UPDATE SET
                    command_id = connect_command_outbox.command_id
                RETURNING *
                """
            ),
            {
                "user_id": user_id,
                "target_device_id": command["target_device_id"],
                "command_id": command["command_id"],
                "command_type": command["type"],
                "source_device_id": command.get("source_device_id"),
                "playback_session_id": command.get("playback_session_id"),
                "command_seq": command.get("command_seq"),
                "payload_json": _json(command.get("payload") or {}),
                "created_at": created_at,
                "expires_at": expires_at,
            },
        )
        .mappings()
        .one()
    )
    persisted = _command_from_outbox_row(dict(row))
    if persisted is None:
        raise RuntimeError("Failed to persist Connect command")
    persisted["deduplicated"] = bool(command.get("deduplicated", False))
    return persisted


def _read_outbox_commands(
    user_id: int,
    *,
    device_id: str,
    last_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM connect_command_outbox
                    WHERE user_id = :user_id
                      AND target_device_id = :device_id
                      AND expires_at > :now
                      AND acked_at IS NULL
                    ORDER BY id ASC
                    LIMIT :limit
                    """
                ),
                {
                    "user_id": user_id,
                    "device_id": device_id,
                    "now": _now(),
                    "limit": max(100, min(limit * 4, COMMAND_STREAM_MAXLEN)),
                },
            )
            .mappings()
            .all()
        )
    commands = [
        command
        for row in rows
        if (command := _command_from_outbox_row(dict(row))) is not None
        and _stream_id_after(command["stream_id"], last_id)
    ]
    return commands[: max(1, min(limit, 100))]


def _publish_persisted_command(user_id: int, command: dict[str, Any]) -> None:
    created_at = command.get("created_at")
    payload = {
        **command,
        "created_at": created_at.isoformat()
        if isinstance(created_at, datetime)
        else str(created_at or ""),
    }
    _publish_command(_stream_key(user_id, str(command["target_device_id"])), payload)


def _claim_command_id(user_id: int, command_id: str) -> bool:
    key = _dedupe_key(user_id, command_id)
    redis = get_redis()
    if redis is not None:
        try:
            return bool(redis.set(key, "1", nx=True, ex=COMMAND_TTL_SECONDS))
        except Exception:
            log.warning(
                "Redis command dedupe failed; using memory fallback", exc_info=True
            )

    with _memory_lock:
        _cleanup_memory_expired()
        if key in _memory_dedupe:
            return False
        _memory_dedupe[key] = time.time() + COMMAND_TTL_SECONDS
        return True


def _publish_command(stream_key: str, payload: dict[str, Any]) -> str:
    redis = get_redis()
    if redis is not None:
        try:
            return str(
                redis.xadd(
                    stream_key,
                    {"payload": _json(payload)},
                    maxlen=COMMAND_STREAM_MAXLEN,
                    approximate=True,
                )
            )
        except Exception:
            log.warning(
                "Redis command publish failed; using memory fallback", exc_info=True
            )

    with _memory_lock:
        _cleanup_memory_expired()
        stream_id = _memory_stream_id()
        entries = _memory_streams.setdefault(stream_key, [])
        entries.append((stream_id, payload))
        if len(entries) > COMMAND_STREAM_MAXLEN:
            del entries[: len(entries) - COMMAND_STREAM_MAXLEN]
        _memory_stream_activity[stream_key] = time.time()
        return stream_id


def enqueue_connect_command(
    user_id: int,
    *,
    target_device_id: str,
    command_type: str,
    payload: dict[str, Any] | None = None,
    source_device_id: str | None = None,
    playback_session_id: str | None = None,
    command_id: str | None = None,
    command_seq: int | None = None,
) -> dict[str, Any]:
    if command_type not in CONNECT_COMMAND_TYPES:
        raise ValueError(f"Unsupported Connect command type: {command_type}")

    resolved_command_id = command_id or str(uuid.uuid4())
    created_at = _now()
    command = {
        "command_id": resolved_command_id,
        "type": command_type,
        "source_device_id": source_device_id,
        "target_device_id": target_device_id,
        "playback_session_id": playback_session_id,
        "command_seq": command_seq,
        "payload": payload or {},
        "created_at": created_at,
        "deduplicated": False,
    }
    if not _claim_command_id(user_id, resolved_command_id):
        command["deduplicated"] = True
        return command

    stream_payload = {**command, "created_at": created_at.isoformat()}
    command["stream_id"] = _publish_command(
        _stream_key(user_id, target_device_id),
        stream_payload,
    )
    return command


def read_connect_commands(
    user_id: int,
    *,
    device_id: str,
    last_id: str = "0-0",
    limit: int = 25,
    block_ms: int = 0,
) -> list[dict[str, Any]]:
    stream_key = _stream_key(user_id, device_id)
    outbox_commands = _read_outbox_commands(
        user_id,
        device_id=device_id,
        last_id=last_id,
        limit=limit,
    )
    if outbox_commands:
        return outbox_commands

    redis = get_redis()
    if redis is not None:
        try:
            entries = redis.xread(
                {stream_key: last_id},
                count=max(1, min(limit, 100)),
                block=max(0, block_ms),
            )
        except Exception:
            log.warning(
                "Redis command read failed; using memory fallback", exc_info=True
            )
        else:
            commands: list[dict[str, Any]] = []
            for _name, rows in entries or []:
                for stream_id, fields in rows:
                    payload = _coerce_json(fields.get("payload")) or {}
                    if isinstance(payload, dict):
                        transport_stream_id = str(stream_id)
                        commands.append(
                            {
                                **payload,
                                "stream_id": str(
                                    payload.get("stream_id") or transport_stream_id
                                ),
                                "transport_stream_id": transport_stream_id,
                            }
                        )
            return commands

    with _memory_lock:
        _cleanup_memory_expired()
        rows = [
            (stream_id, payload)
            for stream_id, payload in _memory_streams.get(stream_key, [])
            if _stream_id_after(stream_id, last_id)
        ][: max(1, min(limit, 100))]
        if stream_key in _memory_streams:
            _memory_stream_activity[stream_key] = time.time()
    return [
        {
            **payload,
            "stream_id": str(payload.get("stream_id") or stream_id),
            "transport_stream_id": stream_id,
        }
        for stream_id, payload in rows
    ]


def transfer_playback(
    user_id: int,
    *,
    target_device_id: str,
    source_device_id: str,
    start_playing: bool = True,
) -> dict[str, Any]:
    if source_device_id == target_device_id:
        source_command_required = False
    else:
        source_command_required = True

    new_playback_session_id = str(uuid.uuid4())
    target_command_id = str(uuid.uuid4())
    source_command_id = str(uuid.uuid4()) if source_command_required else None

    with transaction_scope() as session:
        source_device = _require_device(user_id, source_device_id, session=session)
        target_device = _require_device(user_id, target_device_id, session=session)
        _require_command_receiver(target_device)
        if source_command_required:
            _require_command_receiver(source_device)

        source_state = get_device_playback_state(
            user_id, device_id=source_device_id, session=session
        )
        if source_state is None:
            raise ConnectPlaybackStateMissing("Source playback state not found")

        source_playback_session_id = str(
            source_state.get("playback_session_id") or uuid.uuid4()
        )
        active = _upsert_active_session(
            user_id,
            playback_session_id=source_playback_session_id,
            active_device_id=source_device_id,
            status=str(source_state.get("status") or "playing"),
            state_revision=target_command_id,
            session=session,
        )
        command_seq = int(active["command_seq"])
        created_at = _now()
        target_command = _persist_outbox_command(
            session,
            user_id,
            {
                "command_id": target_command_id,
                "type": "transfer_in",
                "source_device_id": source_device_id,
                "target_device_id": target_device_id,
                "playback_session_id": new_playback_session_id,
                "command_seq": command_seq,
                "payload": {
                    "source_device_id": source_device_id,
                    "target_device_id": target_device_id,
                    "start_playing": start_playing,
                    "source_command_id": source_command_id,
                    "target_playback_session_id": new_playback_session_id,
                    "state": source_state,
                },
                "created_at": created_at,
                "deduplicated": False,
            },
        )

    _publish_persisted_command(user_id, target_command)

    return {
        "session": active,
        "target_command": target_command,
        "source_command": None,
    }


def _commit_transfer_ack(
    session,
    user_id: int,
    *,
    command: dict[str, Any],
    status: str,
) -> dict[str, Any] | None:
    if command.get("type") != "transfer_in":
        return None

    payload = command.get("payload") or {}
    if not isinstance(payload, dict):
        return None

    source_device_id = str(
        payload.get("source_device_id") or command.get("source_device_id") or ""
    )
    target_device_id = str(
        payload.get("target_device_id") or command.get("target_device_id") or ""
    )
    if (
        not source_device_id
        or not target_device_id
        or source_device_id == target_device_id
    ):
        return None

    raw_source_state = payload.get("state")
    source_state: dict[str, Any] = (
        cast(dict[str, Any], raw_source_state)
        if isinstance(raw_source_state, dict)
        else {}
    )
    if status != "success":
        source_playback_session_id = str(
            source_state.get("playback_session_id") or uuid.uuid4()
        )
        _upsert_active_session(
            user_id,
            playback_session_id=source_playback_session_id,
            active_device_id=source_device_id,
            status=str(source_state.get("status") or "playing"),
            state_revision=str(command["command_id"]),
            session=session,
        )
        return None

    target_playback_session_id = str(
        payload.get("target_playback_session_id")
        or command.get("playback_session_id")
        or uuid.uuid4()
    )
    active = _upsert_active_session(
        user_id,
        playback_session_id=target_playback_session_id,
        active_device_id=target_device_id,
        status="playing" if payload.get("start_playing") is not False else "paused",
        state_revision=str(command["command_id"]),
        session=session,
    )

    try:
        _require_command_receiver(
            _require_device(user_id, source_device_id, session=session)
        )
    except ConnectError:
        return None

    source_command_id = str(payload.get("source_command_id") or uuid.uuid4())
    existing = _get_outbox_command(session, user_id, source_command_id)
    if existing is not None:
        return existing

    return _persist_outbox_command(
        session,
        user_id,
        {
            "command_id": source_command_id,
            "type": "transfer_out",
            "source_device_id": target_device_id,
            "target_device_id": source_device_id,
            "playback_session_id": str(source_state.get("playback_session_id"))
            if source_state.get("playback_session_id")
            else None,
            "command_seq": active["command_seq"],
            "payload": {
                "target_device_id": target_device_id,
                "transferred_playback_session_id": target_playback_session_id,
            },
            "created_at": _now(),
            "deduplicated": False,
        },
    )


def sync_active_playback_claim(
    user_id: int,
    *,
    device_id: str,
    status: str,
    state_revision: str | None = None,
) -> dict[str, Any] | None:
    """Keep the user's active Connect device exclusive.

    A device that starts playing manually should become the active output and
    ask the previous active device to stop. Explicit Connect transfers still use
    transfer_playback(); this is the safety net for ordinary local Play actions.
    """
    if status not in {"playing", "paused", "stopped"}:
        return None

    source_command = None
    active = None
    with transaction_scope() as session:
        _require_device(user_id, device_id, session=session)
        previous = _get_active_session(user_id, session=session)
        previous_device_id = str(previous["active_device_id"]) if previous else None

        if status == "playing":
            playback_session_id = (
                str(previous["playback_session_id"])
                if previous_device_id == device_id and previous
                else str(uuid.uuid4())
            )
            active = _upsert_active_session(
                user_id,
                playback_session_id=playback_session_id,
                active_device_id=device_id,
                status="playing",
                state_revision=state_revision or playback_session_id,
                session=session,
            )
            if (
                previous
                and previous_device_id
                and previous_device_id != device_id
                and previous.get("status") == "playing"
            ):
                try:
                    previous_device = _require_device(
                        user_id, previous_device_id, session=session
                    )
                    _require_command_receiver(previous_device)
                except ConnectError:
                    previous_device = None
                if previous_device is not None:
                    command_id = str(uuid.uuid4())
                    source_command = _persist_outbox_command(
                        session,
                        user_id,
                        {
                            "command_id": command_id,
                            "type": "transfer_out",
                            "source_device_id": device_id,
                            "target_device_id": previous_device_id,
                            "playback_session_id": str(previous["playback_session_id"]),
                            "command_seq": active["command_seq"],
                            "payload": {
                                "target_device_id": device_id,
                                "transferred_playback_session_id": str(
                                    active["playback_session_id"]
                                ),
                                "reason": "active-device-claimed",
                            },
                            "created_at": _now(),
                            "deduplicated": False,
                        },
                    )
        elif previous and previous_device_id == device_id:
            active = _upsert_active_session(
                user_id,
                playback_session_id=str(previous["playback_session_id"]),
                active_device_id=device_id,
                status=status,
                state_revision=state_revision or previous.get("state_revision"),
                session=session,
            )

    if source_command is not None:
        _publish_persisted_command(user_id, source_command)
    return active


def send_connect_command(
    user_id: int,
    *,
    command_type: str,
    payload: dict[str, Any] | None = None,
    target_device_id: str | None = None,
    source_device_id: str | None = None,
    playback_session_id: str | None = None,
    command_id: str | None = None,
) -> dict[str, Any]:
    if command_type in {"transfer_in", "transfer_out"}:
        raise ValueError("Transfer commands must use the transfer endpoint")
    if command_type not in CONNECT_COMMAND_TYPES:
        raise ValueError(f"Unsupported Connect command type: {command_type}")

    resolved_command_id = command_id or str(uuid.uuid4())

    with transaction_scope() as session:
        _lock_command_id(session, user_id, resolved_command_id)
        existing = _get_outbox_command(session, user_id, resolved_command_id)
        if existing is not None:
            return existing

        current = _get_active_session(user_id, session=session)
        if current is None:
            raise ConnectActiveSessionMissing("No active playback session")
        resolved_target = target_device_id or current.get("active_device_id")
        if not resolved_target:
            raise ConnectActiveSessionMissing("No active target device")
        if resolved_target != current.get("active_device_id"):
            raise ConnectStaleCommand("Commands can only target the active device")

        current_session_id = str(current["playback_session_id"])
        if playback_session_id and str(playback_session_id) != current_session_id:
            raise ConnectStaleCommand("Command playback session is stale")

        _require_command_receiver(
            _require_device(user_id, str(resolved_target), session=session)
        )
        active = _advance_active_session(
            user_id,
            state_revision=resolved_command_id,
            status=_active_status_for_command(command_type),
            session=session,
        )
        command = _persist_outbox_command(
            session,
            user_id,
            {
                "command_id": resolved_command_id,
                "type": command_type,
                "source_device_id": source_device_id,
                "target_device_id": str(resolved_target),
                "playback_session_id": str(active["playback_session_id"]),
                "command_seq": active["command_seq"],
                "payload": payload or {},
                "created_at": _now(),
                "deduplicated": False,
            },
        )

    _publish_persisted_command(user_id, command)
    return command


def acknowledge_connect_command(
    user_id: int,
    *,
    device_id: str,
    command_id: str,
    status: str,
    error: str | None = None,
) -> dict[str, Any]:
    now = _now()
    source_command = None
    ack = {
        "command_id": command_id,
        "device_id": device_id,
        "status": status,
        "error": error,
        "acknowledged_at": now,
    }
    with transaction_scope() as session:
        _require_device(user_id, device_id, session=session)
        command = _get_outbox_command(session, user_id, command_id)
        session.execute(
            text(
                """
                UPDATE connect_command_outbox
                SET acked_at = :now,
                    ack_status = :status,
                    ack_error = :error
                WHERE user_id = :user_id
                  AND target_device_id = :device_id
                  AND command_id = CAST(:command_id AS uuid)
                """
            ),
            {
                "user_id": user_id,
                "device_id": device_id,
                "command_id": command_id,
                "status": status,
                "error": error,
                "now": now,
            },
        )
        if command is not None:
            source_command = _commit_transfer_ack(
                session,
                user_id,
                command=command,
                status=status,
            )
    if source_command is not None:
        _publish_persisted_command(user_id, source_command)
    key = _ack_key(user_id, command_id)
    redis = get_redis()
    if redis is not None:
        try:
            redis.setex(
                key,
                COMMAND_TTL_SECONDS,
                _json({**ack, "acknowledged_at": now.isoformat()}),
            )
            return ack
        except Exception:
            log.warning(
                "Redis command ack failed; using memory fallback", exc_info=True
            )

    with _memory_lock:
        _cleanup_memory_expired()
        _memory_acks[key] = (time.time() + COMMAND_TTL_SECONDS, ack)
    return ack
