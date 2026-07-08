"""Best-effort LLM reviewer for Music Paths."""

from __future__ import annotations

import logging
import os
import hashlib
import json
from collections.abc import Mapping

from pydantic import BaseModel, Field

from crate.db.cache_settings import get_setting
from crate.db.cache_store import get_cache, set_cache
from crate.genre_taxonomy import slugify_genre
from crate.llm import ask_structured, get_config, get_provider_api_key

log = logging.getLogger(__name__)

_MIN_REPLACEMENT_CONFIDENCE = 0.55
_MAX_REPLACEMENTS = 8
_MAX_ALTERNATIVES = 80
_MIN_TRACKS_FOR_REFINEMENT = 3
_REFINEMENT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
_REFINEMENT_ENABLED_SETTING = "paths_llm_refinement_enabled"


class MusicPathReplacement(BaseModel):
    target_track_id: int = Field(description="Selected track id to replace.")
    replacement_track_id: int = Field(description="Candidate track id to use instead.")
    reason: str = Field(default="", max_length=240)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class MusicPathLlmRefinementResponse(BaseModel):
    replacements: list[MusicPathReplacement] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list, max_length=8)


def refine_music_path_with_llm(
    *,
    origin_label: str,
    dest_label: str,
    origin_type: str,
    dest_type: str,
    tracks: list[dict],
    candidates_by_genre: Mapping[str, list[dict]],
) -> list[dict]:
    """Ask the configured LLM to review a deterministic path and apply safe swaps."""
    if len(tracks) < _MIN_TRACKS_FOR_REFINEMENT:
        return tracks
    if not _llm_refinement_is_configured():
        return tracks

    alternatives = _select_alternatives(tracks, candidates_by_genre)
    if not alternatives:
        return tracks
    cache_key = _cache_key(
        origin_label=origin_label,
        dest_label=dest_label,
        origin_type=origin_type,
        dest_type=dest_type,
        tracks=tracks,
        alternatives=alternatives,
    )
    cached = get_cache(cache_key, max_age_seconds=_REFINEMENT_CACHE_TTL_SECONDS)
    if isinstance(cached, dict):
        try:
            response = MusicPathLlmRefinementResponse.model_validate(cached)
            return _apply_replacements(
                tracks,
                alternatives,
                response.replacements[:_MAX_REPLACEMENTS],
            )
        except Exception:
            log.debug("Ignoring invalid music path LLM refinement cache entry")

    try:
        response = ask_structured(
            MusicPathLlmRefinementResponse,
            _build_refinement_prompt(
                origin_label=origin_label,
                dest_label=dest_label,
                origin_type=origin_type,
                dest_type=dest_type,
                tracks=tracks,
                alternatives=alternatives,
            ),
            system=_SYSTEM_PROMPT,
        )
    except Exception:
        log.warning("Music path LLM refinement failed", exc_info=True)
        return tracks

    set_cache(
        cache_key,
        response.model_dump(mode="json"),
        ttl=_REFINEMENT_CACHE_TTL_SECONDS,
    )
    return _apply_replacements(
        tracks,
        alternatives,
        response.replacements[:_MAX_REPLACEMENTS],
    )


def _llm_refinement_is_configured() -> bool:
    try:
        refinement_enabled = get_setting(_REFINEMENT_ENABLED_SETTING, "true")
    except Exception:
        log.debug("Music path LLM refinement disabled: settings unavailable")
        return False
    if refinement_enabled != "true":
        return False
    try:
        config = get_config()
    except Exception:
        return False

    provider = str(config.get("provider") or "").strip()
    if not provider:
        return False
    if provider == "ollama":
        return _ollama_refinement_is_explicitly_enabled()
    return bool(get_provider_api_key(provider))


