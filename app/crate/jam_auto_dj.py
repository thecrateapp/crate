from __future__ import annotations

import math
import random
import json
import logging
import time
from collections.abc import Collection, Sequence
from datetime import datetime, timezone
from typing import Any

from crate.queue_engine import (
    QueueIntent,
    QueueState,
    blend_target_towards,
    candidate_artist_key as shared_candidate_artist_key,
    candidate_family_key as shared_candidate_family_key,
    candidate_id as shared_candidate_id,
    candidate_matches_intent,
    collective_vote_target,
    generation_seed,
    needs_refill,
)
from crate.utils import coerce_float, coerce_int


def _normalise_text(value: object) -> str:
    return str(value or "").strip().casefold()


def _normalise_vector(value: object) -> list[float]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    result: list[float] = []
    for item in value:
        try:
            result.append(float(item))
        except (TypeError, ValueError):
            return []
    return result


def _cosine_similarity(left: object, right: object) -> float:
    left_vector = _normalise_vector(left)
    right_vector = _normalise_vector(right)
    if not left_vector or len(left_vector) != len(right_vector):
        return 0.0
    left_norm = math.sqrt(sum(item * item for item in left_vector))
    right_norm = math.sqrt(sum(item * item for item in right_vector))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(
        0.0,
        min(
            1.0,
            sum(a * b for a, b in zip(left_vector, right_vector, strict=True))
            / (left_norm * right_norm),
        ),
    )


def _bpm_similarity(current_bpm: object, candidate_bpm: object) -> float:
    try:
        current = coerce_float(current_bpm)
        candidate = coerce_float(candidate_bpm)
    except (TypeError, ValueError):
        return 0.5
    if current <= 0 or candidate <= 0:
        return 0.5
    return max(0.0, 1.0 - min(abs(current - candidate), 80.0) / 80.0)


def _candidate_genres(candidate: dict[str, Any]) -> set[str]:
    genres = candidate.get("genres")
    if not isinstance(genres, Sequence) or isinstance(genres, (str, bytes)):
        genres = []
    return {_normalise_text(genre) for genre in genres if _normalise_text(genre)}


def _candidate_artist(candidate: dict[str, Any]) -> str:
    return shared_candidate_artist_key(candidate)


def _candidate_family_key(candidate: dict[str, Any]) -> str:
    return shared_candidate_family_key(candidate)


def _candidate_id(candidate: dict[str, Any]) -> str:
    return shared_candidate_id(candidate)


def _collective_vote_target(
    current_track: dict[str, Any] | None,
    vote_tracks: Sequence[dict[str, Any]],
) -> list[float] | None:
    vote_target, vote_count = collective_vote_target(list(vote_tracks))
    if not vote_target:
        return None
    current_vector = _normalise_vector(
        current_track.get("blissVector", current_track.get("bliss_vector"))
        if current_track
        else None
    )
    if not current_vector:
        return vote_target
    return blend_target_towards(
        current_vector,
        vote_target,
        feedback_count=vote_count,
    )


