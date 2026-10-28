"""Path-building helpers for Music Paths."""

from __future__ import annotations

from crate.db.paths_candidates import _find_anchor_track, _find_best_candidate
from crate.db.paths_similarity import (
    _artist_affinity,
    _load_artist_genres,
    _load_artist_similarity_graph,
    _load_shared_members_graph,
    make_path_genre_overlap_scorer,
)
from crate.db.paths_vectors import _lerp
from crate.db.queries.recommendation_context import load_endpoint_contexts
from crate.track_versions import track_song_identity


def _resolve_path_anchors(
    origin_type, origin_value, origin_vec, dest_type, dest_value, dest_vec
):
    def find(kind, value, vector, other=None):
        excluded = {other["id"]} if other else set()
        key = track_song_identity(other) if other else None
        options = {"exclude_song_keys": {key}} if key is not None else {}
        return _find_anchor_track(kind, value, vector, excluded, **options)

    if dest_type == "track" and origin_type != "track":
        last = find(dest_type, dest_value, dest_vec)
        first = find(origin_type, origin_value, origin_vec, last)
    else:
        first = find(origin_type, origin_value, origin_vec)
        last = find(dest_type, dest_value, dest_vec, first)
        if (
            last is None
            and first is not None
            and origin_type != "track"
            and dest_type != "track"
        ):
            last = find(dest_type, dest_value, dest_vec)
            if last is not None:
                first = find(origin_type, origin_value, origin_vec, last)
    if (
        first
        and last
        and (key := track_song_identity(first)) is not None
        and key == track_song_identity(last)
    ):
        if dest_type == "track" and origin_type != "track":
            first = None
        else:
            last = None
    return first, last


def compute_path(
    origin_type: str,
    origin_value: str,
    origin_vec: list[float],
    dest_type: str,
    dest_value: str,
    dest_vec: list[float],
    step_count: int = 20,
    waypoint_vecs: list[list[float]] | None = None,
    *,
    endpoint_contexts: list[dict] | None = None,
) -> list[dict]:
    """Compute a music path through bliss vector space."""
    sim_graph = _load_artist_similarity_graph()
    genre_map = _load_artist_genres()
    member_graph = _load_shared_members_graph()

    chain = [origin_vec]
    if waypoint_vecs:
        chain.extend(waypoint_vecs)
    chain.append(dest_vec)

    num_segments = len(chain) - 1
    inner_steps = max(0, step_count - 2)

    used_ids: set[int] = set()
    used_titles: set[str] = set()
    recent_artists: list[str] = []
    recent_tracks: list[dict] = []
    used_song_keys: set[tuple[str, str]] = set()

    contexts = endpoint_contexts
    if contexts is None:
        contexts = load_endpoint_contexts(
            [(origin_type, origin_value), (dest_type, dest_value)]
        )
    segment_contexts = [
        contexts[index : index + 2] if len(contexts) == len(chain) else contexts
        for index in range(num_segments)
    ]
    genre_scorers = [
        make_path_genre_overlap_scorer(genre_map, values) for values in segment_contexts
    ]

    def make_entry(track: dict, step: int, progress: float) -> dict:
        title_key = f"{track['artist']}::{track['title']}"
        used_ids.add(track["id"])
        used_titles.add(title_key.lower())
        song_key = track_song_identity(track)
        if song_key is not None:
            used_song_keys.add(song_key)
        recent_tracks.append(track)
        del recent_tracks[:-5]
        recent_artists.append(track["artist"])
        if len(recent_artists) > 3:
            recent_artists.pop(0)
        entity_uid = str(track["entity_uid"]) if track.get("entity_uid") else None
        return {
            "step": step,
            "progress": round(progress, 4),
            "track_id": track["id"],
            "entity_uid": entity_uid,
            "title": track["title"],
            "artist": track["artist"],
            "artist_entity_uid": track.get("artist_entity_uid"),
            "album": track.get("album"),
            "album_id": track.get("album_id"),
            "album_entity_uid": track.get("album_entity_uid"),
            "format": track.get("format"),
            "bitrate": track.get("bitrate"),
            "sample_rate": track.get("sample_rate"),
            "bit_depth": track.get("bit_depth"),
            "duration": track.get("duration"),
            "path": track.get("path"),
            "bpm": track.get("bpm"),
            "audio_key": track.get("audio_key"),
            "audio_scale": track.get("audio_scale"),
            "energy": track.get("energy"),
            "danceability": track.get("danceability"),
            "valence": track.get("valence"),
            "bliss_vector": list(track["bliss_vector"])
            if track.get("bliss_vector")
            else None,
            "distance": round(track["distance"], 6),
        }

    path_tracks: list[dict] = []
    first, last = _resolve_path_anchors(
        origin_type, origin_value, origin_vec, dest_type, dest_value, dest_vec
    )
    if first:
        path_tracks.append(make_entry(first, 0, 0.0))
        last_actual_vec = (
            list(first["bliss_vector"]) if first.get("bliss_vector") else origin_vec
        )
    else:
        last_actual_vec = origin_vec

    if last:
        used_ids.add(last["id"])
        used_titles.add(f"{last['artist']}::{last['title']}".lower())
        song_key = track_song_identity(last)
        if song_key is not None:
            used_song_keys.add(song_key)

    for global_step in range(1, inner_steps + 1):
        global_progress = global_step / max(1, step_count - 1)
        position = global_progress * num_segments
        segment_index = min(int(position), num_segments - 1)
        local_progress = position - segment_index
        lerp_target = _lerp(
            chain[segment_index], chain[segment_index + 1], local_progress
        )
        search_target = _lerp(last_actual_vec, lerp_target, 0.55)
        target_artists = list(
            dict.fromkeys(
                artist
                for context in segment_contexts[segment_index]
                for artist in context["artists"]
            )
        )
        track = _find_best_candidate(
            search_target,
            used_ids,
            used_titles,
            recent_artists,
            sim_graph,
            genre_map,
            member_graph,
            target_artists,
            artist_affinity=_artist_affinity,
            genre_overlap=genre_scorers[segment_index],
            recent_tracks=recent_tracks,
            exclude_song_keys=used_song_keys,
        )
        if track:
            path_tracks.append(make_entry(track, global_step, global_progress))
            last_actual_vec = (
                list(track["bliss_vector"])
                if track.get("bliss_vector")
                else last_actual_vec
            )

    if last:
        path_tracks.append(make_entry(last, step_count - 1, 1.0))

    return path_tracks


__all__ = ["compute_path"]
