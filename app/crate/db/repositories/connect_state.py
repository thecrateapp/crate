"""Authoritative PlayerState repository for Crate Connect v2."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from redis.exceptions import WatchError
from sqlalchemy import text

from crate.db.cache_runtime import get_redis
from crate.db.repositories.playback_state import upsert_playback_state
from crate.db.tx import read_scope, transaction_scope

PLAYER_STATE_TTL_SECONDS = 24 * 60 * 60
ACTIVE_SESSION_TTL_SECONDS = 5 * 60
_MEM_PLAYER_STATES: dict[int, dict[str, Any]] = {}


class ConnectStateError(RuntimeError):
    pass


class ConnectStaleState(ConnectStateError):
    pass


class ConnectNotActiveInstance(ConnectStateError):
    pass


class ConnectTransferPending(ConnectStateError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _state_key(user_id: int) -> str:
    return f"playerstate:{user_id}"


def _json(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))


def _loads(raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def reset_player_state_cache_for_tests() -> None:
    _MEM_PLAYER_STATES.clear()


def get_player_state(user_id: int) -> dict[str, Any] | None:
    redis_client = get_redis()
    if redis_client is not None:
        try:
            state = _loads(redis_client.get(_state_key(user_id)))
            if state is not None:
                return state
        except Exception:
            pass
    if user_id in _MEM_PLAYER_STATES:
        return dict(_MEM_PLAYER_STATES[user_id])
    return _get_player_state_from_postgres(user_id)


def set_player_state(user_id: int, state: dict[str, Any]) -> dict[str, Any]:
    next_state = _normalize_state(state)
    redis_client = get_redis()
    if redis_client is not None:
        try:
            redis_client.setex(
                _state_key(user_id), PLAYER_STATE_TTL_SECONDS, _json(next_state)
            )
            return next_state
        except Exception:
            pass
    _MEM_PLAYER_STATES[user_id] = dict(next_state)
    return next_state


def update_player_state(
    user_id: int,
    updates: dict[str, Any],
    *,
    expected_version: int | None = None,
    base_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    redis_client = get_redis()
    if redis_client is not None:
        try:
            return _update_player_state_redis(
                user_id,
                updates,
                expected_version=expected_version,
                base_state=base_state,
            )
        except ConnectStaleState:
            raise
        except Exception:
            pass
    current = _MEM_PLAYER_STATES.get(user_id) or base_state or {}
    if (
        expected_version is not None
        and int(current.get("version") or 0) != expected_version
    ):
        raise ConnectStaleState("PlayerState version is stale")
    next_state = _merge_state(current, updates)
    _MEM_PLAYER_STATES[user_id] = dict(next_state)
    return next_state


def assert_active_instance(state: dict[str, Any], instance_id: str) -> None:
    if state.get("active_instance_id") != instance_id:
        raise ConnectNotActiveInstance(
            "Only the active playback instance can update this state"
        )


def assert_no_pending_transfer(state: dict[str, Any]) -> None:
    if state.get("transfer_state") == "pending":
        raise ConnectTransferPending("A playback transfer is already pending")


def flush_player_state_to_postgres(user_id: int) -> None:
    state = get_player_state(user_id)
    if not state:
        return
    now = _now()
    playback_session_id = _session_id(state)
    expires_at = now + timedelta(seconds=ACTIVE_SESSION_TTL_SECONDS)
    active_instance_id = state.get("active_instance_id")
    version = int(state.get("version") or 0)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_active_playback_sessions (
                    user_id, playback_session_id, active_device_id, status,
                    command_seq, state_revision, updated_at, expires_at
                )
                VALUES (
                    :user_id, CAST(:playback_session_id AS uuid), :active_instance_id,
                    :status, :command_seq, :state_revision, :updated_at, :expires_at
                )
                ON CONFLICT (user_id) DO UPDATE SET
                    playback_session_id = EXCLUDED.playback_session_id,
                    active_device_id = EXCLUDED.active_device_id,
                    status = EXCLUDED.status,
                    command_seq = EXCLUDED.command_seq,
                    state_revision = EXCLUDED.state_revision,
                    updated_at = EXCLUDED.updated_at,
                    expires_at = EXCLUDED.expires_at
                """
            ),
            {
                "user_id": user_id,
                "playback_session_id": playback_session_id,
                "active_instance_id": active_instance_id,
                "status": state.get("status") or "paused",
                "command_seq": version,
                "state_revision": state.get("queue_revision"),
                "updated_at": now,
                "expires_at": expires_at,
            },
        )
    active_device_id = state.get("active_device_id")
    if isinstance(active_device_id, str) and active_device_id:
        upsert_playback_state(
            user_id,
            device_id=active_device_id,
            status=str(state.get("status") or "paused"),
            snapshot_kind="structural",
            playback_session_id=playback_session_id,
            track_id=_as_int(
                state.get("track_id") or (state.get("track") or {}).get("id")
            ),
            track_entity_uid=(state.get("track") or {}).get("entity_uid"),
            track_path=(state.get("track") or {}).get("path"),
            title=str(
                (state.get("track") or {}).get("title") or state.get("title") or ""
            ),
            artist=str(
                (state.get("track") or {}).get("artist") or state.get("artist") or ""
            ),
            album=str(
                (state.get("track") or {}).get("album") or state.get("album") or ""
            ),
            album_cover=(state.get("track") or {}).get("album_cover")
            or state.get("album_cover"),
            position_ms=_as_int(state.get("position_ms")) or 0,
            duration_ms=_as_int(
                state.get("duration_ms")
                or (state.get("track") or {}).get("duration_ms")
            ),
            current_index=_as_int(state.get("current_index")) or 0,
            queue_revision=state.get("queue_revision"),
            queue=_as_list(state.get("queue")),
            play_source=state.get("play_source")
            if isinstance(state.get("play_source"), dict)
            else None,
            repeat_mode=str(state.get("repeat") or state.get("repeat_mode") or "off"),
            shuffle=bool(state.get("shuffle")),
            unshuffled_queue=_as_list(state.get("unshuffled_queue"))
            if state.get("unshuffled_queue") is not None
            else None,
        )


