from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Iterable, Sequence

from crate.smart_mix.models import MixProfileQuality, TrackMixProfile
from crate.smart_mix.planner import CompatibilityScore, score_compatibility
from crate.smart_mix.policy import PLANNER_POLICY_V1, PlannerPolicyV1


_VARIANT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("live", re.compile(r"\blive\b", re.IGNORECASE)),
    ("demo", re.compile(r"\bdemo\b", re.IGNORECASE)),
    (
        "remaster",
        re.compile(r"\b(?:re)?master(?:ed)?\b|\bremaster\b", re.IGNORECASE),
    ),
    ("remix", re.compile(r"\b(?:re)?mix(?:ed)?\b", re.IGNORECASE)),
    ("acoustic", re.compile(r"\bacoustic\b", re.IGNORECASE)),
    (
        "alternate",
        re.compile(r"\b(?:alternate|alternative|alt\.?)\s+(?:take|version)\b", re.I),
    ),
)
_VARIANT_SUFFIX_RE = re.compile(r"\s*[\[(][^\])]*[\])]\s*$")


@dataclass(frozen=True, slots=True)
class CompatibleTrackCandidate:
    track_id: int
    track_entity_uid: str
    title: str
    artist: str
    album: str
    profile: TrackMixProfile
    recording_mbid: str | None = None
    bliss_vector: tuple[float, ...] = ()
    genres: frozenset[str] = frozenset()
    playable: bool = True


@dataclass(frozen=True, slots=True)
class CompatibleTrackResult:
    track_id: int
    track_entity_uid: str
    title: str
    artist: str
    album: str
    score: float
    confidence: float
    score_breakdown: CompatibilityScore
    fallback_reasons: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "trackId": self.track_id,
            "trackEntityUid": self.track_entity_uid,
            "title": self.title,
            "artist": self.artist,
            "album": self.album,
            "score": self.score,
            "confidence": self.confidence,
            "scoreBreakdown": self.score_breakdown.to_dict(),
            "fallbackReasons": list(self.fallback_reasons),
        }


def rank_compatible_tracks(
    seed: CompatibleTrackCandidate,
    candidates: Iterable[CompatibleTrackCandidate],
    *,
    limit: int,
    policy: PlannerPolicyV1 = PLANNER_POLICY_V1,
) -> list[CompatibleTrackResult]:
    capped_limit = max(1, min(int(limit), 100))
    seed_variant = _variant(seed.title)
    scored: list[tuple[CompatibleTrackCandidate, CompatibleTrackResult]] = []
    for candidate in candidates:
        if (
            not candidate.playable
            or candidate.track_entity_uid == seed.track_entity_uid
            or candidate.profile.quality is MixProfileQuality.UNAVAILABLE
        ):
            continue
        breakdown = score_compatibility(
            seed.profile,
            candidate.profile,
            bliss_similarity=_cosine_similarity(
                seed.bliss_vector,
                candidate.bliss_vector,
            ),
            genre_similarity=_genre_similarity(seed.genres, candidate.genres),
            policy=policy,
        )
        fallback_reasons = _fallback_reasons(candidate, breakdown, policy)
        result = CompatibleTrackResult(
            track_id=candidate.track_id,
            track_entity_uid=candidate.track_entity_uid,
            title=candidate.title,
            artist=candidate.artist,
            album=candidate.album,
            score=breakdown.overall,
            confidence=breakdown.signal_confidence,
            score_breakdown=breakdown,
            fallback_reasons=fallback_reasons,
        )
        scored.append((candidate, result))

    deduplicated: dict[
        tuple[str, str],
        tuple[CompatibleTrackCandidate, CompatibleTrackResult],
    ] = {}
    for candidate, result in scored:
        key = _recording_key(candidate)
        current = deduplicated.get(key)
        if current is None or _variant_choice_key(
            candidate,
            result,
            seed_variant,
        ) < _variant_choice_key(current[0], current[1], seed_variant):
            deduplicated[key] = (candidate, result)

    ranked = [item[1] for item in deduplicated.values()]
    ranked.sort(
        key=lambda item: (
            -item.score,
            -item.confidence,
            item.artist.casefold(),
            item.title.casefold(),
            item.track_entity_uid,
        )
    )
    return ranked[:capped_limit]


def _fallback_reasons(
    candidate: CompatibleTrackCandidate,
    breakdown: CompatibilityScore,
    policy: PlannerPolicyV1,
) -> tuple[str, ...]:
    reasons: list[str] = []
    if (
        candidate.profile.quality is not MixProfileQuality.FULL
        or breakdown.signal_confidence < policy.minimum_bpm_confidence
    ):
        reasons.append("low_confidence")
    if breakdown.harmonic_relationship == "incompatible":
        reasons.append("incompatible_harmonic")
    return tuple(reasons)


def _recording_key(candidate: CompatibleTrackCandidate) -> tuple[str, str]:
    if candidate.recording_mbid:
        return "mbid", candidate.recording_mbid.casefold()
    return (
        candidate.artist.casefold().strip(),
        _base_title(candidate.title),
    )


def _base_title(title: str) -> str:
    normalized = title.casefold().strip()
    while True:
        match = _VARIANT_SUFFIX_RE.search(normalized)
        if match is None or _variant(match.group(0)) == "canonical":
            break
        normalized = normalized[: match.start()].strip()
    return re.sub(r"\s+", " ", normalized)


def _variant(title: str) -> str:
    for name, pattern in _VARIANT_PATTERNS:
        if pattern.search(title):
            return name
    return "canonical"


def _variant_choice_key(
    candidate: CompatibleTrackCandidate,
    result: CompatibleTrackResult,
    seed_variant: str,
) -> tuple[float, float, float, str]:
    candidate_variant = _variant(candidate.title)
    if seed_variant != "canonical" and candidate_variant == seed_variant:
        preference = 0.0
    elif candidate_variant == "canonical":
        preference = 1.0 if seed_variant != "canonical" else 0.0
    else:
        preference = {
            "remaster": 2.0,
            "remix": 3.0,
            "acoustic": 4.0,
            "alternate": 5.0,
            "live": 6.0,
            "demo": 7.0,
        }.get(candidate_variant, 8.0)
    return (
        preference,
        -result.score,
        -result.confidence,
        candidate.track_entity_uid,
    )


def _cosine_similarity(
    left: Sequence[float],
    right: Sequence[float],
) -> float | None:
    if not left or not right or len(left) != len(right):
        return None
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_magnitude = math.sqrt(sum(value * value for value in left))
    right_magnitude = math.sqrt(sum(value * value for value in right))
    if left_magnitude == 0.0 or right_magnitude == 0.0:
        return None
    return max(0.0, min(1.0, dot / (left_magnitude * right_magnitude)))


def _genre_similarity(
    left: frozenset[str],
    right: frozenset[str],
) -> float | None:
    if not left or not right:
        return None
    union = left | right
    return len(left & right) / len(union) if union else None


__all__ = [
    "CompatibleTrackCandidate",
    "CompatibleTrackResult",
    "rank_compatible_tracks",
]
