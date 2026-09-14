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
        "last_mutation_id": row.get("last_mutation_id"),
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
    _validate_cursor(queue, current_index)
    if current_time < 0:
        raise ValueError("Cast current_time must be non-negative")
    if revision < 0:
        raise ValueError("Cast revision must be non-negative")

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
    current_index: int,
    current_time: float = 0,
    repeat_mode: str = "off",
    shuffle: bool = False,
) -> dict | None:
    _validate_cursor(queue, current_index)
    if expected_revision < 0 or current_time < 0 or not mutation_id:
        raise ValueError("Invalid Cast queue mutation")
    now = _now()
    values = {
        "session_id": session_id,
        "user_id": user_id,
        "expected_revision": expected_revision,
        "mutation_id": mutation_id,
        "queue_json": _json(queue),
        "current_index": current_index,
        "current_time": float(current_time),
        "repeat_mode": _normalize_repeat_mode(repeat_mode),
        "shuffle": bool(shuffle),
        "now": now,
        "idle_cutoff": now - CAST_SESSION_IDLE_TTL,
    }
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    UPDATE cast_playback_sessions
                    SET queue_json = CAST(:queue_json AS jsonb),
                        current_index = :current_index,
                        position_seconds = :current_time,
                        repeat_mode = :repeat_mode,
                        shuffle = :shuffle,
                        revision = revision + 1,
                        last_mutation_id = :mutation_id,
                        last_used_at = :now
                    WHERE session_id = CAST(:session_id AS uuid)
                      AND user_id = :user_id
                      AND revision = :expected_revision
                      AND {_active_session_predicate()}
                    RETURNING *
                    """
                ),
                values,
            )
            .mappings()
            .first()
        )
        if row:
            result = _session_from_row(dict(row))
            return {**result, "mutation_status": "applied"}

        current_row = (
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
                values,
            )
            .mappings()
            .first()
        )
        if not current_row:
            return None
        current = _session_from_row(dict(current_row))
        status = (
            "duplicate"
            if current and current["last_mutation_id"] == mutation_id
            else "conflict"
        )
        return {**current, "mutation_status": status}


def revoke_cast_session(user_id: int, session_id: str) -> bool:
    now = _now()
    with transaction_scope() as session:
        revoked = session.execute(
            text(
                """
                UPDATE cast_playback_sessions
                SET revoked_at = :now
                WHERE session_id = CAST(:session_id AS uuid)
                  AND user_id = :user_id
                  AND revoked_at IS NULL
                RETURNING session_id
                """
            ),
            {"session_id": session_id, "user_id": user_id, "now": now},
        ).scalar_one_or_none()
    return revoked is not None
