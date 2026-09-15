from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope, transaction_scope


CAST_SESSION_ABSOLUTE_TTL = timedelta(hours=8)
CAST_SESSION_IDLE_TTL = timedelta(minutes=30)
CAST_REPEAT_MODES = {"all", "off", "one"}
MAX_CAST_QUEUE_ITEMS = 1_000
MAX_CAST_ITEM_ID_LENGTH = 160
MAX_CAST_JSON_BYTES = 16_384


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _lease_hash(lease: str) -> str:
    return hashlib.sha256(lease.encode("utf-8")).hexdigest()


def _json(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))


def _coerce_json(value: Any, fallback: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback if value is None else value


def _normalize_repeat_mode(value: str | None) -> str:
    normalized = str(value or "off").strip().lower()
    if normalized not in CAST_REPEAT_MODES:
        raise ValueError(f"Unsupported Cast repeat mode: {value}")
    return normalized


def _validate_json_object(name: str, value: dict[str, Any]) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"Cast {name} must be an object")
    if len(_json(value).encode("utf-8")) > MAX_CAST_JSON_BYTES:
        raise ValueError(f"Cast {name} exceeds {MAX_CAST_JSON_BYTES} bytes")


def _validate_queue(queue: list[dict]) -> None:
    if not isinstance(queue, list):
        raise ValueError("Cast queue must be a list")
    if len(queue) > MAX_CAST_QUEUE_ITEMS:
        raise ValueError(f"Cast queue supports at most {MAX_CAST_QUEUE_ITEMS} items")
    item_ids: set[str] = set()
    for item in queue:
        if not isinstance(item, dict):
            raise ValueError("Every Cast queue item must be an object")
        if len(_json(item).encode("utf-8")) > MAX_CAST_JSON_BYTES:
            raise ValueError(
                f"Every Cast queue item must fit within {MAX_CAST_JSON_BYTES} bytes"
            )
        item_id = item.get("item_id")
        if (
            not isinstance(item_id, str)
            or not item_id.strip()
            or len(item_id) > MAX_CAST_ITEM_ID_LENGTH
        ):
            raise ValueError("Every Cast queue item requires a bounded item_id")
        if item_id in item_ids:
            raise ValueError("Cast queue items require a unique item_id")
        item_ids.add(item_id)
        if not any(
            item.get(key) not in {None, ""}
            for key in ("track_id", "track_entity_uid", "track_path")
        ):
            raise ValueError("Every Cast queue item requires a track reference")


def _validate_cursor(queue: list[dict], current_index: int) -> None:
    if current_index < 0:
        raise ValueError("Cast current_index must be non-negative")
    if not queue and current_index != 0:
        raise ValueError("An empty Cast queue must use current_index 0")
    if queue and current_index >= len(queue):
        raise ValueError("Cast current_index is outside the queue")


def _session_from_row(row: dict[str, Any] | None) -> dict | None:
    if not row:
        return None
    return {
        "session_id": str(row["session_id"]),
        "user_id": row["user_id"],
        "target_device_id": row.get("target_device_id"),
        "protocol_version": row.get("protocol_version") or 1,
        "receiver_capabilities": _coerce_json(row.get("capabilities_json"), {}),
        "appearance": _coerce_json(row.get("appearance_json"), {}),
        "queue": _coerce_json(row.get("queue_json"), []),
        "current_index": row.get("current_index") or 0,
        "current_time": float(row.get("position_seconds") or 0),
        "repeat_mode": row.get("repeat_mode") or "off",
        "shuffle": bool(row.get("shuffle")),
        "revision": int(row.get("revision") or 0),
        "state_seq": int(row.get("state_seq") or 0),
        "created_at": row.get("created_at"),
        "last_used_at": row.get("last_used_at"),
        "expires_at": row.get("expires_at"),
        "revoked_at": row.get("revoked_at"),
    }