def _update_player_state_redis(
    user_id: int,
    updates: dict[str, Any],
    *,
    expected_version: int | None,
    base_state: dict[str, Any] | None,
) -> dict[str, Any]:
    redis_client = get_redis()
    if redis_client is None:
        raise RuntimeError("Redis unavailable")
    key = _state_key(user_id)
    with redis_client.pipeline() as pipe:
        while True:
            try:
                pipe.watch(key)
                current = _loads(pipe.get(key)) or base_state or {}
                if (
                    expected_version is not None
                    and int(current.get("version") or 0) != expected_version
                ):
                    pipe.unwatch()
                    raise ConnectStaleState("PlayerState version is stale")
                next_state = _merge_state(current, updates)
                pipe.multi()
                pipe.setex(key, PLAYER_STATE_TTL_SECONDS, _json(next_state))
                pipe.execute()
                return next_state
            except WatchError:
                continue


def _merge_state(current: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    now = _iso()
    version = int(current.get("version") or 0) + 1
    next_state = {**current, **updates}
    next_state["version"] = version
    next_state["updated_at"] = now
    if "position_ms" in updates:
        next_state["position_updated_at"] = now
    return _normalize_state(next_state)


def _normalize_state(state: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(state)
    normalized.setdefault("version", 0)
    normalized.setdefault("status", "paused")
    normalized.setdefault("position_ms", 0)
    normalized.setdefault("position_updated_at", normalized.get("updated_at") or _iso())
    normalized.setdefault("updated_at", _iso())
    normalized.setdefault("volume", 1)
    normalized.setdefault("queue", [])
    normalized.setdefault("current_index", 0)
    normalized.setdefault("shuffle", False)
    normalized.setdefault("repeat", "off")
    return normalized


def _get_player_state_from_postgres(user_id: int) -> dict[str, Any] | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        s.playback_session_id,
                        s.active_device_id,
                        s.status,
                        s.command_seq,
                        s.state_revision,
                        s.updated_at AS session_updated_at,
                        p.device_id,
                        d.device_label,
                        p.track_id,
                        p.track_entity_uid,
                        p.track_path,
                        p.title,
                        p.artist,
                        p.album,
                        p.album_cover,
                        p.position_ms,
                        p.duration_ms,
                        p.current_index,
                        p.queue_revision,
                        p.queue_json,
                        p.play_source_json,
                        p.repeat_mode,
                        p.shuffle,
                        p.unshuffled_queue_json
                    FROM user_active_playback_sessions s
                    LEFT JOIN user_playback_device_states p
                      ON p.user_id = s.user_id
                     AND p.device_id = s.active_device_id
                    LEFT JOIN user_devices d
                      ON d.user_id = p.user_id
                     AND d.device_id = p.device_id
                    WHERE s.user_id = :user_id
                      AND (s.expires_at IS NULL OR s.expires_at > NOW())
                    LIMIT 1
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    data = dict(row)
    track = {
        "id": data.get("track_id"),
        "entity_uid": str(data.get("track_entity_uid"))
        if data.get("track_entity_uid")
        else None,
        "path": data.get("track_path"),
        "title": data.get("title") or "",
        "artist": data.get("artist") or "",
        "album": data.get("album") or "",
        "album_cover": data.get("album_cover"),
        "duration_ms": data.get("duration_ms"),
    }
    updated_at = data.get("session_updated_at")
    updated_iso = updated_at.isoformat() if isinstance(updated_at, datetime) else _iso()
    return _normalize_state(
        {
            "session_id": str(data.get("playback_session_id")),
            "active_instance_id": data.get("active_device_id"),
            "active_device_id": data.get("device_id") or data.get("active_device_id"),
            "active_device_label": data.get("device_label"),
            "status": data.get("status") or "paused",
            "track": track,
            "position_ms": data.get("position_ms") or 0,
            "position_updated_at": updated_iso,
            "duration_ms": data.get("duration_ms"),
            "current_index": data.get("current_index") or 0,
            "queue_revision": data.get("queue_revision") or data.get("state_revision"),
            "queue": _coerce_json(data.get("queue_json"), []),
            "play_source": _coerce_json(data.get("play_source_json"), None),
            "repeat": data.get("repeat_mode") or "off",
            "shuffle": bool(data.get("shuffle")),
            "unshuffled_queue": _coerce_json(data.get("unshuffled_queue_json"), None),
            "updated_at": updated_iso,
            "version": int(data.get("command_seq") or 0),
        }
    )


def _session_id(state: dict[str, Any]) -> str:
    value = state.get("session_id") or state.get("playback_session_id")
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        generated = str(uuid.uuid4())
        state["session_id"] = generated
        return generated


def _coerce_json(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]
