"""Radio engine — seeded and discovery radio with live shaping.

Sessions are ephemeral (Redis, TTL 24h). The engine reuses Music Paths
hybrid scoring (bliss + artist affinity + genre overlap + shared members)
but without a destination — it radiates outward from a seed, shaped
in real time by like/dislike feedback.
"""

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from crate.db.paths import (
    _centroid,
    _lerp,
    _load_artist_genres,
    _load_artist_similarity_graph,
    _load_shared_members_graph,
    resolve_bliss_centroid,
    resolve_endpoint_label,
)
from crate.db.paths_candidates import (
    _ARTIST_REPEAT_PENALTY,
    _MAX_CONSECUTIVE_SAME_ARTIST,
    _W_ARTIST_AFFINITY,
    _W_BLISS,
    _W_BPM,
    _W_ENERGY,
    _W_ERA,
    _W_GENRE_OVERLAP,
    _W_KEY,
    _bpm_penalty,
    _curation_penalty,
    _energy_penalty,
    _era_penalty,
    _key_penalty,
    _latest_track_context,
    _vector_distance,
)
from crate.db.paths_similarity import _artist_affinity, make_radio_genre_overlap_scorer
from crate.db.queries.paths import find_candidate_rows, find_seeded_radio_candidate_rows
from crate.db.queries.global_catalog import get_global_radio_seed_tracks
from crate.db.queries.radio import (
    count_user_radio_signals,
    get_album_seed_context,
    get_discovery_excluded_artist_keys,
    get_discovery_seed_sources,
    get_home_playlist_seed_context,
    get_playlist_seed_context,
    get_random_library_seed_rows,
    get_track_seed_context,
    get_track_bliss_vector,
    load_feedback_history,
)
from crate.db.queries.paths import load_artist_radio_graphs
from crate.db.repositories.radio import (
    persist_radio_feedback,
)
from crate.db.tx import read_scope
from crate.track_versions import (
    canonical_track_title_key,
    dedupe_track_variants,
    track_song_identity,
    track_variant_rank,
)

log = logging.getLogger(__name__)

_SESSION_TTL = 86400  # 24 hours
_DISLIKE_PENALTY_RADIUS = 0.10
_BATCH_SIZE = 20
_RADIO_CANDIDATE_POOL_SIZE = 60
_RADIO_PREFETCH_LIMIT = 120
_RADIO_PREFETCH_MULTIPLIER = 3
_MAX_GENERATION_ATTEMPT_MULTIPLIER = 2
_SEED_ANCHOR_BLEND = 0.02
_CONTEXTUAL_RADIO_SEED_ANCHOR_BLEND = 0.10
_TRACK_RADIO_SEED_ANCHOR_BLEND = 0.06
_RADIO_DRIFT_SIGMA = 0.02
_CONTEXTUAL_RADIO_DRIFT_SIGMA = 0.004
_TRACK_RADIO_DRIFT_SIGMA = 0.008
_GRAPH_CACHE_TTL_SECONDS = 3600
_DB_EXCLUDE_ID_LIMIT = 50
_SEEDED_RADIO_SIMILAR_LIMIT = 24
_SEEDED_RADIO_CANDIDATE_POOL_SIZE = 140
_CONTEXTUAL_RADIO_W_BLISS = 0.01
_CONTEXTUAL_RADIO_W_ARTIST_AFFINITY = 0.44
_CONTEXTUAL_RADIO_W_GENRE_OVERLAP = 0.26
_TRACK_RADIO_W_BLISS = 0.16
_TRACK_RADIO_W_ARTIST_AFFINITY = 0.30
_TRACK_RADIO_W_GENRE_OVERLAP = 0.20
_CONTEXTUAL_RADIO_SOURCE_PENALTY = {
    "seed": 0.32,
    "similar": 0.0,
    "genre": 0.08,
    "bliss": 0.35,
}
_TRACK_RADIO_SOURCE_PENALTY = {
    "seed": 0.22,
    "similar": 0.0,
    "genre": 0.06,
    "bliss": 0.20,
}
_DISCOVERY_FRESH_RATIO = 0.80
_RADIO_ARTIST_BATCH_LIMITS = {
    "discovery": 1,
    "contextual": 2,
    "track": 1,
}
_RADIO_ARTIST_SESSION_LIMITS = {
    "discovery": 2,
    "contextual": 4,
    "track": 3,
}
_RADIO_VARIANT_SCORE_PENALTY = 0.06
_DISCOVERY_RADIO_SOURCE_PENALTY = {
    "similar": -0.06,
    "genre": -0.03,
    "bliss": 0.08,
}
_SEEDED_CONTEXT_RADIO_TYPES = {
    "artist",
    "album",
    "track",
    "playlist",
    "home-playlist",
    "genre",
}

_graph_cache: (
    tuple[
        float,
        dict[str, dict[str, float]],
        dict[str, dict[str, float]],
        dict[str, set[str]],
    ]
    | None
) = None


def _redis() -> Any:
    """Get the Redis connection used for radio sessions."""
    from crate.db.cache_runtime import get_redis

    redis_client = get_redis()
    if redis_client is None:
        raise RuntimeError("Redis is required for radio sessions")
    return redis_client


# ── Session management ─────────────────────────────────────────────


def _session_key(session_id: str) -> str:
    return f"radio:session:{session_id}"


def _save_session(session: dict) -> None:
    r = _redis()
    r.setex(_session_key(session["id"]), _SESSION_TTL, json.dumps(session, default=str))


def _load_session(session_id: str) -> dict | None:
    r = _redis()
    raw = r.get(_session_key(session_id))
    if not raw:
        return None
    return json.loads(raw)


