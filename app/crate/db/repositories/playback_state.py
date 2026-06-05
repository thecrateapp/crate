from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from crate.db.cache_store import get_cache, set_cache
from crate.db.tx import optional_scope, read_scope

PLAYBACK_STATE_TTL_DAYS = 30
ACTIVE_DEVICE_WINDOW_SECONDS = 90
MAX_QUEUE_SNAPSHOT_TRACKS = 500

_QUEUE_ITEM_KEYS = {
    "track_id",
    "track_entity_uid",
    "entity_uid",
    "path",
    "title",
    "artist",
    "album",
    "duration",
    "album_cover",
    "albumCover",
    "libraryTrackId",
}
_SENSITIVE_JSON_KEYS = {
    "authorization",
    "jwt",
    "playback_url",
    "refresh_token",
    "stream_url",
    "token",
}


def _presence_key(user_id: int, device_id: str) -> str:
    return f"connect:presence:{user_id}:{device_id}"


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


def _drop_sensitive_json(value: Any) -> Any:
    if isinstance(value, list):
        return [_drop_sensitive_json(item) for item in value]
    if not isinstance(value, dict):
        return value
    clean: dict[str, Any] = {}
    for key, item in value.items():
        normalized = str(key).lower()
        if normalized in _SENSITIVE_JSON_KEYS or "token" in normalized:
            continue
        clean[key] = _drop_sensitive_json(item)
    return clean


def sanitize_queue_snapshot(queue: list[dict[str, Any]]) -> list[dict[str, Any]]:
    clean: list[dict[str, Any]] = []
    for item in queue[:MAX_QUEUE_SNAPSHOT_TRACKS]:
        if not isinstance(item, dict):
            continue
        next_item = {
            key: _drop_sensitive_json(value)
            for key, value in item.items()
            if key in _QUEUE_ITEM_KEYS
        }
        if "track_entity_uid" not in next_item and "entity_uid" in next_item:
            next_item["track_entity_uid"] = next_item.pop("entity_uid")
        if "album_cover" not in next_item and "albumCover" in next_item:
            next_item["album_cover"] = next_item.pop("albumCover")
        if "track_id" not in next_item and "libraryTrackId" in next_item:
            next_item["track_id"] = next_item.pop("libraryTrackId")
        clean.append(next_item)
    return clean


def _device_from_row(
    row: dict[str, Any] | None, *, active: bool | None = None
) -> dict | None:
    if not row:
        return None
    last_seen_at = row.get("last_seen_at")
    resolved_active = False
    if active is not None:
        resolved_active = active
    elif isinstance(last_seen_at, datetime):
        resolved_active = (_now() - last_seen_at) <= timedelta(
            seconds=ACTIVE_DEVICE_WINDOW_SECONDS
        )
    return {
        "device_id": row.get("device_id"),
        "device_label": row.get("device_label"),
        "device_type": row.get("device_type"),
        "app_platform": row.get("app_platform"),
        "app_version": row.get("app_version"),
        "capabilities": _coerce_json(row.get("capabilities_json")) or {},
        "last_session_id": row.get("last_session_id"),
        "last_seen_at": last_seen_at,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "revoked_at": row.get("revoked_at"),
        "active": resolved_active,
    }


def _state_from_row(row: dict[str, Any] | None) -> dict | None:
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