def choose_auto_dj_candidate(
    candidates: Sequence[dict[str, Any]],
    *,
    current_track: dict[str, Any] | None,
    intent: QueueIntent | None = None,
    genre_filters: Sequence[str] = (),
    recent_artists: Sequence[str] = (),
    excluded_artists: Collection[str] = (),
    excluded_track_families: Collection[str] = (),
    target_vector: Sequence[float] | None = None,
    random_value: float | None = None,
) -> dict[str, Any] | None:
    """Choose the next track using hard genre filters and soft continuity signals.

    The selection is intentionally pure so the scoring contract can be tested without
    a database or a running worker. Randomness is a small exploration term; all
    deterministic inputs remain the dominant part of the score.
    """

    if intent is not None:
        genre_filters = intent.genres
    allowed_genres = {
        _normalise_text(genre) for genre in genre_filters if _normalise_text(genre)
    }
    recent = {
        _normalise_text(artist) for artist in recent_artists if _normalise_text(artist)
    }
    excluded_artist_set = {
        _normalise_text(artist)
        for artist in excluded_artists
        if _normalise_text(artist)
    }
    excluded_family_set = {family for family in excluded_track_families if family}
    current_id = _candidate_id({"track": current_track}) if current_track else ""
    current_bpm = current_track.get("bpm") if current_track else None
    current_bliss = (
        current_track.get("blissVector", current_track.get("bliss_vector"))
        if current_track
        else None
    )
    reference_bliss = target_vector or current_bliss
    exploration_seed = (
        max(0.0, min(1.0, random_value)) if random_value is not None else None
    )

    viable: list[tuple[float, str, dict[str, Any]]] = []
    for candidate in candidates:
        candidate_id = _candidate_id(candidate)
        if not candidate_id or candidate_id == current_id:
            continue
        if intent is not None and not candidate_matches_intent(candidate, intent):
            continue
        genres = _candidate_genres(candidate)
        if allowed_genres and not genres.intersection(allowed_genres):
            continue

        artist = _candidate_artist(candidate)
        family_key = _candidate_family_key(candidate)
        if artist and artist in excluded_artist_set:
            continue
        if family_key and family_key in excluded_family_set:
            continue

        genre_score = 1.0
        bliss_score = _cosine_similarity(
            reference_bliss,
            candidate.get("bliss_vector", candidate.get("blissVector")),
        )
        bpm_score = _bpm_similarity(current_bpm, candidate.get("bpm"))
        recent_penalty = 0.75 if artist and artist in recent else 0.0
        room_plays = max(0.0, float(candidate.get("room_plays") or 0))
        popularity = max(0.0, float(candidate.get("popularity") or 0))
        room_history_penalty = min(room_plays / 10.0, 0.25)
        popularity_score = min(math.log1p(popularity) / 12.0, 1.0)
        exploration = (
            random.random()
            if exploration_seed is None
            else random.Random(f"{exploration_seed}:{candidate_id}").random()
        )
        score = (
            genre_score * 0.15
            + bliss_score * 0.40
            + bpm_score * 0.25
            + popularity_score * 0.05
            + exploration * 0.15
            - recent_penalty
            - room_history_penalty
        )
        viable.append((score, candidate_id, candidate))

    if not viable:
        return None
    viable.sort(key=lambda item: (-item[0], item[1]))
    return viable[0][2]


def rank_auto_dj_candidates(
    candidates: Sequence[dict[str, Any]],
    *,
    current_track: dict[str, Any] | None,
    intent: QueueIntent | None = None,
    genre_filters: Sequence[str] = (),
    recent_artists: Sequence[str] = (),
    target_vector: Sequence[float] | None = None,
    limit: int = 5,
    random_value: float | None = None,
) -> list[dict[str, Any]]:
    """Return a preview of the next Auto DJ choices in playback order."""

    remaining = list(candidates)
    ranked: list[dict[str, Any]] = []
    recent = list(recent_artists)
    selected_artists: set[str] = set()
    selected_families: set[str] = set()
    while remaining and len(ranked) < max(0, limit):
        selected = choose_auto_dj_candidate(
            remaining,
            current_track=current_track,
            intent=intent,
            genre_filters=genre_filters,
            recent_artists=recent,
            target_vector=target_vector,
            excluded_artists=selected_artists,
            excluded_track_families=selected_families,
            random_value=random_value,
        )
        if selected is None:
            # A small library may not contain enough distinct artists. Keep the
            # preview useful while still avoiding duplicate track families.
            selected = choose_auto_dj_candidate(
                remaining,
                current_track=current_track,
                intent=intent,
                genre_filters=genre_filters,
                recent_artists=recent,
                target_vector=target_vector,
                excluded_track_families=selected_families,
                random_value=random_value,
            )
            if selected is None:
                break
        ranked.append(selected)
        selected_id = _candidate_id(selected)
        remaining = [
            candidate
            for candidate in remaining
            if _candidate_id(candidate) != selected_id
        ]
        artist = _candidate_artist(selected)
        if artist:
            recent.append(artist)
            selected_artists.add(artist)
        family_key = _candidate_family_key(selected)
        if family_key:
            selected_families.add(family_key)
        current_track = candidate_to_track_payload(selected)
    return ranked