def create_cast_session(
    user_id: int,
    *,
    queue: list[dict],
    target_device_id: str | None = None,
    protocol_version: int = 1,
    receiver_capabilities: dict[str, Any] | None = None,
    appearance: dict[str, Any] | None = None,
    current_index: int = 0,
    current_time: float = 0,
    repeat_mode: str = "off",
    shuffle: bool = False,
    revision: int = 0,
    session=None,
) -> dict:
    _validate_queue(queue)
    _validate_cursor(queue, current_index)
    if current_time < 0:
        raise ValueError("Cast current_time must be non-negative")
    if revision < 0:
        raise ValueError("Cast revision must be non-negative")
    if protocol_version != 1:
        raise ValueError("Unsupported Cast protocol version")
    if target_device_id and len(target_device_id) > MAX_CAST_ITEM_ID_LENGTH:
        raise ValueError("Cast target_device_id is too long")
    _validate_json_object("capabilities", receiver_capabilities or {})
    _validate_json_object("appearance", appearance or {})

    now = _now()
    lease = secrets.token_urlsafe(48)
    values = {
        "lease_hash": _lease_hash(lease),
        "session_id": str(uuid.uuid4()),
        "user_id": user_id,
        "target_device_id": target_device_id,
        "protocol_version": protocol_version,
        "capabilities_json": _json(receiver_capabilities or {}),
        "appearance_json": _json(appearance or {}),
        "queue_json": _json(queue),
        "current_index": current_index,
        "current_time": float(current_time),
        "repeat_mode": _normalize_repeat_mode(repeat_mode),
        "shuffle": bool(shuffle),
        "revision": revision,
        "created_at": now,
        "last_used_at": now,
        "expires_at": now + CAST_SESSION_ABSOLUTE_TTL,
    }
    with optional_scope(session) as active_session:
        row = (
            active_session.execute(
                text(
                    """
                    INSERT INTO cast_playback_sessions (
                        lease_hash, session_id, user_id, target_device_id,
                        protocol_version, capabilities_json, appearance_json,
                        queue_json, current_index, position_seconds, repeat_mode,
                        shuffle, revision, created_at, last_used_at, expires_at
                    ) VALUES (
                        :lease_hash, CAST(:session_id AS uuid), :user_id,
                        :target_device_id, :protocol_version,
                        CAST(:capabilities_json AS jsonb),
                        CAST(:appearance_json AS jsonb),
                        CAST(:queue_json AS jsonb), :current_index,
                        :current_time, :repeat_mode, :shuffle, :revision,
                        :created_at, :last_used_at, :expires_at
                    )
                    RETURNING *
                    """
                ),
                values,
            )
            .mappings()
            .one()
        )
    created = _session_from_row(dict(row))
    if created is None:
        raise RuntimeError("Failed to create Cast playback session")
    return {**created, "lease": lease}


def _active_session_predicate() -> str:
    return """
        revoked_at IS NULL
        AND expires_at > :now
        AND last_used_at >= :idle_cutoff
    """


def get_cast_session_by_lease(lease: str) -> dict | None:
    if not lease:
        return None
    now = _now()
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    SELECT *
                    FROM cast_playback_sessions
                    WHERE lease_hash = :lease_hash
                      AND {_active_session_predicate()}
                    LIMIT 1
                    """
                ),
                {
                    "lease_hash": _lease_hash(lease),
                    "now": now,
                    "idle_cutoff": now - CAST_SESSION_IDLE_TTL,
                },
            )
            .mappings()
            .first()
        )
    return _session_from_row(dict(row) if row else None)


def get_cast_session_for_user(user_id: int, session_id: str) -> dict | None:
    now = _now()
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    SELECT *
                    FROM cast_playback_sessions
                    WHERE session_id = CAST(:session_id AS uuid)
                      AND user_id = :user_id
                      AND {_active_session_predicate()}
                    LIMIT 1
                    """
                ),
                {
                    "session_id": session_id,
                    "user_id": user_id,
                    "now": now,
                    "idle_cutoff": now - CAST_SESSION_IDLE_TTL,
                },
            )
            .mappings()
            .first()
        )
    return _session_from_row(dict(row) if row else None)