def upsert_device(
    user_id: int,
    *,
    device_id: str,
    device_label: str | None = None,
    device_type: str | None = None,
    app_platform: str | None = None,
    app_version: str | None = None,
    capabilities: dict[str, Any] | None = None,
    session_id: str | None = None,
    touch_presence: bool = True,
    session=None,
) -> dict:
    now = _now()
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                    INSERT INTO user_devices (
                        user_id, device_id, device_label, device_type,
                        app_platform, app_version, capabilities_json,
                        last_session_id, last_seen_at, updated_at, revoked_at
                    )
                    VALUES (
                        :user_id, :device_id, :device_label, :device_type,
                        :app_platform, :app_version,
                        CAST(:capabilities_json AS jsonb),
                        :session_id, :now, :now, NULL
                    )
                    ON CONFLICT (user_id, device_id) DO UPDATE SET
                        device_label = COALESCE(EXCLUDED.device_label, user_devices.device_label),
                        device_type = COALESCE(EXCLUDED.device_type, user_devices.device_type),
                        app_platform = COALESCE(EXCLUDED.app_platform, user_devices.app_platform),
                        app_version = COALESCE(EXCLUDED.app_version, user_devices.app_version),
                        capabilities_json = CASE
                            WHEN :has_capabilities THEN EXCLUDED.capabilities_json
                            ELSE user_devices.capabilities_json
                        END,
                        last_session_id = COALESCE(EXCLUDED.last_session_id, user_devices.last_session_id),
                        last_seen_at = CASE
                            WHEN :touch_presence THEN EXCLUDED.last_seen_at
                            ELSE user_devices.last_seen_at
                        END,
                        updated_at = EXCLUDED.updated_at,
                        revoked_at = NULL
                    RETURNING *
                    """
                ),
                {
                    "user_id": user_id,
                    "device_id": device_id,
                    "device_label": device_label,
                    "device_type": device_type,
                    "app_platform": app_platform,
                    "app_version": app_version,
                    "capabilities_json": _json(capabilities or {}),
                    "has_capabilities": capabilities is not None,
                    "session_id": session_id,
                    "now": now,
                    "touch_presence": touch_presence,
                },
            )
            .mappings()
            .first()
        )
        device = _device_from_row(dict(row) if row else None)
        if device is None:
            raise RuntimeError("Failed to upsert device")
        return device


def list_devices(user_id: int, *, include_revoked: bool = False) -> list[dict]:
    with read_scope() as session:
        stmt = """
            SELECT *
            FROM user_devices
            WHERE user_id = :user_id
        """
        if not include_revoked:
            stmt += " AND revoked_at IS NULL"
        stmt += " ORDER BY COALESCE(last_seen_at, updated_at, created_at) DESC"
        rows = session.execute(text(stmt), {"user_id": user_id}).mappings().all()
        devices: list[dict] = []
        for row in rows:
            data = dict(row)
            presence = get_cache(
                _presence_key(user_id, data["device_id"]),
                max_age_seconds=ACTIVE_DEVICE_WINDOW_SECONDS,
            )
            device = _device_from_row(data, active=presence is not None)
            if device is not None:
                devices.append(device)
        return devices


def mark_device_present(
    user_id: int,
    *,
    device_id: str,
    device_label: str | None = None,
    device_type: str | None = None,
    app_platform: str | None = None,
    app_version: str | None = None,
    capabilities: dict[str, Any] | None = None,
    session_id: str | None = None,
) -> dict:
    device = upsert_device(
        user_id,
        device_id=device_id,
        device_label=device_label,
        device_type=device_type,
        app_platform=app_platform,
        app_version=app_version,
        capabilities=capabilities,
        session_id=session_id,
        touch_presence=True,
    )
    set_cache(
        _presence_key(user_id, device_id),
        {"device_id": device_id, "seen_at": _now().isoformat()},
        ttl=ACTIVE_DEVICE_WINDOW_SECONDS,
    )
    device["active"] = True
    return device


def revoke_device(user_id: int, device_id: str, *, session=None) -> bool:
    now = _now()
    with optional_scope(session) as s:
        result = s.execute(
            text(
                """
                UPDATE user_devices
                SET revoked_at = :now, updated_at = :now
                WHERE user_id = :user_id
                  AND device_id = :device_id
                  AND revoked_at IS NULL
                """
            ),
            {"user_id": user_id, "device_id": device_id, "now": now},
        )
        s.execute(
            text(
                """
                WITH target_device AS (
                    SELECT last_session_id
                    FROM user_devices
                    WHERE user_id = :user_id
                      AND device_id = :device_id
                )
                UPDATE sessions
                SET revoked_at = :now
                WHERE user_id = :user_id
                  AND revoked_at IS NULL
                  AND (
                    id = (SELECT last_session_id FROM target_device)
                    OR device_fingerprint = :device_id
                  )
                """
            ),
            {"user_id": user_id, "device_id": device_id, "now": now},
        )
        s.execute(
            text(
                """
                DELETE FROM user_playback_device_states
                WHERE user_id = :user_id AND device_id = :device_id
                """
            ),
            {"user_id": user_id, "device_id": device_id},
        )
        return bool(getattr(result, "rowcount", 0))


def upsert_playback_state(
    user_id: int,
    *,
    device_id: str,
    status: str,
    snapshot_kind: str = "light",
    playback_session_id: str | None = None,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    track_path: str | None = None,
    title: str = "",
    artist: str = "",
    album: str = "",
    album_cover: str | None = None,
    position_ms: int = 0,
    duration_ms: int | None = None,
    current_index: int = 0,
    queue_revision: str | None = None,
    queue: list[dict[str, Any]] | None = None,
    play_source: dict[str, Any] | None = None,
    repeat_mode: str = "off",
    shuffle: bool = False,
    unshuffled_queue: list[dict[str, Any]] | None = None,
    playback_rate: float = 1,
    app_platform: str | None = None,
    device_type: str | None = None,
    expires_at: datetime | None = None,
    session=None,
) -> dict:
    now = _now()
    update_structure = (
        snapshot_kind == "structural"
        or bool(queue)
        or play_source is not None
        or unshuffled_queue is not None
    )
    sanitized_queue = sanitize_queue_snapshot(queue or [])
    sanitized_unshuffled = (
        sanitize_queue_snapshot(unshuffled_queue)
        if unshuffled_queue is not None
        else None
    )
    sanitized_play_source = _drop_sensitive_json(play_source) if play_source else None
    expires_at = expires_at or now + timedelta(days=PLAYBACK_STATE_TTL_DAYS)

    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                    INSERT INTO user_playback_device_states (
                        user_id, device_id, playback_session_id, status,
                        track_id, track_entity_uid, track_path,
                        title, artist, album, album_cover,
                        position_ms, duration_ms, current_index, queue_revision,
                        queue_json, play_source_json, repeat_mode, shuffle,
                        unshuffled_queue_json, playback_rate, app_platform,
                        device_type, updated_at, expires_at
                    )
                    VALUES (
                        :user_id, :device_id, CAST(:playback_session_id AS uuid), :status,
                        :track_id, CAST(:track_entity_uid AS uuid), :track_path,
                        :title, :artist, :album, :album_cover,
                        :position_ms, :duration_ms, :current_index, :queue_revision,
                        CAST(:queue_json AS jsonb), CAST(:play_source_json AS jsonb),
                        :repeat_mode, :shuffle, CAST(:unshuffled_queue_json AS jsonb),
                        :playback_rate, :app_platform, :device_type, :now, :expires_at
                    )
                    ON CONFLICT (user_id, device_id) DO UPDATE SET
                        playback_session_id = EXCLUDED.playback_session_id,
                        status = EXCLUDED.status,
                        track_id = EXCLUDED.track_id,
                        track_entity_uid = EXCLUDED.track_entity_uid,
                        track_path = EXCLUDED.track_path,
                        title = EXCLUDED.title,
                        artist = EXCLUDED.artist,
                        album = EXCLUDED.album,
                        album_cover = EXCLUDED.album_cover,
                        position_ms = EXCLUDED.position_ms,
                        duration_ms = EXCLUDED.duration_ms,
                        current_index = EXCLUDED.current_index,
                        queue_revision = COALESCE(EXCLUDED.queue_revision, user_playback_device_states.queue_revision),
                        queue_json = CASE
                            WHEN :update_structure THEN EXCLUDED.queue_json
                            ELSE user_playback_device_states.queue_json
                        END,
                        play_source_json = CASE
                            WHEN :update_structure THEN EXCLUDED.play_source_json
                            ELSE user_playback_device_states.play_source_json
                        END,
                        repeat_mode = EXCLUDED.repeat_mode,
                        shuffle = EXCLUDED.shuffle,
                        unshuffled_queue_json = CASE
                            WHEN :update_structure THEN EXCLUDED.unshuffled_queue_json
                            ELSE user_playback_device_states.unshuffled_queue_json
                        END,
                        playback_rate = EXCLUDED.playback_rate,
                        app_platform = COALESCE(EXCLUDED.app_platform, user_playback_device_states.app_platform),
                        device_type = COALESCE(EXCLUDED.device_type, user_playback_device_states.device_type),
                        updated_at = EXCLUDED.updated_at,
                        expires_at = EXCLUDED.expires_at
                    RETURNING
                        user_playback_device_states.*,
                        (
                            SELECT device_label
                            FROM user_devices
                            WHERE user_devices.user_id = user_playback_device_states.user_id
                              AND user_devices.device_id = user_playback_device_states.device_id
                        ) AS device_label
                    """
                ),
                {
                    "user_id": user_id,
                    "device_id": device_id,
                    "playback_session_id": playback_session_id,
                    "status": status,
                    "track_id": track_id,
                    "track_entity_uid": track_entity_uid,
                    "track_path": track_path,
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "album_cover": album_cover,
                    "position_ms": max(0, position_ms),
                    "duration_ms": duration_ms,
                    "current_index": max(0, current_index),
                    "queue_revision": queue_revision,
                    "queue_json": _json(sanitized_queue),
                    "play_source_json": _json(sanitized_play_source),
                    "repeat_mode": repeat_mode,
                    "shuffle": shuffle,
                    "unshuffled_queue_json": _json(sanitized_unshuffled),
                    "playback_rate": playback_rate,
                    "app_platform": app_platform,
                    "device_type": device_type,
                    "now": now,
                    "expires_at": expires_at,
                    "update_structure": update_structure,
                },
            )
            .mappings()
            .first()
        )
        state = _state_from_row(dict(row) if row else None)
        if state is None:
            raise RuntimeError("Failed to upsert playback state")
        return state