log = logging.getLogger(__name__)

# Keep enough music ready that a short worker tick or a transient client
# disconnect cannot leave an Auto DJ room with an almost empty queue.
_AUTO_DJ_BUFFER_SIZE = 20
_AUTO_DJ_LOW_WATER_MARK = 6
_AUTO_DJ_LOCK_TTL_SECONDS = 15
_SYNC_CLOCK_TTL_SECONDS = 60 * 60 * 24


def candidate_to_track_payload(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": candidate.get("track_id"),
        "entityUid": candidate.get("track_entity_uid"),
        "path": candidate.get("track_path"),
        "title": candidate.get("title") or "Unknown",
        "artist": candidate.get("artist") or "Unknown artist",
        "album": candidate.get("album") or "",
        "albumId": candidate.get("album_id"),
        "albumEntityUid": candidate.get("album_entity_uid"),
        "duration": candidate.get("duration"),
        "bpm": candidate.get("bpm"),
        "energy": candidate.get("energy"),
        "danceability": candidate.get("danceability"),
        "valence": candidate.get("valence"),
        "blissVector": candidate.get("bliss_vector"),
    }


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _room_lock(room_id: str):
    from crate.db.cache_runtime import get_redis

    redis = get_redis()
    if redis is None:
        return None, None
    token = f"auto-dj-{time.time_ns()}"
    key = f"crate:jam:auto-dj:{room_id}"
    if not redis.set(key, token, nx=True, ex=_AUTO_DJ_LOCK_TTL_SECONDS):
        return redis, None
    return redis, (key, token)


def _release_room_lock(redis: Any, lock: tuple[str, str] | None) -> None:
    if redis is None or lock is None:
        return
    key, token = lock
    try:
        if redis.get(key) == token:
            redis.delete(key)
    except Exception:
        log.debug("Could not release Auto DJ lock", exc_info=True)


def _publish_room_payload(redis: Any, room_id: str, payload: dict[str, Any]) -> None:
    if redis is None:
        return
    redis.publish(f"crate:jam:room:{room_id}", json.dumps(payload, default=str))


def _set_sync_clock(
    redis: Any, room_id: str, track: dict[str, Any], *, playing: bool
) -> None:
    if redis is None:
        return
    clock = {
        "track": track,
        "position_ms": 0,
        "playing": playing,
        "clock_started_at": datetime.now(timezone.utc).timestamp(),
    }
    redis.setex(
        f"crate:jam:sync:{room_id}",
        _SYNC_CLOCK_TTL_SECONDS,
        json.dumps(clock, default=str),
    )


def _publish_queue_snapshot(
    redis: Any,
    room_id: str,
    event: dict[str, Any],
    *,
    event_type: str,
    queue: list[dict],
) -> None:
    from crate.db.jam_members import get_jam_room_members
    from crate.db.jam_queue import list_jam_track_requests

    _publish_room_payload(
        redis,
        room_id,
        {
            "type": event_type,
            "event": event,
            "members": get_jam_room_members(room_id, active_only=True),
            "queue": queue,
            "requests": list_jam_track_requests(room_id),
        },
    )


def _current_track_payload(room: dict) -> tuple[dict[str, Any] | None, bool]:
    payload = room.get("current_track_payload")
    if not isinstance(payload, dict):
        return None, False
    track = payload.get("track")
    return (track if isinstance(track, dict) else None), payload.get("playing") is True


def _has_finished(room: dict, track: dict[str, Any]) -> bool:
    payload = room.get("current_track_payload")
    if not isinstance(payload, dict) or payload.get("playing") is not True:
        return False
    try:
        duration = float(track.get("duration") or 0)
    except (TypeError, ValueError):
        return False
    if duration <= 0:
        return False
    started_at = payload.get("updated_at") or payload.get("started_at")
    try:
        started = datetime.fromisoformat(str(started_at)).timestamp()
    except (TypeError, ValueError, AttributeError):
        return False
    try:
        position = float(payload.get("position") or 0)
    except (TypeError, ValueError):
        position = 0
    return position + (datetime.now(timezone.utc).timestamp() - started) >= duration


