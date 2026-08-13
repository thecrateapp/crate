"""Shared queue planning primitives.

Candidate retrieval remains owned by each surface (radio, home, or Jam), while
this module owns the semantics that must not diverge between them: identity,
variant families, diversity, collective feedback, and refill state.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Any

from crate.track_versions import canonical_track_title_key

_PUNCTUATION_RE = re.compile(r"[^\w\s]")
_VERSION_TOKENS = frozenset(
    {
        "acoustic",
        "alternate",
        "alt",
        "bootleg",
        "demo",
        "deluxe",
        "edit",
        "extended",
        "instrumental",
        "live",
        "mix",
        "mono",
        "radio",
        "re-recorded",
        "remaster",
        "remastered",
        "remix",
        "session",
        "stereo",
        "version",
    }
)

_MOOD_FILTERS: dict[str, dict[str, float]] = {
    "energetic": {"energy_min": 0.7, "danceability_min": 0.5},
    "chill": {"energy_max": 0.4, "valence_min": 0.3},
    "dark": {"valence_max": 0.3, "energy_min": 0.4},
    "happy": {"valence_min": 0.6, "energy_min": 0.4},
    "melancholy": {"valence_max": 0.35, "energy_max": 0.5},
    "intense": {"energy_min": 0.8},
    "groovy": {"danceability_min": 0.65, "energy_min": 0.45},
    "acoustic": {"acousticness_min": 0.6},
}


@dataclass(frozen=True)
class QueueIntent:
    """Stable request shared by generated queue adapters."""

    profile: str
    listener_id: int | None = None
    seed_type: str | None = None
    seed_value: str | None = None
    genres: tuple[str, ...] = ()
    bpm_min: float | None = None
    bpm_max: float | None = None
    mood: str | None = None
    target_size: int = 20
    low_water_mark: int = 2
    max_per_artist: int | None = None
    avoid_variants: bool = True


@dataclass(frozen=True)
class QueueState:
    """Small storage-neutral state used to decide whether a queue needs refill."""

    queued_count: int
    remaining_count: int
    target_size: int
    low_water_mark: int = 2
    paused: bool = False


def _payload(candidate: dict[str, Any]) -> dict[str, Any]:
    nested = candidate.get("track")
    return nested if isinstance(nested, dict) else candidate


def _value(candidate: dict[str, Any], *keys: str) -> Any:
    payload = _payload(candidate)
    for key in keys:
        value = payload.get(key)
        if value is not None and value != "":
            return value
    if payload is not candidate:
        for key in keys:
            value = candidate.get(key)
            if value is not None and value != "":
                return value
    return None


def _normalise_text(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
    return _PUNCTUATION_RE.sub(" ", text).strip()


def candidate_id(candidate: dict[str, Any]) -> str:
    value = _value(
        candidate,
        "id",
        "track_id",
        "entityUid",
        "track_entity_uid",
        "entity_uid",
        "path",
        "track_path",
    )
    return str(value or "")


def candidate_artist_key(candidate: dict[str, Any]) -> str:
    return _normalise_text(_value(candidate, "artist", "artist_name", "album_artist"))


def candidate_title(candidate: dict[str, Any]) -> str:
    return str(_value(candidate, "title", "name") or "")


def _numeric_value(candidate: dict[str, Any], key: str) -> float | None:
    value = _value(candidate, key)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def candidate_matches_intent(candidate: dict[str, Any], intent: QueueIntent) -> bool:
    """Apply the hard scalar constraints shared by generated queue surfaces."""

    bpm = _numeric_value(candidate, "bpm")
    if intent.bpm_min is not None and (bpm is None or bpm < intent.bpm_min):
        return False
    if intent.bpm_max is not None and (bpm is None or bpm > intent.bpm_max):
        return False

    mood = _normalise_text(intent.mood)
    for key, bound in _MOOD_FILTERS.get(mood, {}).items():
        feature, suffix = key.rsplit("_", 1)
        value = _numeric_value(candidate, feature)
        if value is None:
            return False
        if suffix == "min" and value < bound:
            return False
        if suffix == "max" and value > bound:
            return False
    return True


def candidate_song_key(candidate: dict[str, Any]) -> tuple[str, str] | None:
    """Return the canonical artist/title identity for flat or nested tracks."""

    artist = candidate_artist_key(candidate)
    title = canonical_track_title_key(candidate_title(candidate))
    if not artist or not title:
        return None
    return artist, title


def candidate_family_key(candidate: dict[str, Any]) -> str:
    """Return the canonical song family shared by normal and variant versions."""

    identity = candidate_song_key(candidate)
    if identity is None:
        return ""
    artist, title = identity

    tokens = [
        token
        for token in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)?", title)
        if token not in _VERSION_TOKENS
    ]
    if not tokens:
        return ""
    return f"{artist}|{' '.join(tokens)}"


def candidate_album_key(candidate: dict[str, Any]) -> str:
    return _normalise_text(_value(candidate, "album", "album_name", "album_title"))


def select_diverse_candidates(
    candidates: list[dict[str, Any]],
    *,
    limit: int,
    max_per_artist: int | None = None,
    existing_candidates: list[dict[str, Any]] | None = None,
    avoid_variants: bool = True,
) -> list[dict[str, Any]]:
    """Select candidates without repeating tracks, song families, or artists."""

    if limit <= 0:
        return []

    existing = existing_candidates or []
    seen_ids = {candidate_id(row) for row in existing if candidate_id(row)}
    seen_families = {
        candidate_family_key(row) for row in existing if candidate_family_key(row)
    }
    artist_counts: dict[str, int] = {}
    for row in existing:
        artist = candidate_artist_key(row)
        if artist:
            artist_counts[artist] = artist_counts.get(artist, 0) + 1

    selected: list[dict[str, Any]] = []
    for candidate in candidates:
        if len(selected) >= limit:
            break
        identity = candidate_id(candidate)
        if not identity or identity in seen_ids:
            continue
        family = candidate_family_key(candidate)
        if avoid_variants and family and family in seen_families:
            continue
        artist = candidate_artist_key(candidate)
        if (
            max_per_artist is not None
            and artist
            and artist_counts.get(artist, 0) >= max_per_artist
        ):
            continue

        selected.append(candidate)
        seen_ids.add(identity)
        if family:
            seen_families.add(family)
        if artist:
            artist_counts[artist] = artist_counts.get(artist, 0) + 1

    return selected


def _valid_vector(value: object) -> list[float]:
    if not isinstance(value, list) or not value:
        return []
    try:
        vector = [float(item) for item in value]
    except (TypeError, ValueError):
        return []
    if not all(math.isfinite(item) for item in vector):
        return []
    return vector


def collective_vote_target(votes: list[dict[str, Any]]) -> tuple[list[float], int]:
    """Return the vote-weighted Bliss centroid and number of valid votes."""

    weighted: list[float] | None = None
    total_votes = 0
    for vote in votes:
        vector = _valid_vector(vote.get("bliss_vector") or vote.get("blissVector"))
        if not vector:
            continue
        try:
            count = int(vote.get("vote_count") or vote.get("votes") or 1)
        except (TypeError, ValueError):
            count = 1
        if count <= 0:
            continue
        if weighted is None:
            weighted = [0.0] * len(vector)
        if len(vector) != len(weighted):
            continue
        for index, value in enumerate(vector):
            weighted[index] += value * count
        total_votes += count

    if not weighted or total_votes <= 0:
        return [], 0
    return [value / total_votes for value in weighted], total_votes


def blend_target_towards(
    current_target: list[float],
    feedback_target: list[float],
    *,
    feedback_count: int,
    blend_step: float = 0.08,
    max_blend: float = 0.4,
) -> list[float]:
    """Apply capped collective feedback using the same curve as Discovery Radio."""

    if not current_target or not feedback_target:
        return list(current_target)
    if len(current_target) != len(feedback_target) or feedback_count <= 0:
        return list(current_target)
    blend = min(max_blend, max(0.0, blend_step * feedback_count))
    return [
        current + (feedback - current) * blend
        for current, feedback in zip(current_target, feedback_target, strict=True)
    ]


def needs_refill(state: QueueState) -> bool:
    """Return whether a non-paused queue has crossed its refill threshold."""

    return (
        not state.paused
        and state.target_size > 0
        and state.queued_count < state.target_size
        and state.remaining_count <= max(0, state.low_water_mark)
    )


def generation_seed(
    *,
    listener_id: int | None,
    context: str,
    session_id: str | None = None,
    reference_day: date | str | None = None,
) -> int:
    day = reference_day or date.today().isoformat()
    payload = f"{listener_id or 0}:{context}:{session_id or ''}:{day}"
    return int.from_bytes(hashlib.sha256(payload.encode()).digest()[:8], "big")


__all__ = [
    "QueueIntent",
    "QueueState",
    "blend_target_towards",
    "candidate_album_key",
    "candidate_artist_key",
    "candidate_family_key",
    "candidate_id",
    "candidate_matches_intent",
    "candidate_song_key",
    "candidate_title",
    "collective_vote_target",
    "generation_seed",
    "needs_refill",
    "select_diverse_candidates",
]