def get_resume_candidate(
    user_id: int, *, device_id: str | None = None, include_current_device: bool = False
) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT s.*, d.device_label
                    FROM user_playback_device_states s
                    JOIN user_devices d
                      ON d.user_id = s.user_id
                     AND d.device_id = s.device_id
                    WHERE s.user_id = :user_id
                      AND d.revoked_at IS NULL
                      AND (s.expires_at IS NULL OR s.expires_at > NOW())
                      AND (:include_current_device OR :device_id IS NULL OR s.device_id != :device_id)
                      AND s.status != 'stopped'
                    ORDER BY
                        CASE
                            WHEN s.status = 'playing'
                             AND s.updated_at >= NOW() - INTERVAL '90 seconds'
                            THEN 0
                            ELSE 1
                        END,
                        s.updated_at DESC
                    LIMIT 1
                    """
                ),
                {
                    "user_id": user_id,
                    "device_id": device_id,
                    "include_current_device": include_current_device,
                },
            )
            .mappings()
            .first()
        )
    state = _state_from_row(dict(row) if row else None)
    if not state:
        return None
    return project_live_position(state)


def project_live_position(state: dict) -> dict:
    projected = dict(state)
    if projected.get("status") != "playing":
        return projected
    updated_at = projected.get("updated_at")
    if not isinstance(updated_at, datetime):
        return projected
    elapsed_ms = max(0, int((_now() - updated_at).total_seconds() * 1000))
    rate = float(projected.get("playback_rate") or 1)
    position_ms = int(projected.get("position_ms") or 0) + int(elapsed_ms * rate)
    duration_ms = projected.get("duration_ms")
    if isinstance(duration_ms, int) and duration_ms > 0:
        position_ms = min(position_ms, duration_ms)
    projected["position_ms"] = max(0, position_ms)
    return projected


def clear_playback_state(
    user_id: int, *, device_id: str, clear_queue: bool = True, session=None
) -> bool:
    now = _now()
    with optional_scope(session) as s:
        result = s.execute(
            text(
                """
                UPDATE user_playback_device_states
                SET status = 'stopped',
                    position_ms = 0,
                    queue_json = CASE WHEN :clear_queue THEN '[]'::jsonb ELSE queue_json END,
                    unshuffled_queue_json = CASE WHEN :clear_queue THEN NULL ELSE unshuffled_queue_json END,
                    updated_at = :now
                WHERE user_id = :user_id AND device_id = :device_id
                """
            ),
            {
                "user_id": user_id,
                "device_id": device_id,
                "clear_queue": clear_queue,
                "now": now,
            },
        )
        return bool(getattr(result, "rowcount", 0))