def _delete_session(session_id: str) -> bool:
    r = _redis()
    return r.delete(_session_key(session_id)) > 0


# ── Discovery seed resolution ─────────────────────────────────────


def _seed_context_from_rows(rows: list[dict]) -> dict:
    artists: list[str] = []
    track_ids: list[int] = []
    song_keys: list[str] = []
    seen_artists: set[str] = set()
    seen_tracks: set[int] = set()
    seen_song_keys: set[str] = set()

    for row in rows:
        artist = (row.get("artist") or "").strip()
        artist_key = artist.lower()
        if artist and artist_key not in seen_artists:
            seen_artists.add(artist_key)
            artists.append(artist)

        track_id = row.get("track_id")
        if track_id is None:
            track_id = row.get("id")
        if track_id is None:
            continue
        track_id = int(track_id)
        if track_id not in seen_tracks:
            seen_tracks.add(track_id)
            track_ids.append(track_id)

        song_key = _song_key(row)
        if song_key and song_key not in seen_song_keys:
            seen_song_keys.add(song_key)
            song_keys.append(song_key)

    return {
        "seed_artists": artists[:24],
        "seed_genres": [],
        "seed_track_ids": track_ids[:80],
        "seed_song_keys": song_keys[:80],
    }


def _context_for_seed(seed_type: str, seed_value: str, seed_label: str) -> dict:
    if seed_type == "artist":
        return {"seed_artists": [seed_label], "seed_genres": [], "seed_track_ids": []}
    if seed_type == "genre":
        return {
            "seed_artists": [],
            "seed_genres": [seed_value or seed_label],
            "seed_track_ids": [],
        }
    if " — " in seed_label:
        artist = seed_label.rsplit(" — ", 1)[-1].strip()
        if artist:
            return {"seed_artists": [artist], "seed_genres": [], "seed_track_ids": []}
    return {"seed_artists": [], "seed_genres": [], "seed_track_ids": []}


def _vectors_from_rows(rows: list[dict]) -> list[list[float]]:
    return [
        list(row["bliss_vector"]) for row in rows if row.get("bliss_vector") is not None
    ]


def _seed_result_from_rows(
    rows: list[dict],
    label: str,
    *,
    minimum: int = 1,
    extra_context: dict | None = None,
) -> tuple[list[float], str, dict] | None:
    vectors = _vectors_from_rows(rows)
    if len(vectors) < minimum:
        return None
    context = _seed_context_from_rows(rows)
    if extra_context:
        context.update(extra_context)
    return _centroid(vectors), label, context


def clear_radio_graph_cache() -> None:
    global _graph_cache
    _graph_cache = None


def _load_radio_graphs(
    *,
    session=None,
) -> tuple[
    dict[str, dict[str, float]], dict[str, dict[str, float]], dict[str, set[str]]
]:
    global _graph_cache
    now = time.monotonic()
    if _graph_cache and now - _graph_cache[0] < _GRAPH_CACHE_TTL_SECONDS:
        return _graph_cache[1], _graph_cache[2], _graph_cache[3]

    try:
        sim_graph, genre_map, member_graph = load_artist_radio_graphs(session=session)
    except Exception:
        log.warning("Falling back to split radio graph loaders", exc_info=True)
        sim_graph = _load_artist_similarity_graph(session=session)
        genre_map = _load_artist_genres(session=session)
        member_graph = _load_shared_members_graph(session=session)
    _graph_cache = (now, sim_graph, genre_map, member_graph)
    return sim_graph, genre_map, member_graph


def resolve_discovery_seed(
    user_id: int, *, session=None
) -> tuple[list[float], str, dict] | None:
    """Resolve a seed for discovery radio from user behavior.

    Fetches all sources in one roundtrip, then tries them in priority
    order (likes > follows > saved albums > recent plays > library mix).
    """
    sources = get_discovery_seed_sources(user_id, session=session)
    excluded_artist_keys = get_discovery_excluded_artist_keys(user_id, session=session)
    extra_context = {"discovery_excluded_artist_keys": excluded_artist_keys}

    priority_labels = {
        1: "Your recent likes",
        2: "Artists you follow",
        3: "Your saved albums",
        4: "Your recent plays",
    }
    minimums = {1: 5, 2: 5, 3: 5, 4: 10}

    for priority in [1, 2, 3, 4]:
        rows = sources.get(priority, [])
        label = priority_labels[priority]
        resolved = _seed_result_from_rows(
            rows,
            label,
            minimum=minimums[priority],
            extra_context=extra_context,
        )
        if resolved:
            return resolved

    # Library mix (fallback)
    trending = get_random_library_seed_rows(limit=30, session=session)
    resolved = _seed_result_from_rows(
        trending, "Library mix", extra_context=extra_context
    )
    if resolved:
        return resolved

    return None


def has_enough_data(user_id: int) -> bool:
    """Check if a user has enough data for discovery radio."""
    counts = count_user_radio_signals(user_id)
    return (
        int(counts["likes"]) >= 3
        or int(counts["follows"]) >= 1
        or int(counts["saved_albums"]) >= 1
    )


# ── Radio start ───────────────────────────────────────────────────


