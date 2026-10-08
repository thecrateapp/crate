"""OpenSubsonic play queues backed by Crate's per-user playback state."""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any
from uuid import uuid4

from crate.db.repositories.playback_state import (
    MAX_QUEUE_SNAPSHOT_TRACKS,
    clear_playback_state,
    get_device_playback_state,
    upsert_device,
    upsert_playback_state,
)
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.global_ids import decode_subsonic_id, encode_subsonic_id
from crate.subsonic.params import RequestParameters
from crate.subsonic.serializers import serialize_song
from crate.subsonic.services.playback import _track_for_subsonic_id

QUEUE_DEVICE_ID = "opensubsonic"
MAX_QUEUE_TRACKS = MAX_QUEUE_SNAPSHOT_TRACKS
MAX_POSITION_MS = 24 * 60 * 60 * 1000


def _invalid_parameter(name: str) -> OpenSubsonicError:
    return OpenSubsonicError(ErrorCode.MISSING_PARAMETER, f"Invalid parameter '{name}'")


def _parse_nonnegative_int(
    params: RequestParameters, name: str, *, default: int | None = None
) -> int:
    raw = params.first(name)
    if raw is None and default is not None:
        return default
    try:
        value = int(raw or "")
    except (TypeError, ValueError) as exc:
        raise _invalid_parameter(name) from exc
    if value < 0:
        raise _invalid_parameter(name)
    return value


def _client_name(params: RequestParameters) -> str:
    value = (params.first("c") or "OpenSubsonic").strip()
    return value[:64] or "OpenSubsonic"


def _track_duration_ms(track: dict[str, Any]) -> int:
    try:
        duration = float(track.get("duration") or 0)
    except (TypeError, ValueError):
        return 0
    if not isfinite(duration) or duration <= 0:
        return 0
    return min(MAX_POSITION_MS, round(duration * 1000))


def _position_ms(raw_position: int, track: dict[str, Any]) -> int:
    maximum = _track_duration_ms(track) or MAX_POSITION_MS
    return min(raw_position, maximum)


def _resolve_queue(ids: tuple[str, ...]) -> list[tuple[str, dict[str, Any]]]:
    if len(ids) > MAX_QUEUE_TRACKS:
        raise OpenSubsonicError(
            ErrorCode.GENERIC,
            f"Play queue exceeds the maximum of {MAX_QUEUE_TRACKS} tracks",
        )

    cache: dict[str, tuple[str, dict[str, Any]] | None] = {}
    resolved: list[tuple[str, dict[str, Any]]] = []
    for raw_id in ids:
        track_id = raw_id.strip()
        if track_id not in cache:
            track = _track_for_subsonic_id(track_id)
            if track is None:
                cache[track_id] = None
            else:
                entity_id, metadata = track
                stable_id = (
                    encode_subsonic_id(entity_id) if entity_id is not None else track_id
                )
                cache[track_id] = (stable_id, metadata)
        item = cache[track_id]
        if item is None:
            raise OpenSubsonicError(
                ErrorCode.NOT_FOUND, f"Track '{track_id}' is not available"
            )
        resolved.append(item)
    return resolved