def _append_auto_dj_track(room: dict, candidate: dict[str, Any], redis: Any) -> None:
    from crate.db.jam import (
        add_jam_queue_item,
        append_jam_room_event,
        list_jam_queue_items,
    )

    track = candidate_to_track_payload(candidate)
    item = add_jam_queue_item(
        str(room["id"]),
        track,
        int(room["host_user_id"]),
        source="auto_dj",
    )
    if item.get("_deduplicated"):
        return
    event = append_jam_room_event(
        str(room["id"]),
        "queue_add",
        {"track": track, "queue_item_id": item["id"], "source": "auto_dj"},
        int(room["host_user_id"]),
    )
    _publish_queue_snapshot(
        redis,
        str(room["id"]),
        event,
        event_type="queue_add",
        queue=list_jam_queue_items(str(room["id"])),
    )


def _fill_auto_dj_queue(room: dict, redis: Any) -> list[dict]:
    from crate.db.jam import (
        list_auto_dj_candidates,
        list_jam_queue_items,
        list_jam_queue_vote_tracks,
        list_recent_auto_dj_artists,
        list_recent_auto_dj_tracks,
    )

    room_id = str(room["id"])
    host_user_id = coerce_int(room.get("host_user_id")) or None
    intent = QueueIntent(
        profile="jam_auto_dj",
        listener_id=host_user_id,
        seed_type="room",
        seed_value=room_id,
        genres=tuple(str(value) for value in room.get("genre_filters") or []),
        target_size=_AUTO_DJ_BUFFER_SIZE,
        low_water_mark=_AUTO_DJ_LOW_WATER_MARK,
        max_per_artist=1,
        avoid_variants=True,
    )
    queue = list_jam_queue_items(room_id)
    current_track, _ = _current_track_payload(room)
    target_vector: list[float] | None = None
    generation = generation_seed(
        listener_id=host_user_id,
        context=f"jam:{room_id}",
        session_id=room_id,
    )
    exploration_seed = generation / ((1 << 64) - 1)
    recent_artists = list_recent_auto_dj_artists(room_id)
    active_tracks = [
        item.get("track") for item in queue if isinstance(item.get("track"), dict)
    ]
    if current_track is not None:
        active_tracks.append(current_track)
    active_artists = {
        artist
        for artist in (_candidate_artist({"track": track}) for track in active_tracks)
        if artist
    }
    active_families = {
        family
        for family in (
            _candidate_family_key({"track": track}) for track in active_tracks
        )
        if family
    }
    played_families = {
        family
        for family in (
            _candidate_family_key({"track": track})
            for track in list_recent_auto_dj_tracks(room_id)
            if isinstance(track, dict)
        )
        if family
    }
    excluded_families = active_families | played_families
    if not needs_refill(
        QueueState(
            queued_count=len(queue),
            remaining_count=len(queue),
            target_size=intent.target_size,
            low_water_mark=intent.low_water_mark,
        )
    ):
        return queue

    # The low-water mark only starts a refill. Once it starts, fill all the
    # way to the target so the initial buffer is not capped at low_water + 1.
    while len(queue) < intent.target_size:
        if target_vector is None:
            target_vector = _collective_vote_target(
                current_track,
                list_jam_queue_vote_tracks(room_id),
            )
        candidates = list_auto_dj_candidates(
            room_id,
            genre_filters=intent.genres,
        )
        selected = choose_auto_dj_candidate(
            candidates,
            current_track=current_track,
            intent=intent,
            target_vector=target_vector,
            recent_artists=recent_artists,
            excluded_artists=active_artists,
            excluded_track_families=excluded_families,
            random_value=exploration_seed,
        )
        if selected is None:
            # Once the room has consumed the available library, allow an old
            # track family back into rotation, but keep the current buffer
            # free of repeated artists and versions whenever possible.
            selected = choose_auto_dj_candidate(
                candidates,
                current_track=current_track,
                intent=intent,
                target_vector=target_vector,
                recent_artists=recent_artists,
                excluded_artists=active_artists,
                excluded_track_families=active_families,
                random_value=exploration_seed,
            )
        if selected is None:
            # A room with a very small catalog must still be able to play.
            selected = choose_auto_dj_candidate(
                candidates,
                current_track=current_track,
                intent=intent,
                target_vector=target_vector,
                recent_artists=recent_artists,
                excluded_track_families=active_families,
                random_value=exploration_seed,
            )
        if selected is None:
            break
        _append_auto_dj_track(room, selected, redis)
        queue = list_jam_queue_items(room_id)
        current_track = candidate_to_track_payload(selected)
        recent_artists.append(str(selected.get("artist") or "").casefold())
        artist = _candidate_artist(selected)
        if artist:
            active_artists.add(artist)
        family_key = _candidate_family_key(selected)
        if family_key:
            active_families.add(family_key)
            excluded_families.add(family_key)
    return queue