def touch_cast_session(lease: str) -> dict | None:
    if not lease:
        return None
    now = _now()
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    UPDATE cast_playback_sessions
                    SET last_used_at = :now
                    WHERE lease_hash = :lease_hash
                      AND {_active_session_predicate()}
                    RETURNING *
                    """
                ),
                {
                    "lease_hash": _lease_hash(lease),
                    "now": now,
                    "idle_cutoff": now - CAST_SESSION_IDLE_TTL,
                },
            )
            .mappings()
            .first()
        )
    return _session_from_row(dict(row) if row else None)


def update_cast_session_queue(
    user_id: int,
    session_id: str,
    *,
    expected_revision: int,
    mutation_id: str,
    queue: list[dict],
    repeat_mode: str | None = None,
    shuffle: bool | None = None,
) -> dict | None:
    _validate_queue(queue)
    if expected_revision < 0 or not mutation_id or len(mutation_id) > 160:
        raise ValueError("Invalid Cast queue mutation")
    now = _now()
    values = {
        "session_id": session_id,
        "user_id": user_id,
        "expected_revision": expected_revision,
        "mutation_id": mutation_id,
        "queue_json": _json(queue),
        "repeat_mode": _normalize_repeat_mode(repeat_mode)
        if repeat_mode is not None
        else None,
        "shuffle": shuffle,
        "now": now,
        "idle_cutoff": now - CAST_SESSION_IDLE_TTL,
    }
    with transaction_scope() as session:
        current_row = (
            session.execute(
                text(
                    f"""
                    SELECT *
                    FROM cast_playback_sessions
                    WHERE session_id = CAST(:session_id AS uuid)
                      AND user_id = :user_id
                      AND {_active_session_predicate()}
                    FOR UPDATE
                    """
                ),
                values,
            )
            .mappings()
            .first()
        )
        if not current_row:
            return None
        current = _session_from_row(dict(current_row))
        duplicate = session.execute(
            text(
                """
                SELECT 1
                FROM cast_playback_session_mutations
                WHERE session_id = CAST(:session_id AS uuid)
                  AND mutation_id = :mutation_id
                """
            ),
            values,
        ).scalar_one_or_none()
        if duplicate:
            return {**current, "mutation_status": "duplicate"}
        if current and current["revision"] != expected_revision:
            return {**current, "mutation_status": "conflict"}

        current_queue = current["queue"] if current else []
        current_index = current["current_index"] if current else 0
        current_item_id = (
            current_queue[current_index].get("item_id")
            if current_queue and current_index < len(current_queue)
            else None
        )
        next_index = next(
            (
                index
                for index, item in enumerate(queue)
                if item.get("item_id") == current_item_id
            ),
            min(current_index, max(len(queue) - 1, 0)),
        )
        _validate_cursor(queue, next_index)
        values["current_index"] = next_index

        row = (
            session.execute(
                text(
                    """
                    UPDATE cast_playback_sessions
                    SET queue_json = CAST(:queue_json AS jsonb),
                        current_index = :current_index,
                        repeat_mode = COALESCE(:repeat_mode, repeat_mode),
                        shuffle = COALESCE(:shuffle, shuffle),
                        revision = revision + 1,
                        last_used_at = :now
                    WHERE session_id = CAST(:session_id AS uuid)
                      AND user_id = :user_id
                    RETURNING *
                    """
                ),
                values,
            )
            .mappings()
            .one()
        )
        result = _session_from_row(dict(row))
        session.execute(
            text(
                """
                INSERT INTO cast_playback_session_mutations (
                    session_id, mutation_id, applied_revision, created_at
                ) VALUES (
                    CAST(:session_id AS uuid), :mutation_id,
                    :applied_revision, :now
                )
                """
            ),
            {**values, "applied_revision": result["revision"]},
        )
        return {**result, "mutation_status": "applied"}


def update_cast_session_state(
    lease: str,
    *,
    state_seq: int,
    current_index: int,
    current_time: float,
) -> dict | None:
    if state_seq < 0 or current_time < 0:
        raise ValueError("Invalid Cast receiver state")
    now = _now()
    values = {
        "lease_hash": _lease_hash(lease),
        "state_seq": state_seq,
        "current_index": current_index,
        "current_time": float(current_time),
        "now": now,
        "idle_cutoff": now - CAST_SESSION_IDLE_TTL,
    }
    with transaction_scope() as session:
        current_row = (
            session.execute(
                text(
                    f"""
                    SELECT *
                    FROM cast_playback_sessions
                    WHERE lease_hash = :lease_hash
                      AND {_active_session_predicate()}
                    FOR UPDATE
                    """
                ),
                values,
            )
            .mappings()
            .first()
        )
        if not current_row:
            return None
        current = _session_from_row(dict(current_row))
        if current and state_seq <= current["state_seq"]:
            return current
        _validate_cursor(current["queue"], current_index)
        row = (
            session.execute(
                text(
                    """
                    UPDATE cast_playback_sessions
                    SET state_seq = :state_seq,
                        current_index = :current_index,
                        position_seconds = :current_time,
                        last_used_at = :now
                    WHERE lease_hash = :lease_hash
                    RETURNING *
                    """
                ),
                values,
            )
            .mappings()
            .one()
        )
    return _session_from_row(dict(row))


def revoke_cast_session(user_id: int, session_id: str) -> bool:
    now = _now()
    with transaction_scope() as session:
        revoked = session.execute(
            text(
                """
                UPDATE cast_playback_sessions
                SET revoked_at = COALESCE(revoked_at, :now)
                WHERE session_id = CAST(:session_id AS uuid)
                  AND user_id = :user_id
                RETURNING session_id
                """
            ),
            {"session_id": session_id, "user_id": user_id, "now": now},
        ).scalar_one_or_none()
    return revoked is not None


def cleanup_cast_sessions(*, retention: timedelta = timedelta(days=1)) -> int:
    now = _now()
    cutoff = now - max(retention, timedelta())
    with transaction_scope() as session:
        deleted = session.execute(
            text(
                """
                DELETE FROM cast_playback_sessions
                WHERE expires_at < :cutoff
                   OR (revoked_at IS NOT NULL AND revoked_at < :cutoff)
                RETURNING session_id
                """
            ),
            {"cutoff": cutoff},
        ).all()
    return len(deleted)