def _queue_item(track_id: str, track: dict[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = {
        "subsonic_id": track_id,
        "title": str(track.get("title") or ""),
        "artist": str(track.get("artist") or ""),
        "album": str(track.get("album") or ""),
    }
    for key in ("track_id", "entity_uid", "album_cover"):
        if track.get(key) is not None:
            item[key] = track[key]
    if track.get("duration") is not None:
        item["duration"] = track["duration"]
    return item


def _current_track_id(track_id: str, track: dict[str, Any]) -> int | None:
    try:
        entity_id = decode_subsonic_id(track_id, expected_kind="track")
    except ValueError:
        entity_id = None
    if entity_id is not None:
        return entity_id.local_id if entity_id.scope == "local" else None
    local_id = track.get("track_id", track.get("id"))
    try:
        return int(local_id) if local_id is not None else None
    except (TypeError, ValueError):
        return None


def save_play_queue(
    params: RequestParameters, user: dict[str, Any], *, by_index: bool
) -> None:
    """Replace or clear the user's queue; the last committed update wins."""
    ids = params.get_all("id")
    user_id = int(user["id"])
    if not ids:
        clear_playback_state(user_id, device_id=QUEUE_DEVICE_ID)
        return

    if len(ids) > MAX_QUEUE_TRACKS:
        raise OpenSubsonicError(
            ErrorCode.GENERIC,
            f"Play queue exceeds the maximum of {MAX_QUEUE_TRACKS} tracks",
        )

    current_index: int | None = None
    canonical_current: str | None = None
    if by_index:
        if not params.contains("currentIndex"):
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER,
                "Required parameter 'currentIndex' is missing",
            )
        current_index = _parse_nonnegative_int(params, "currentIndex")
        if current_index >= len(ids):
            raise _invalid_parameter("currentIndex")
    else:
        current = (params.first("current") or "").strip()
        if not current:
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER,
                "Required parameter 'current' is missing",
            )
        canonical_current = current
        try:
            canonical_current = encode_subsonic_id(
                decode_subsonic_id(current, expected_kind="track")
            )
        except ValueError:
            pass
    position = _parse_nonnegative_int(params, "position", default=0)
    queue = _resolve_queue(ids)
    if current_index is None:
        matches = [
            index for index, item in enumerate(queue) if item[0] == canonical_current
        ]
        if not matches:
            raise OpenSubsonicError(
                ErrorCode.NOT_FOUND, "Current track is not in the play queue"
            )
        current_index = matches[0]

    current_id, current_track = queue[current_index]
    position = _position_ms(position, current_track)
    client = _client_name(params)
    upsert_device(
        user_id,
        device_id=QUEUE_DEVICE_ID,
        device_label=client,
        device_type="subsonic",
        app_platform=client,
        touch_presence=False,
    )
    upsert_playback_state(
        user_id,
        device_id=QUEUE_DEVICE_ID,
        snapshot_kind="structural",
        status="paused",
        track_id=_current_track_id(current_id, current_track),
        track_entity_uid=current_track.get("entity_uid"),
        title=str(current_track.get("title") or ""),
        artist=str(current_track.get("artist") or ""),
        album=str(current_track.get("album") or ""),
        position_ms=position,
        duration_ms=_track_duration_ms(current_track) or None,
        current_index=current_index,
        queue_revision=str(uuid4()),
        queue=[_queue_item(track_id, track) for track_id, track in queue],
        app_platform=client,
        device_type="subsonic",
    )


def get_play_queue(user: dict[str, Any], *, by_index: bool) -> dict[str, Any]:
    """Restore a queue, dropping tracks that are no longer accessible."""
    user_id = int(user["id"])
    state = get_device_playback_state(user_id, device_id=QUEUE_DEVICE_ID)
    raw_queue = state.get("queue", []) if state else []
    if not isinstance(raw_queue, list):
        raw_queue = []

    cached: dict[str, tuple[dict[str, Any], dict[str, Any]] | None] = {}
    entries: list[tuple[int, str, dict[str, Any], dict[str, Any]]] = []
    for original_index, raw_item in enumerate(raw_queue[:MAX_QUEUE_TRACKS]):
        if not isinstance(raw_item, dict):
            continue
        track_id = str(raw_item.get("subsonic_id") or "").strip()
        if not track_id:
            continue
        if track_id not in cached:
            resolved = _track_for_subsonic_id(track_id)
            if resolved is None:
                cached[track_id] = None
            else:
                _, track = resolved
                try:
                    entry = serialize_song(track)
                except (TypeError, ValueError):
                    cached[track_id] = None
                else:
                    entry["id"] = track_id
                    cached[track_id] = (track, entry)
        resolved_track = cached[track_id]
        if resolved_track is not None:
            track, entry = resolved_track
            entries.append((original_index, track_id, track, entry))

    now = datetime.now(timezone.utc)
    changed = state.get("updated_at") if state else None
    if not isinstance(changed, datetime):
        changed = now
    elif changed.tzinfo is None:
        changed = changed.replace(tzinfo=timezone.utc)

    username = str(user.get("username") or user.get("email") or "")
    changed_by = str((state or {}).get("app_platform") or "OpenSubsonic")
    response: dict[str, Any] = {
        "username": username,
        "changed": changed.isoformat(),
        "changedBy": changed_by[:64],
        "entry": [entry for _, _, _, entry in entries],
        "position": 0,
    }
    if not entries:
        return response

    try:
        saved_index = max(0, int((state or {}).get("current_index") or 0))
    except (TypeError, ValueError):
        saved_index = 0
    current_entry = next((item for item in entries if item[0] == saved_index), None)
    restored_position = max(0, int((state or {}).get("position_ms") or 0))
    if current_entry is None:
        current_entry = next(
            (item for item in entries if item[0] > saved_index), entries[-1]
        )
        restored_position = 0
    current_index = entries.index(current_entry)
    response["position"] = _position_ms(restored_position, current_entry[2])
    if by_index:
        response["currentIndex"] = current_index
    else:
        response["current"] = current_entry[1]
    return response