def ensure_auto_dj_room(room: dict) -> bool:
    """Fill and advance one detached room; return whether state changed."""

    from crate.db.jam import (
        advance_jam_queue,
        append_jam_room_event,
        get_jam_room,
        list_jam_queue_items,
        update_jam_room_state,
    )
    from crate.db.cache_runtime import get_redis

    room_id = str(room["id"])
    redis, lock = _room_lock(room_id)
    if redis is not None and lock is None:
        return False
    changed = False
    try:
        current_room = get_jam_room(room_id) or room
        current_track, playing = _current_track_payload(current_room)
        current_payload = current_room.get("current_track_payload")
        explicit_pause = (
            isinstance(current_payload, dict)
            and current_payload.get("playing") is False
        )
        queue = _fill_auto_dj_queue(current_room, redis)

        # A pause is an explicit room decision. Auto DJ keeps the buffer ready,
        # but never starts playback again until a host/member starts it.
        if explicit_pause:
            return False

        if (
            current_track is not None
            and playing
            and _has_finished(current_room, current_track)
        ):
            next_item = advance_jam_queue(room_id)
            current_track = next_item["track"] if next_item else None
            playing = current_track is not None
            changed = True
            queue = list_jam_queue_items(room_id)

        if current_track is None:
            if not queue:
                if not changed:
                    return False
                playing = False
            else:
                next_item = next(
                    (item for item in queue if item.get("status") == "playing"),
                    None,
                ) or next(
                    (item for item in queue if item.get("status") == "queued"),
                    None,
                )
                if next_item is None:
                    return changed
                if next_item.get("status") == "queued":
                    next_item = advance_jam_queue(room_id)
                if next_item is None:
                    return changed
                current_track = next_item["track"]
                playing = True
                changed = True
                queue = list_jam_queue_items(room_id)

        if not changed:
            return False
        if not isinstance(current_track, dict):
            return False

        now = _iso_now()
        state = {
            "track": current_track,
            "queue_item_id": next(
                (
                    item["id"]
                    for item in queue
                    if item.get("status") == "playing"
                    and item.get("track") == current_track
                ),
                None,
            ),
            "position": 0,
            "playing": playing,
            "source": "auto_dj",
            "updated_at": now,
        }
        update_jam_room_state(room_id, current_track_payload=state)
        _set_sync_clock(redis or get_redis(), room_id, current_track, playing=playing)
        event = append_jam_room_event(
            room_id,
            "play_next",
            state,
            int(current_room["host_user_id"]),
        )
        _publish_queue_snapshot(
            redis or get_redis(),
            room_id,
            event,
            event_type="play_next",
            queue=list_jam_queue_items(room_id),
        )
        return True
    finally:
        _release_room_lock(redis, lock)


def run_auto_dj_once() -> int:
    from crate.db.jam_auto_dj import list_detached_auto_dj_rooms

    changed = 0
    for room in list_detached_auto_dj_rooms():
        try:
            changed += int(ensure_auto_dj_room(room))
        except Exception:
            log.exception("Auto DJ tick failed for room %s", room.get("id"))
    return changed


__all__ = [
    "choose_auto_dj_candidate",
    "candidate_to_track_payload",
    "ensure_auto_dj_room",
    "rank_auto_dj_candidates",
    "run_auto_dj_once",
]
