"""Deterministic Music Paths substitutions and a legacy service delegate."""

from __future__ import annotations

from collections.abc import Mapping
from pydantic import BaseModel, Field
from crate.genre_taxonomy import slugify_genre
from crate.music_path_validation import can_replace_path_track

_MIN_REPLACEMENT_CONFIDENCE = 0.55
_MAX_ALTERNATIVES = 80


class MusicPathReplacement(BaseModel):
    target_track_id: int = Field(description="Selected track id to replace.")
    replacement_track_id: int = Field(description="Candidate track id to use instead.")
    reason: str = Field(default="", max_length=240)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class MusicPathLlmRefinementResponse(BaseModel):
    replacements: list[MusicPathReplacement] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list, max_length=8)


def _select_alternatives(
    tracks: list[dict],
    candidates_by_genre: Mapping[str, list[dict]],
) -> list[dict]:
    selected_ids = {int(track["id"]) for track in tracks if track.get("id") is not None}
    path_genres = list(
        dict.fromkeys(
            str(track.get("genre_slug") or track.get("path_genre") or "").strip()
            for track in tracks
            if str(track.get("genre_slug") or track.get("path_genre") or "").strip()
        )
    )
    per_genre_limit = max(4, _MAX_ALTERNATIVES // max(1, len(path_genres)))
    alternatives: list[dict] = []
    seen_ids: set[int] = set()
    for genre_slug in path_genres:
        genre_count = 0
        for row in candidates_by_genre.get(genre_slug, []):
            track_id = _track_id(row)
            if track_id is None or track_id in selected_ids or track_id in seen_ids:
                continue
            alternatives.append(row)
            seen_ids.add(track_id)
            genre_count += 1
            if len(alternatives) >= _MAX_ALTERNATIVES or genre_count >= per_genre_limit:
                break
        if len(alternatives) >= _MAX_ALTERNATIVES:
            break
    return alternatives


def _apply_replacements(
    tracks: list[dict],
    alternatives: list[dict],
    replacements: list[MusicPathReplacement],
    *,
    recent_song_keys=None,
    previous_song_keys=None,
    previous_track_ids=None,
    validation_context=None,
) -> list[dict]:
    if not replacements:
        return tracks

    alternative_by_id = {
        track_id: row
        for row in alternatives
        if (track_id := _track_id(row)) is not None
    }
    if not alternative_by_id:
        return tracks

    output = [dict(track) for track in tracks]
    index_by_id = {
        track_id: index
        for index, track in enumerate(output)
        if (track_id := _track_id(track)) is not None
    }
    used_ids = set(index_by_id)
    anchor_indexes = {0, len(output) - 1}
    anchor_artists = {
        _artist_key(output[index])
        for index in anchor_indexes
        if 0 <= index < len(output)
    }

    for replacement in replacements:
        if replacement.confidence < _MIN_REPLACEMENT_CONFIDENCE:
            continue
        target_index = index_by_id.get(replacement.target_track_id)
        if target_index is None or target_index in anchor_indexes:
            continue
        candidate = alternative_by_id.get(replacement.replacement_track_id)
        if candidate is None:
            continue
        candidate_id = _track_id(candidate)
        if candidate_id is None or candidate_id in used_ids:
            continue
        if _artist_key(candidate) in anchor_artists:
            continue
        if not _compatible_genre(output[target_index], candidate):
            continue

        previous_track = output[target_index - 1] if target_index > 0 else None
        next_track = (
            output[target_index + 1] if target_index < len(output) - 1 else None
        )
        if _artist_key(candidate) in {
            _artist_key(previous_track),
            _artist_key(next_track),
        }:
            continue

        if not can_replace_path_track(
            output,
            target_index,
            candidate,
            recent_song_keys=recent_song_keys,
            previous_song_keys=previous_song_keys,
            previous_track_ids=previous_track_ids,
            validation_context=validation_context,
        ):
            continue

        old_id = _track_id(output[target_index])
        output[target_index] = dict(candidate)
        if old_id is not None:
            used_ids.discard(old_id)
            index_by_id.pop(old_id, None)
        used_ids.add(candidate_id)
        index_by_id[candidate_id] = target_index

    return output


def _compatible_genre(target: Mapping, candidate: Mapping) -> bool:
    target_genre = _track_genre(target)
    candidate_genre = _track_genre(candidate)
    if not target_genre or not candidate_genre:
        return True
    return target_genre == candidate_genre


def _track_id(track: Mapping) -> int | None:
    value = track.get("id")
    if value is None:
        value = track.get("track_id")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _track_genre(track: Mapping) -> str:
    return slugify_genre(str(track.get("genre_slug") or track.get("path_genre") or ""))


def _artist_key(track: Mapping | None) -> str:
    if not track:
        return ""
    return str(track.get("artist") or "").strip().casefold()


def refine_music_path_with_llm(
    *,
    origin_label: str,
    dest_label: str,
    origin_type: str,
    dest_type: str,
    tracks: list[dict],
    candidates_by_genre: Mapping[str, list[dict]],
    actor_id: int | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    validation_context: dict | None = None,
) -> list[dict]:
    """Compatibility entry point; the service owns AI execution and caching."""
    from crate.music_paths_refinement import (
        refine_music_path_with_llm as implementation,
    )

    return implementation(
        origin_label=origin_label,
        dest_label=dest_label,
        origin_type=origin_type,
        dest_type=dest_type,
        tracks=tracks,
        candidates_by_genre=candidates_by_genre,
        actor_id=actor_id,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
        validation_context=validation_context,
    )


__all__ = [
    "MusicPathLlmRefinementResponse",
    "MusicPathReplacement",
    "refine_music_path_with_llm",
]