def _cache_key(
    *,
    origin_label: str,
    dest_label: str,
    origin_type: str,
    dest_type: str,
    tracks: list[dict],
    alternatives: list[dict],
) -> str:
    payload = {
        "v": 1,
        "origin": [origin_type, origin_label],
        "dest": [dest_type, dest_label],
        "tracks": [_cache_track_identity(track) for track in tracks],
        "alternatives": [_cache_track_identity(track) for track in alternatives],
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return f"paths:llm_refinement:{digest}"


def _cache_track_identity(track: Mapping) -> dict:
    return {
        "id": _track_id(track),
        "artist": _text(track.get("artist")).casefold(),
        "title": _text(track.get("title")).casefold(),
        "genre": _track_genre(track),
        "year": _text(track.get("year")),
    }


def _ollama_refinement_is_explicitly_enabled() -> bool:
    if os.environ.get("CRATE_ENABLE_PATH_LLM_REFINEMENT", "").strip() == "1":
        return True
    if os.environ.get("LLM_PROVIDER", "").strip().startswith("ollama/"):
        return True
    try:
        from crate.db.cache_settings import get_setting

        return bool(str(get_setting("llm_model", "") or "").strip())
    except Exception:
        return False


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


_SYSTEM_PROMPT = """You are Crate's Music Paths editor.
A Music Path is a coherent journey from an origin to a destination through time, scenes, genres, influence, geography and musical feel.
Review the deterministic path. Suggest only clear fixes.
Use only the candidate track ids provided. Do not invent tracks, artists or ids.
Preserve the first and last track. Prefer no change over a speculative change.
Return concise JSON only."""


def _build_refinement_prompt(
    *,
    origin_label: str,
    dest_label: str,
    origin_type: str,
    dest_type: str,
    tracks: list[dict],
    alternatives: list[dict],
) -> str:
    lines = [
        f"Path concept: musical journey from {origin_label} ({origin_type}) "
        f"to {dest_label} ({dest_type}).",
        "Task: identify selected tracks that clearly do not fit the journey "
        "and suggest safer replacements from the candidate alternatives.",
        "Rules:",
        "- Do not replace position 1 or the final position.",
        "- Only use replacement_track_id values from Candidate alternatives.",
        "- A replacement must fit the target position, its neighbors and the destination.",
        "- Keep replacements sparse; max 8.",
        "- If the deterministic path is good enough, return an empty replacements list.",
        "",
        "Selected path:",
    ]
    for index, track in enumerate(tracks, start=1):
        lines.append(_format_track_line(index, track))

    lines.append("")
    lines.append("Candidate alternatives:")
    for track in alternatives:
        lines.append(_format_candidate_line(track))

    return "\n".join(lines)


def _format_track_line(index: int, track: Mapping) -> str:
    return (
        f"{index:02d}. id={track.get('id')} "
        f"artist={_text(track.get('artist'))}; "
        f"title={_text(track.get('title'))}; "
        f"genre={_track_genre(track)}; "
        f"year={_text(track.get('year'))}; "
        f"country={_text(track.get('artist_country') or track.get('country'))}; "
        f"artist_genres={_genre_list(track)}"
    )


def _format_candidate_line(track: Mapping) -> str:
    return (
        f"id={track.get('id')} "
        f"artist={_text(track.get('artist'))}; "
        f"title={_text(track.get('title'))}; "
        f"genre={_track_genre(track)}; "
        f"year={_text(track.get('year'))}; "
        f"country={_text(track.get('artist_country') or track.get('country'))}; "
        f"artist_genres={_genre_list(track)}"
    )


def _apply_replacements(
    tracks: list[dict],
    alternatives: list[dict],
    replacements: list[MusicPathReplacement],
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


def _genre_list(track: Mapping) -> str:
    values = track.get("artist_genre_slugs")
    if not isinstance(values, list | tuple | set):
        return ""
    return ", ".join(str(value) for value in values if value)


def _text(value: object) -> str:
    return str(value or "").replace("\n", " ").strip()


__all__ = [
    "MusicPathLlmRefinementResponse",
    "MusicPathReplacement",
    "refine_music_path_with_llm",
]
