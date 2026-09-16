"""OpenSubsonic scrobbling and ephemeral now-playing state."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.cache_store import delete_cache, set_cache
from crate.db.cache_runtime import get_redis
from crate.db.queries.subsonic_global import get_global_track
from crate.db.queries.subsonic_track_queries import get_track_full
from crate.db.repositories.user_library_playback_writes import record_play_event
from crate.db.tx import read_scope
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.global_ids import (
    SubsonicEntityId,
    SubsonicIdError,
    decode_subsonic_id,
    global_subsonic_id,
    local_subsonic_id,
)
from crate.subsonic.params import RequestParameters
from crate.subsonic.serializers import serialize_song

log = logging.getLogger(__name__)

_NOW_PLAYING_PREFIX = "cache:now_playing:"
_NOW_PLAYING_TTL_FALLBACK = 900
_NOW_PLAYING_TTL_MAX = 21600


def _parse_submission(params: RequestParameters) -> bool:
    value = (params.first("submission", "true") or "true").strip().lower()
    if value in {"true", "1"}:
        return True
    if value in {"false", "0"}:
        return False
    raise OpenSubsonicError(
        ErrorCode.MISSING_PARAMETER, "Invalid parameter 'submission'"
    )


def _parse_timestamp(value: str | None, *, fallback: datetime) -> datetime | None:
    if value is None or not value.strip():
        return fallback
    try:
        milliseconds = int(value)
        if milliseconds <= 0:
            return None
        return datetime.fromtimestamp(milliseconds / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _track_for_subsonic_id(value: str) -> tuple[SubsonicEntityId, dict] | None:
    try:
        entity_id = decode_subsonic_id(value, expected_kind="track")
    except SubsonicIdError:
        return None

    if entity_id.scope == "global":
        track = get_global_track(str(entity_id.global_uid))
    else:
        track = get_track_full(int(entity_id.local_id or 0))
    return (entity_id, track) if track else None


def _playback_provenance(
    entity_id: SubsonicEntityId, user_id: int
) -> tuple[str, str | None]:
    if entity_id.scope == "local":
        from crate.playback_provenance import resolve_local_content_provenance

        return resolve_local_content_provenance(int(entity_id.local_id or 0))

    from crate.federation.playback_service import get_remembered_source

    source = get_remembered_source(user_id, str(entity_id.global_uid))
    if source:
        return (
            str(source.get("content_origin") or "local"),
            source.get("source_node_uid"),
        )

    from crate.federation.global_playback import resolve_global_track_playback

    selected = resolve_global_track_playback(str(entity_id.global_uid))
    if selected["kind"] == "remote":
        return "remote", str(selected["node_uid"])

    from crate.playback_provenance import resolve_local_content_provenance

    return resolve_local_content_provenance(selected.get("local_track_id"))


def _event_client_id(
    *, user_id: int, track_id: str, timestamp: datetime, index: int, explicit_time: bool
) -> str:
    event_millis = int(timestamp.timestamp() * 1000)
    if not explicit_time:
        # Clients may omit time. A stable short bucket still makes near-immediate
        # transport retries idempotent without suppressing normal track replays.
        event_millis = (event_millis // 60_000) * 60_000
    identity = f"subsonic:{user_id}:{track_id}:{event_millis}:{index if not explicit_time else ''}"
    return hashlib.sha256(identity.encode()).hexdigest()


def _set_now_playing(
    user: dict, subsonic_id: str, track: dict, started_at: datetime
) -> None:
    duration = max(0, int(float(track.get("duration") or 0)))
    ttl = min(
        _NOW_PLAYING_TTL_MAX,
        duration + 120 if duration else _NOW_PLAYING_TTL_FALLBACK,
    )
    user_id = int(user["id"])
    set_cache(
        f"now_playing:{user_id}",
        {
            "track_id": track.get("id"),
            "global_track_uid": track.get("global_track_uid"),
            "track_entity_uid": track.get("entity_uid"),
            "subsonic_id": subsonic_id,
            "title": str(track.get("title") or ""),
            "artist": str(track.get("artist") or ""),
            "album": str(track.get("album") or ""),
            "started_at": started_at.isoformat(),
            "heartbeat_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": (started_at + timedelta(seconds=ttl)).isoformat(),
            "device_type": "subsonic",
            "app_platform": "subsonic",
        },
        ttl=ttl,
    )


def scrobble(params: RequestParameters, user: dict) -> None:
    """Record repeated scrobble items or update shared now-playing state."""
    submission = _parse_submission(params)
    ids = params.get_all("id")
    times = params.get_all("time")
    if not ids:
        raise OpenSubsonicError(
            ErrorCode.MISSING_PARAMETER, "Required parameter 'id' is missing"
        )

    user_id = int(user["id"])
    now = datetime.now(timezone.utc)
    if not submission:
        # Scrobble's now-playing form represents a single active track per user,
        # matching the native Listen presence key.
        for index, raw_id in enumerate(ids):
            timestamp = _parse_timestamp(
                times[index] if index < len(times) else None, fallback=now
            )
            if timestamp is None:
                continue
            resolved = _track_for_subsonic_id(raw_id)
            if not resolved:
                continue
            _, track = resolved
            _set_now_playing(user, raw_id, track, timestamp)
            break
        return

    delete_cache(f"now_playing:{user_id}")
    for index, raw_id in enumerate(ids):
        has_timestamp = index < len(times) and bool(times[index].strip())
        timestamp = _parse_timestamp(
            times[index] if index < len(times) else None, fallback=now
        )
        if timestamp is None:
            continue
        resolved = _track_for_subsonic_id(raw_id)
        if not resolved:
            continue
        entity_id, track = resolved
        content_origin, source_node_uid = _playback_provenance(entity_id, user_id)
        duration = float(track.get("duration") or 0)
        started_at = timestamp - timedelta(seconds=duration)
        client_event_id = _event_client_id(
            user_id=user_id,
            track_id=raw_id,
            timestamp=timestamp,
            index=index,
            explicit_time=has_timestamp,
        )
        record_play_event(
            user_id,
            client_event_id=client_event_id,
            track_id=int(entity_id.local_id) if entity_id.scope == "local" else None,
            global_track_uid=(
                str(entity_id.global_uid) if entity_id.scope == "global" else None
            ),
            title=str(track.get("title") or ""),
            artist=str(track.get("artist") or ""),
            album=str(track.get("album") or ""),
            started_at=started_at.isoformat(),
            ended_at=timestamp.isoformat(),
            played_seconds=duration,
            track_duration_seconds=duration or None,
            completion_ratio=1.0 if duration else None,
            was_completed=True,
            play_source_type="subsonic",
            play_source_id=raw_id,
            play_source_name="Open Subsonic",
            device_type="subsonic",
            app_platform="subsonic",
            content_origin=content_origin,
            source_node_uid=source_node_uid,
        )


def _read_active_now_playing() -> list[tuple[int, dict]]:
    redis_client = get_redis()
    if redis_client:
        try:
            keys = list(
                redis_client.scan_iter(match=f"{_NOW_PLAYING_PREFIX}*", count=100)
            )
            if not keys:
                return []
            values = redis_client.mget(keys)
            active = []
            for key, value in zip(keys, values, strict=False):
                if not value:
                    continue
                try:
                    user_id = int(str(key).rsplit(":", 1)[-1])
                    payload = json.loads(value) if isinstance(value, str) else value
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                if isinstance(payload, dict):
                    active.append((user_id, payload))
            return active
        except Exception:
            log.debug("Could not read now-playing cache from Redis", exc_info=True)

    try:
        with read_scope() as session:
            rows = (
                session.execute(
                    text(
                        """
                        SELECT key, value_json
                        FROM cache
                        WHERE key LIKE 'now_playing:%'
                          AND updated_at >= NOW() - INTERVAL '7 hours'
                        """
                    )
                )
                .mappings()
                .all()
            )
        active = []
        for row in rows:
            try:
                user_id = int(str(row["key"]).rsplit(":", 1)[-1])
                payload = row["value_json"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict):
                active.append((user_id, payload))
        return active
    except Exception:
        log.debug("Could not read now-playing cache from PostgreSQL", exc_info=True)
        return []


def _get_usernames(user_ids: list[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT id, COALESCE(username, email) AS username
                    FROM users
                    WHERE id = ANY(:user_ids)
                      AND status = 'active'
                      AND deleted_at IS NULL
                    """
                ),
                {"user_ids": user_ids},
            )
            .mappings()
            .all()
        )
    return {int(row["id"]): str(row["username"] or "") for row in rows}