def _resolve_seed(
    user_id: int, seed_type: str, seed_value: str, *, session=None
) -> tuple[list[float], str, dict] | None:
    if seed_type == "track":
        return get_track_seed_context(seed_value, session=session)

    if seed_type == "album":
        resolved = get_album_seed_context(seed_value, session=session)
        if not resolved:
            return None
        vectors, label, context = resolved
        return _centroid(vectors), label, context

    if seed_type == "playlist":
        try:
            playlist_id = int(seed_value)
        except (TypeError, ValueError):
            return None
        resolved = get_playlist_seed_context(playlist_id, session=session)
        if not resolved:
            return None
        vectors, label, context = resolved
        return _centroid(vectors), label, context

    if seed_type == "home-playlist":
        resolved = get_home_playlist_seed_context(user_id, seed_value, session=session)
        if not resolved:
            return None
        vectors, label, context = resolved
        return _centroid(vectors), label, context

    seed_vec = resolve_bliss_centroid(seed_type, seed_value, session=session)
    if not seed_vec:
        return None
    seed_label = resolve_endpoint_label(seed_type, seed_value, session=session)
    return seed_vec, seed_label, _context_for_seed(seed_type, seed_value, seed_label)


def _resolve_global_seed_tracks(
    seed_type: str,
    seed_value: str,
    *,
    session=None,
    limit: int = 120,
) -> dict | None:
    return get_global_radio_seed_tracks(
        seed_type,
        seed_value,
        limit=limit,
        session=session,
    )


def _global_radio_track_payload(track: dict, distance: int = 0) -> dict:
    return {
        "track_id": track.get("track_id"),
        "global_track_uid": track.get("global_track_uid"),
        "global_artist_uid": track.get("global_artist_uid"),
        "global_album_uid": track.get("global_album_uid"),
        "entity_uid": track.get("entity_uid") or track.get("track_entity_uid"),
        "title": track.get("title") or "",
        "artist": track.get("artist") or "",
        "artist_id": track.get("artist_id"),
        "artist_entity_uid": track.get("artist_entity_uid"),
        "album": track.get("album"),
        "album_id": track.get("album_id"),
        "album_entity_uid": track.get("album_entity_uid"),
        "bpm": track.get("bpm"),
        "audio_key": track.get("audio_key"),
        "audio_scale": track.get("audio_scale"),
        "energy": track.get("energy"),
        "danceability": track.get("danceability"),
        "valence": track.get("valence"),
        "duration": track.get("duration"),
        "year": track.get("year"),
        "bliss_vector": list(track["bliss_vector"])
        if track.get("bliss_vector")
        else None,
        "distance": distance,
    }


def _reload_global_tracks(session: dict, count: int) -> list[dict]:
    tracks = list(session.get("global_tracks") or [])
    if session.get("global_source_exhausted"):
        return tracks

    seed_type = str(session.get("seed_type") or "")
    seed_value = str(session.get("seed_value") or "")
    if not seed_type or not seed_value:
        return tracks

    next_limit = min(max(len(tracks) + max(count * 6, count), 120), 5_000)
    if next_limit <= len(tracks):
        return tracks

    refreshed = _resolve_global_seed_tracks(
        seed_type,
        seed_value,
        limit=next_limit,
    )
    if not refreshed:
        return tracks

    refreshed_tracks = list(refreshed.get("tracks") or [])
    if len(refreshed_tracks) <= len(tracks):
        session["global_source_exhausted"] = True
        return tracks

    session["global_tracks"] = refreshed_tracks
    session["seed_label"] = refreshed.get("seed_label") or session.get("seed_label")
    session["global_exhausted"] = False
    session["global_source_exhausted"] = len(refreshed_tracks) < next_limit
    return refreshed_tracks


def _generate_global_batch(session: dict, count: int = _BATCH_SIZE) -> list[dict]:
    tracks = list(session.get("global_tracks") or [])
    cursor = int(session.get("global_cursor") or 0)
    if cursor >= len(tracks):
        tracks = _reload_global_tracks(session, count)

    excluded = set(session.get("excluded_global_track_uids") or [])
    selected: list[dict] = []
    while cursor < len(tracks) and len(selected) < count:
        track = tracks[cursor]
        cursor += 1
        if track.get("global_track_uid") in excluded:
            continue
        selected.append(track)
    session["global_cursor"] = cursor
    queue_exhausted = session["global_cursor"] >= len(tracks)
    session["global_exhausted"] = bool(
        queue_exhausted and session.get("global_source_exhausted")
    )
    return [_global_radio_track_payload(track) for track in selected]


