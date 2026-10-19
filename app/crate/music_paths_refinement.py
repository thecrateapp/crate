"""Best-effort LLM reviewer for Music Paths."""

from __future__ import annotations

import logging
import os
import hashlib
import json
from collections.abc import Mapping

from crate.db.cache_settings import get_setting
from crate.db.cache_store import get_cache, set_cache
from crate.db.paths_llm_refinement import (
    MusicPathLlmRefinementResponse,
    MusicPathReplacement,
    _select_alternatives,
    _apply_replacements,
    _track_genre,
)
from crate.ai.consumers import resolve_call, revalidate_call
from crate.ai.runtime import context_fingerprint, execute_structured

log = logging.getLogger(__name__)

_MAX_REPLACEMENTS = 8
_MIN_TRACKS_FOR_REFINEMENT = 3
_REFINEMENT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
_REFINEMENT_ENABLED_SETTING = "paths_llm_refinement_enabled"


def refine_music_path_with_llm(
    *,
    origin_label: str,
    dest_label: str,
    origin_type: str,
    dest_type: str,
    tracks: list[dict],
    candidates_by_genre: Mapping[str, list[dict]],
    actor_id: int | None = None,
) -> list[dict]:
    """Review outside DB scopes; any unavailable or stale review keeps the path."""
    if len(tracks) < _MIN_TRACKS_FOR_REFINEMENT:
        return tracks
    alternatives = _select_alternatives(tracks, candidates_by_genre)
    if not alternatives:
        return tracks

    try:
        call = resolve_call("music_paths.refine", actor_id=actor_id)
        context = call["context"]
        if not _legacy_refinement_enabled(context):
            return tracks
        prompt = _build_refinement_prompt(
            origin_label=origin_label,
            dest_label=dest_label,
            origin_type=origin_type,
            dest_type=dest_type,
            tracks=tracks,
            alternatives=alternatives,
        )
        cache_key = _cache_key(context, prompt)
        cached = get_cache(cache_key, max_age_seconds=_REFINEMENT_CACHE_TTL_SECONDS)
        response = None
        if isinstance(cached, dict):
            try:
                response = MusicPathLlmRefinementResponse.model_validate(cached)
            except ValueError:
                log.debug("Ignoring invalid music path refinement cache entry")
        if response is None:
            response = execute_structured(
                "music_paths.refine",
                MusicPathLlmRefinementResponse,
                prompt,
                system=_SYSTEM_PROMPT,
                **call,
            )
            # A result must still belong to the accepted context and human before
            # entering the shared cache, including when generation was mocked.
            _revalidate_refinement(call)
            set_cache(
                cache_key,
                response.model_dump(mode="json"),
                ttl=_REFINEMENT_CACHE_TTL_SECONDS,
            )
        _revalidate_refinement(call)
        return _apply_replacements(
            tracks, alternatives, response.replacements[:_MAX_REPLACEMENTS]
        )
    except Exception:
        # Provider errors can contain private prompt/response data. Do not log them.
        log.debug("Music path refinement unavailable; retaining deterministic path")
        return tracks


def _legacy_refinement_enabled(context: dict) -> bool:
    if context["mode"] != "legacy":
        return True
    if get_setting(_REFINEMENT_ENABLED_SETTING, "true") != "true":
        return False
    return context["provider"] != "ollama" or _ollama_refinement_is_explicitly_enabled()


def _revalidate_refinement(call: dict) -> None:
    revalidate_call(call)
    if not _legacy_refinement_enabled(call["context"]):
        raise ValueError("Legacy refinement disabled")


def _cache_key(context: dict, prompt: str) -> str:
    # Hash the actual inputs (including geography and artist genres), response
    # contract, and full private model/profile/credential/options identity.
    identity = {
        **context,
        "prompt_fingerprint": _fingerprint([_SYSTEM_PROMPT, prompt]),
        "schema_fingerprint": _fingerprint(
            MusicPathLlmRefinementResponse.model_json_schema()
        ),
    }
    return f"paths:llm_refinement:v2:{context_fingerprint(identity)}"


def _fingerprint(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _ollama_refinement_is_explicitly_enabled() -> bool:
    if os.environ.get("CRATE_ENABLE_PATH_LLM_REFINEMENT", "").strip() == "1":
        return True
    if os.environ.get("LLM_PROVIDER", "").strip().startswith("ollama/"):
        return True
    try:
        return bool(str(get_setting("llm_model", "") or "").strip())
    except Exception:
        return False


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