def _is_active(payload: dict, *, now: datetime) -> bool:
    expiry = payload.get("expires_at")
    if expiry:
        try:
            expires_at = datetime.fromisoformat(str(expiry))
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            return expires_at > now
        except ValueError:
            return False

    updated = payload.get("heartbeat_at") or payload.get("started_at")
    if not updated:
        return False
    try:
        updated_at = datetime.fromisoformat(str(updated))
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return now - updated_at <= timedelta(seconds=90)


def get_now_playing_entries(*, now: datetime | None = None) -> list[dict]:
    current_time = now or datetime.now(timezone.utc)
    states = [
        (user_id, payload)
        for user_id, payload in _read_active_now_playing()
        if _is_active(payload, now=current_time)
    ]
    if not states:
        return []
    usernames = _get_usernames(list({user_id for user_id, _ in states}))
    entries = []
    for user_id, payload in states:
        username = usernames.get(user_id)
        raw_id = payload.get("subsonic_id")
        if not raw_id and payload.get("global_track_uid"):
            raw_id = global_subsonic_id("track", str(payload["global_track_uid"]))
        elif not raw_id and payload.get("track_id") is not None:
            raw_id = local_subsonic_id("track", int(payload["track_id"]))
        if not username or not raw_id:
            continue
        resolved = _track_for_subsonic_id(str(raw_id))
        if not resolved:
            continue
        _, track = resolved
        entry = serialize_song(track)
        activity_at = payload.get("heartbeat_at") or payload.get("started_at")
        try:
            updated_at = datetime.fromisoformat(str(activity_at))
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        entry.update(
            {
                "username": username,
                "minutesAgo": max(
                    0, int((current_time - updated_at).total_seconds() / 60)
                ),
                "playerId": user_id,
                "playerName": str(payload.get("app_platform") or "Open Subsonic"),
                "state": "playing",
            }
        )
        if payload.get("position_ms") is not None:
            try:
                entry["positionMs"] = max(0, int(payload["position_ms"]))
            except (TypeError, ValueError):
                pass
        entries.append(entry)
    return entries