def start_radio(
    user_id: int,
    mode: str = "seeded",
    seed_type: str | None = None,
    seed_value: str | None = None,
) -> dict | None:
    """Start a new radio session. Returns session with first batch of tracks."""
    with read_scope() as db_session:
        if mode == "seeded":
            if not seed_type or not seed_value:
                return None
            resolved_seed = _resolve_seed(
                user_id, seed_type, seed_value, session=db_session
            )
            if not resolved_seed:
                global_seed = _resolve_global_seed_tracks(
                    seed_type,
                    seed_value,
                    session=db_session,
                    limit=max(_BATCH_SIZE * 6, 120),
                )
                if global_seed:
                    initial_limit = max(_BATCH_SIZE * 6, 120)
                    global_tracks = list(global_seed["tracks"])
                    session_id = str(uuid.uuid4())
                    session = {
                        "id": session_id,
                        "user_id": user_id,
                        "mode": mode,
                        "seed_type": seed_type,
                        "seed_value": seed_value,
                        "seed_label": global_seed["seed_label"],
                        "radio_profile": "global_catalog",
                        "global_tracks": global_tracks,
                        "global_cursor": 0,
                        "global_source_exhausted": len(global_tracks) < initial_limit,
                        "liked_vectors": [],
                        "disliked_vectors": [],
                        "track_count": 0,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    tracks = _generate_global_batch(session, _BATCH_SIZE)
                    session["track_count"] = len(tracks)
                    _save_session(session)
                    return {
                        "session_id": session_id,
                        "mode": mode,
                        "seed_label": global_seed["seed_label"],
                        "tracks": tracks,
                    }
                return None
            seed_vec, seed_label, seed_context = resolved_seed
        elif mode == "discovery":
            result = resolve_discovery_seed(user_id, session=db_session)
            if not result:
                return None
            seed_vec, seed_label, seed_context = result
            seed_type = "discovery"
            seed_value = "auto"
        else:
            return None

        # Pre-seed with historical feedback
        hist_liked, hist_disliked = load_feedback_history(user_id, session=db_session)
        log.info(
            "Radio start: %d historical likes, %d dislikes for user %d",
            len(hist_liked),
            len(hist_disliked),
            user_id,
        )

        initial_target = seed_vec
        if hist_liked:
            hist_centroid = _centroid(hist_liked)
            blend = min(0.15, 0.03 * len(hist_liked))
            initial_target = _lerp(seed_vec, hist_centroid, blend)

        session_id = str(uuid.uuid4())
        session = {
            "id": session_id,
            "user_id": user_id,
            "mode": mode,
            "seed_type": seed_type,
            "seed_value": seed_value,
            "seed_label": seed_label,
            "seed_vector": seed_vec,
            "seed_artists": seed_context.get("seed_artists") or [],
            "seed_genres": seed_context.get("seed_genres") or [],
            "seed_track_ids": seed_context.get("seed_track_ids") or [],
            "discovery_excluded_artist_keys": seed_context.get(
                "discovery_excluded_artist_keys"
            )
            or [],
            "initial_target": initial_target,
            "current_target": initial_target,
            "liked_vectors": [],
            "disliked_vectors": hist_disliked[:10],
            "used_track_ids": [],
            "used_titles": [],
            "used_song_keys": seed_context.get("seed_song_keys") or [],
            "used_artist_counts": {},
            "recent_artists": [],
            "recent_tracks": [],
            "track_count": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        tracks = _generate_batch(session, db_session=db_session)
        session["track_count"] = len(tracks)
        _save_session(session)

    return {
        "session_id": session_id,
        "mode": mode,
        "seed_label": seed_label,
        "tracks": tracks,
    }


# ── Next batch ────────────────────────────────────────────────────


def next_tracks(session_id: str, count: int = _BATCH_SIZE) -> dict | None:
    """Generate the next batch of tracks for an active radio session."""
    session = _load_session(session_id)
    if not session:
        return None

    if session.get("radio_profile") == "global_catalog":
        tracks = _generate_global_batch(session, count)
    else:
        tracks = _generate_batch(session, count)
    session["track_count"] += len(tracks)
    _save_session(session)

    result = {"session_id": session_id, "tracks": tracks}
    if session.get("radio_profile") == "global_catalog" and session.get(
        "global_exhausted"
    ):
        result["exhausted"] = True
    return result


# ── Feedback ──────────────────────────────────────────────────────


def radio_feedback(
    session_id: str,
    track_id: int | None,
    action: str,
    *,
    global_track_uid: str | None = None,
) -> dict | None:
    """Process like/dislike feedback — updates session AND persists to DB."""
    session = _load_session(session_id)
    if not session:
        return None

    vec = get_track_bliss_vector(track_id) if track_id is not None else None
    if not vec and global_track_uid:
        vec = _global_track_feedback_vector(session, global_track_uid)
    if not vec:
        if (
            session.get("radio_profile") == "global_catalog"
            and global_track_uid
            and action == "dislike"
        ):
            excluded = list(session.get("excluded_global_track_uids") or [])
            if global_track_uid not in excluded:
                excluded.append(global_track_uid)
                session["excluded_global_track_uids"] = excluded
                _save_session(session)
            return {"status": "ok", "effect": "exclusion_added"}
        return {"status": "ok", "effect": "none"}

    if action == "like":
        session.setdefault("liked_vectors", []).append(vec)
        liked = session["liked_vectors"]
        like_centroid = _centroid(liked)
        blend = min(0.4, 0.08 * len(liked))
        initial_target = session.get("initial_target") or vec
        session.setdefault("initial_target", initial_target)
        session["current_target"] = _lerp(initial_target, like_centroid, blend)
        effect = "target_shifted"
    elif action == "dislike":
        session.setdefault("disliked_vectors", []).append(vec)
        effect = "exclusion_added"
    else:
        return {"status": "ok", "effect": "none"}

    _save_session(session)

    if track_id is not None:
        persist_radio_feedback(
            user_id=session["user_id"],
            track_id=track_id,
            action=action,
            bliss_vector=vec,
            session_seed=session.get("seed_label", ""),
        )

    return {
        "status": "ok",
        "effect": effect,
        "liked_count": len(session["liked_vectors"]),
        "disliked_count": len(session["disliked_vectors"]),
    }


def _global_track_feedback_vector(
    session: dict, global_track_uid: str
) -> list[float] | None:
    for track in session.get("global_tracks") or []:
        if str(track.get("global_track_uid") or "") != global_track_uid:
            continue
        vector = track.get("bliss_vector")
        if isinstance(vector, list) and vector:
            return vector
        return None
    return None


# ── Track generation ──────────────────────────────────────────────


def _too_close_to_disliked(candidate: dict, disliked_vecs: list[list[float]]) -> bool:
    cand_vec = candidate.get("bliss_vector") or []
    if not cand_vec or not disliked_vecs:
        return False
    for disliked_vec in disliked_vecs:
        if not disliked_vec or len(disliked_vec) != len(cand_vec):
            continue
        distance = (
            sum((cand_vec[d] - disliked_vec[d]) ** 2 for d in range(len(cand_vec)))
            ** 0.5
        )
        if distance < _DISLIKE_PENALTY_RADIUS:
            return True
    return False


def _recent_track_context(candidate: dict) -> dict:
    return {
        "track_id": candidate.get("id"),
        "artist": candidate.get("artist"),
        "title": candidate.get("title"),
        "bpm": candidate.get("bpm"),
        "audio_key": candidate.get("audio_key"),
        "audio_scale": candidate.get("audio_scale"),
        "energy": candidate.get("energy"),
        "year": candidate.get("year"),
    }


def _db_exclude_ids(used_track_ids: list[int]) -> set[int]:
    return set(used_track_ids[-_DB_EXCLUDE_ID_LIMIT:])


def _title_key(candidate: dict) -> str:
    artist_key = _artist_key(candidate)
    title_key = canonical_track_title_key(str(candidate.get("title") or ""))
    if artist_key and title_key:
        return f"{artist_key}::{title_key}"
    return f"{candidate.get('artist') or ''}::{candidate.get('title') or ''}".lower()


def _artist_key(candidate: dict) -> str:
    return (
        str(candidate.get("artist") or candidate.get("artist_name") or "")
        .strip()
        .casefold()
    )


def _song_key(candidate: dict) -> str | None:
    identity = track_song_identity(candidate)
    if identity is not None and identity[0] and identity[1]:
        return f"{identity[0]}::{identity[1]}"
    title_key = _title_key(candidate)
    return title_key or None


def _normalize_artist_counts(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    counts: dict[str, int] = {}
    for raw_key, raw_count in value.items():
        key = str(raw_key or "").strip().casefold()
        if not key:
            continue
        try:
            count = int(raw_count)
        except (TypeError, ValueError):
            continue
        if count > 0:
            counts[key] = count
    return counts


def _radio_artist_batch_limit(radio_profile: str) -> int | None:
    return _RADIO_ARTIST_BATCH_LIMITS.get(radio_profile)


def _radio_artist_session_limit(radio_profile: str) -> int | None:
    return _RADIO_ARTIST_SESSION_LIMITS.get(radio_profile)


def _dedupe_radio_candidate_variants(rows: list[dict]) -> list[dict]:
    return dedupe_track_variants([dict(row) for row in rows])


def _radio_profile(seed_type: str | None) -> str:
    if seed_type == "track":
        return "track"
    if seed_type in _SEEDED_CONTEXT_RADIO_TYPES:
        return "contextual"
    return "discovery"


def _seeded_radio_similar_keys(
    seed_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    *,
    excluded_artist_keys: set[str] | None = None,
    limit: int = _SEEDED_RADIO_SIMILAR_LIMIT,
) -> list[str]:
    seed_keys = {artist.lower().strip() for artist in seed_artists if artist}
    excluded_keys = excluded_artist_keys or set()
    scored: dict[str, float] = {}
    for seed_key in seed_keys:
        for artist_key, score in sim_graph.get(seed_key, {}).items():
            normalized = artist_key.lower().strip()
            if not normalized or normalized in seed_keys or normalized in excluded_keys:
                continue
            scored[normalized] = max(scored.get(normalized, 0.0), float(score or 0.0))
    return [
        artist_key
        for artist_key, _score in sorted(
            scored.items(), key=lambda item: item[1], reverse=True
        )[:limit]
    ]


def _seeded_radio_genres(
    seed_artists: list[str],
    seed_genres: list[str],
    genre_map: dict[str, dict[str, float]],
    *,
    limit: int = 8,
) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []

    def add(raw_genre: str) -> None:
        genre = raw_genre.lower().strip()
        if genre and genre not in seen:
            seen.add(genre)
            result.append(genre)

    for genre in seed_genres:
        add(genre)

    weighted: dict[str, float] = {}
    for artist in seed_artists:
        for genre, weight in genre_map.get(artist.lower().strip(), {}).items():
            weighted[genre] = max(weighted.get(genre, 0.0), float(weight or 0.0))
    for genre, _weight in sorted(
        weighted.items(), key=lambda item: item[1], reverse=True
    ):
        add(genre)
        if len(result) >= limit:
            break

    return result[:limit]


def _seeded_radio_candidate_rows(
    target: list[float],
    used_track_ids: list[int],
    seed_track_ids: list[int],
    seed_artists: list[str],
    seed_genres: list[str],
    sim_graph: dict[str, dict[str, float]],
    genre_map: dict[str, dict[str, float]],
    *,
    count: int,
    db_session=None,
) -> list[dict]:
    if not seed_artists and not seed_genres:
        return []

    exclude_ids = _db_exclude_ids(used_track_ids + seed_track_ids)
    limit = min(
        _SEEDED_RADIO_CANDIDATE_POOL_SIZE,
        max(_RADIO_CANDIDATE_POOL_SIZE, count * _RADIO_PREFETCH_MULTIPLIER * 2),
    )
    rows = find_seeded_radio_candidate_rows(
        target,
        exclude_ids,
        seed_artists=seed_artists,
        similar_artist_keys=_seeded_radio_similar_keys(seed_artists, sim_graph),
        seed_genres=_seeded_radio_genres(seed_artists, seed_genres, genre_map),
        limit=limit,
        session=db_session,
    )
    if len(rows) >= count:
        return rows

    fallback = find_candidate_rows(
        target,
        exclude_ids,
        limit=min(_RADIO_CANDIDATE_POOL_SIZE, max(count, count - len(rows)) * 2),
        session=db_session,
    )
    existing_ids = {row.get("id") for row in rows}
    for row in fallback:
        if row.get("id") in existing_ids:
            continue
        row = dict(row)
        row["radio_source"] = "bliss"
        rows.append(row)
    return rows


def _discovery_radio_candidate_rows(
    target: list[float],
    used_track_ids: list[int],
    seed_artists: list[str],
    seed_genres: list[str],
    excluded_artist_keys: list[str],
    sim_graph: dict[str, dict[str, float]],
    genre_map: dict[str, dict[str, float]],
    *,
    count: int,
    db_session=None,
) -> list[dict]:
    excluded_keys = {
        key.lower().strip() for key in excluded_artist_keys if key and key.strip()
    }
    seed_artist_keys = {
        artist.lower().strip() for artist in seed_artists if artist and artist.strip()
    }
    effective_excluded = excluded_keys | seed_artist_keys
    similar_keys = _seeded_radio_similar_keys(
        seed_artists,
        sim_graph,
        excluded_artist_keys=effective_excluded,
        limit=max(_SEEDED_RADIO_SIMILAR_LIMIT, count * 2),
    )
    discovery_rows = find_seeded_radio_candidate_rows(
        target,
        _db_exclude_ids(used_track_ids),
        seed_artists=[],
        similar_artist_keys=similar_keys,
        seed_genres=_seeded_radio_genres(seed_artists, seed_genres, genre_map),
        excluded_artist_keys=sorted(effective_excluded),
        limit=min(
            _SEEDED_RADIO_CANDIDATE_POOL_SIZE,
            max(_RADIO_CANDIDATE_POOL_SIZE, count * _RADIO_PREFETCH_MULTIPLIER * 2),
        ),
        session=db_session,
    )

    rows: list[dict] = []
    seen_ids: set[int] = set()
    for row in discovery_rows:
        row = dict(row)
        if row.get("id") in seen_ids:
            continue
        if str(row.get("radio_source") or "").lower() == "seed":
            row["radio_source"] = "similar"
        rows.append(row)
        seen_ids.add(row["id"])

    if len(rows) >= count:
        return rows

    fallback = find_candidate_rows(
        target,
        _db_exclude_ids(used_track_ids),
        limit=min(_RADIO_PREFETCH_LIMIT, max(_RADIO_CANDIDATE_POOL_SIZE, count * 2)),
        session=db_session,
    )
    for row in fallback:
        if row.get("id") in seen_ids:
            continue
        row = dict(row)
        row["radio_source"] = "bliss"
        rows.append(row)
        seen_ids.add(row["id"])
    return rows


def _seeded_radio_source_penalty(candidate: dict, radio_profile: str) -> float:
    source = str(candidate.get("radio_source") or "").lower()
    if radio_profile == "discovery":
        return _DISCOVERY_RADIO_SOURCE_PENALTY.get(source, 0.0)
    if radio_profile == "track":
        return _TRACK_RADIO_SOURCE_PENALTY.get(source, 0.16)
    return _CONTEXTUAL_RADIO_SOURCE_PENALTY.get(source, 0.18)


def _seeded_radio_weights(radio_profile: str) -> tuple[float, float, float]:
    if radio_profile == "track":
        return (
            _TRACK_RADIO_W_BLISS,
            _TRACK_RADIO_W_ARTIST_AFFINITY,
            _TRACK_RADIO_W_GENRE_OVERLAP,
        )
    if radio_profile == "contextual":
        return (
            _CONTEXTUAL_RADIO_W_BLISS,
            _CONTEXTUAL_RADIO_W_ARTIST_AFFINITY,
            _CONTEXTUAL_RADIO_W_GENRE_OVERLAP,
        )
    return (_W_BLISS, _W_ARTIST_AFFINITY, _W_GENRE_OVERLAP)


def _is_discovery_fresh_candidate(candidate: dict) -> bool:
    return str(candidate.get("radio_source") or "").lower() in {"similar", "genre"}


def _select_radio_candidate_from_rows(
    rows: list[dict],
    target: list[float],
    used_ids: set[int],
    used_titles: set[str],
    used_song_keys: set[str] | None,
    batch_artist_counts: dict[str, int] | None,
    session_artist_counts: dict[str, int] | None,
    recent_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    genre_map: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
    target_artists: list[str],
    *,
    artist_affinity_cache: dict[tuple[str, tuple[str, ...]], float],
    genre_overlap_cache: dict[str, float],
    genre_overlap,
    recent_tracks: list[dict] | None = None,
    radio_profile: str = "discovery",
    artist_batch_limit: int | None = None,
    artist_session_limit: int | None = None,
) -> dict | None:
    track_context = _latest_track_context(recent_tracks)
    target_norm = sum(v * v for v in target) ** 0.5
    scored_rows: list[tuple[dict, float]] = []
    for row in rows:
        candidate = dict(row)
        song_key = _song_key(candidate)
        artist_key = _artist_key(candidate)
        if (
            candidate.get("id") in used_ids
            or _title_key(candidate) in used_titles
            or (song_key and song_key in (used_song_keys or set()))
        ):
            continue
        if (
            artist_batch_limit is not None
            and artist_key
            and (batch_artist_counts or {}).get(artist_key, 0) >= artist_batch_limit
        ):
            continue
        if (
            artist_session_limit is not None
            and artist_key
            and (session_artist_counts or {}).get(artist_key, 0) >= artist_session_limit
        ):
            continue
        scored_rows.append(
            (candidate, _vector_distance(candidate, target, target_norm=target_norm))
        )

    if not scored_rows:
        return None

    max_dist = max(distance for _candidate, distance in scored_rows) or 1.0
    best: dict | None = None
    best_score = float("inf")
    context_artists = tuple(recent_artists + target_artists)

    for candidate, distance in scored_rows:
        artist = candidate["artist"]
        artist_key = _artist_key(candidate)
        if recent_artists:
            consecutive = sum(
                1
                for recent_artist in reversed(recent_artists)
                if recent_artist.strip().casefold() == artist_key
            )
            if consecutive >= _MAX_CONSECUTIVE_SAME_ARTIST:
                continue

        affinity_key = (artist_key, context_artists)
        affinity = artist_affinity_cache.get(affinity_key)
        if affinity is None:
            affinity = _artist_affinity(
                artist, list(context_artists), sim_graph, member_graph
            )
            artist_affinity_cache[affinity_key] = affinity

        overlap = genre_overlap_cache.get(artist_key)
        if overlap is None:
            overlap = genre_overlap(artist, target_artists, genre_map)
            genre_overlap_cache[artist_key] = overlap

        bliss_weight, affinity_weight, genre_weight = _seeded_radio_weights(
            radio_profile
        )
        source_penalty = _seeded_radio_source_penalty(candidate, radio_profile)

        score = (
            bliss_weight * (distance / max_dist)
            + affinity_weight * (1.0 - affinity)
            + genre_weight * (1.0 - overlap)
            + _W_BPM * _bpm_penalty(candidate, track_context)
            + _W_KEY * _key_penalty(candidate, track_context)
            + _W_ENERGY * _energy_penalty(candidate, track_context)
            + _W_ERA * _era_penalty(candidate, track_context)
            + _curation_penalty(candidate)
            + source_penalty
            + _RADIO_VARIANT_SCORE_PENALTY
            * track_variant_rank(str(candidate.get("title") or ""))
        )

        recent_artist_keys = {
            recent.strip().casefold() for recent in recent_artists[-2:]
        }
        if artist_key in recent_artist_keys:
            score *= _ARTIST_REPEAT_PENALTY

        if score < best_score:
            best_score = score
            best = candidate
            best["distance"] = distance

    if best:
        best["bliss_vector"] = (
            list(best["bliss_vector"]) if best.get("bliss_vector") else None
        )

    return best


def _generate_batch(
    session: dict, count: int = _BATCH_SIZE, *, db_session=None
) -> list[dict]:
    """Generate a batch of tracks for the radio session."""
    sim_graph, genre_map, member_graph = _load_radio_graphs(session=db_session)

    target = session["current_target"]
    used_track_ids = list(session["used_track_ids"])
    seed_track_ids = [int(track_id) for track_id in session.get("seed_track_ids") or []]
    used_ids = set(used_track_ids) | set(seed_track_ids)
    used_titles = set(session["used_titles"])
    used_song_keys = {
        str(song_key)
        for song_key in (session.get("used_song_keys") or [])
        if str(song_key or "").strip()
    }
    session_artist_counts = _normalize_artist_counts(
        session.get("used_artist_counts") or {}
    )
    batch_artist_counts: dict[str, int] = {}
    recent_artists = list(session["recent_artists"])
    recent_tracks = list(session.get("recent_tracks") or [])
    disliked_vecs = session["disliked_vectors"]
    discovery_excluded_artist_keys = list(
        session.get("discovery_excluded_artist_keys") or []
    )

    radio_profile = _radio_profile(session.get("seed_type"))
    is_seeded_context_radio = radio_profile != "discovery"
    seed_artists = list(session.get("seed_artists") or [])
    if not seed_artists and session.get("seed_type") == "artist":
        seed_artists = [session["seed_label"]]
    target_artists = list(seed_artists)
    seed_genres = [genre for genre in (session.get("seed_genres") or []) if genre]
    if seed_genres:
        genre_map = dict(genre_map)
        genre_context_key = "__radio_seed_genres__"
        genre_map[genre_context_key] = {genre: 1.0 for genre in seed_genres}
        target_artists.append(genre_context_key)
    genre_overlap = make_radio_genre_overlap_scorer(genre_map, target_artists)

    tracks: list[dict] = []
    if is_seeded_context_radio:
        candidate_rows = _seeded_radio_candidate_rows(
            target,
            used_track_ids,
            seed_track_ids,
            seed_artists,
            seed_genres,
            sim_graph,
            genre_map,
            count=count,
            db_session=db_session,
        )
    else:
        candidate_rows = _discovery_radio_candidate_rows(
            target,
            used_track_ids,
            seed_artists,
            seed_genres,
            discovery_excluded_artist_keys,
            sim_graph,
            genre_map,
            count=count,
            db_session=db_session,
        )
    candidate_rows = _dedupe_radio_candidate_variants(candidate_rows)
    max_attempts = min(
        len(candidate_rows),
        max(count + 5, count * _MAX_GENERATION_ATTEMPT_MULTIPLIER),
    )
    attempts = 0
    artist_affinity_cache: dict[tuple[str, tuple[str, ...]], float] = {}
    genre_overlap_cache: dict[str, float] = {}
    discovery_fresh_target = int(round(count * _DISCOVERY_FRESH_RATIO))
    discovery_fresh_count = 0
    artist_batch_limit = _radio_artist_batch_limit(radio_profile)
    artist_session_limit = _radio_artist_session_limit(radio_profile)

    while len(tracks) < count and attempts < max_attempts:
        attempts += 1
        import random

        if radio_profile == "track":
            drift_sigma = _TRACK_RADIO_DRIFT_SIGMA
        elif radio_profile == "contextual":
            drift_sigma = _CONTEXTUAL_RADIO_DRIFT_SIGMA
        else:
            drift_sigma = _RADIO_DRIFT_SIGMA
        drift = [target[d] + random.gauss(0, drift_sigma) for d in range(len(target))]
        rows_for_selection = candidate_rows
        if radio_profile == "discovery":
            if discovery_fresh_count < discovery_fresh_target:
                fresh_rows = [
                    row for row in candidate_rows if _is_discovery_fresh_candidate(row)
                ]
                rows_for_selection = fresh_rows or candidate_rows
            else:
                fallback_rows = [
                    row
                    for row in candidate_rows
                    if not _is_discovery_fresh_candidate(row)
                ]
                rows_for_selection = fallback_rows or candidate_rows

        candidate = _select_radio_candidate_from_rows(
            rows_for_selection,
            drift,
            used_ids,
            used_titles,
            used_song_keys,
            batch_artist_counts,
            session_artist_counts,
            recent_artists,
            sim_graph,
            genre_map,
            member_graph,
            target_artists,
            artist_affinity_cache=artist_affinity_cache,
            genre_overlap_cache=genre_overlap_cache,
            genre_overlap=genre_overlap,
            recent_tracks=recent_tracks,
            radio_profile=radio_profile,
            artist_batch_limit=artist_batch_limit,
            artist_session_limit=artist_session_limit,
        )
        if candidate is None and artist_batch_limit is not None:
            candidate = _select_radio_candidate_from_rows(
                rows_for_selection,
                drift,
                used_ids,
                used_titles,
                used_song_keys,
                batch_artist_counts,
                session_artist_counts,
                recent_artists,
                sim_graph,
                genre_map,
                member_graph,
                target_artists,
                artist_affinity_cache=artist_affinity_cache,
                genre_overlap_cache=genre_overlap_cache,
                genre_overlap=genre_overlap,
                recent_tracks=recent_tracks,
                radio_profile=radio_profile,
                artist_batch_limit=None,
                artist_session_limit=artist_session_limit,
            )
        if candidate is None and artist_session_limit is not None:
            candidate = _select_radio_candidate_from_rows(
                rows_for_selection,
                drift,
                used_ids,
                used_titles,
                used_song_keys,
                batch_artist_counts,
                session_artist_counts,
                recent_artists,
                sim_graph,
                genre_map,
                member_graph,
                target_artists,
                artist_affinity_cache=artist_affinity_cache,
                genre_overlap_cache=genre_overlap_cache,
                genre_overlap=genre_overlap,
                recent_tracks=recent_tracks,
                radio_profile=radio_profile,
                artist_batch_limit=None,
                artist_session_limit=None,
            )

        if not candidate:
            break

        if _too_close_to_disliked(candidate, disliked_vecs):
            disliked_id = candidate["id"]
            if disliked_id not in used_ids:
                used_ids.add(disliked_id)
                used_track_ids.append(disliked_id)
            continue

        track_id = candidate["id"]
        artist = candidate["artist"]
        title = candidate["title"]
        title_key = _title_key(candidate)
        song_key = _song_key(candidate)
        artist_key = _artist_key(candidate)

        if track_id not in used_ids:
            used_ids.add(track_id)
            used_track_ids.append(track_id)
        used_titles.add(title_key)
        if song_key:
            used_song_keys.add(song_key)
        if artist_key:
            batch_artist_counts[artist_key] = batch_artist_counts.get(artist_key, 0) + 1
            session_artist_counts[artist_key] = (
                session_artist_counts.get(artist_key, 0) + 1
            )
        recent_artists.append(artist)
        if len(recent_artists) > 3:
            recent_artists.pop(0)
        recent_tracks.append(_recent_track_context(candidate))
        if len(recent_tracks) > 5:
            recent_tracks.pop(0)

        cand_vec = candidate.get("bliss_vector")
        if cand_vec:
            if radio_profile == "track":
                target_blend = 0.10
            elif radio_profile == "contextual":
                target_blend = 0.08
            else:
                target_blend = 0.15
            target = _lerp(target, cand_vec, target_blend)
            seed_vector = session.get("seed_vector")
            if seed_vector:
                if radio_profile == "track":
                    seed_anchor_blend = _TRACK_RADIO_SEED_ANCHOR_BLEND
                elif radio_profile == "contextual":
                    seed_anchor_blend = _CONTEXTUAL_RADIO_SEED_ANCHOR_BLEND
                else:
                    seed_anchor_blend = _SEED_ANCHOR_BLEND
                target = _lerp(
                    target,
                    seed_vector,
                    seed_anchor_blend,
                )

        tracks.append(
            {
                "track_id": track_id,
                "entity_uid": str(candidate["entity_uid"])
                if candidate.get("entity_uid")
                else None,
                "title": title,
                "artist": artist,
                "album": candidate.get("album"),
                "album_id": candidate.get("album_id"),
                "bpm": candidate.get("bpm"),
                "audio_key": candidate.get("audio_key"),
                "audio_scale": candidate.get("audio_scale"),
                "energy": candidate.get("energy"),
                "danceability": candidate.get("danceability"),
                "valence": candidate.get("valence"),
                "duration": candidate.get("duration"),
                "year": candidate.get("year"),
                "bliss_vector": list(cand_vec) if cand_vec else None,
                "distance": round(candidate["distance"], 6),
            }
        )
        if radio_profile == "discovery" and _is_discovery_fresh_candidate(candidate):
            discovery_fresh_count += 1

    # Update session state
    session["used_track_ids"] = used_track_ids
    session["used_titles"] = list(used_titles)
    session["used_song_keys"] = sorted(used_song_keys)
    session["used_artist_counts"] = session_artist_counts
    session["recent_artists"] = recent_artists
    session["recent_tracks"] = recent_tracks[-5:]
    session["current_target"] = target

    return tracks
