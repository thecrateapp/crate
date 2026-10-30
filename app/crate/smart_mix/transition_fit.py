from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Literal, Mapping

from crate.smart_mix.camelot import CamelotRelationship, camelot_relationship
from crate.smart_mix.models import MixProfileQuality, TrackMixProfile
from crate.smart_mix.policy import (
    PLANNER_POLICY,
    PlannerPolicy,
    TransitionFitWeights,
)
from crate.smart_mix.versions import MEASUREMENT_VERSION


TransitionFitMode = Literal["auto", "beatmatch", "smooth"]

TRANSITION_EDGE_COLUMNS = (
    "quality",
    "bpm",
    "bpm_confidence",
    "tempo_stability",
    "intro_tempo_stability",
    "outro_tempo_stability",
    "time_signature",
    "beat_anchor_ms",
    "key_camelot",
    "intro_lufs",
    "outro_lufs",
    "measurement_version",
    "intro_energy",
    "outro_energy",
    "intro_spectral_density",
    "outro_spectral_density",
    "duration_ms",
    "active_start_ms",
    "active_end_ms",
    "danceability",
    "valence",
)
TRANSITION_EDGE_PREFIX = "mix_"

_ENERGY_DB_RANGE = 60.0

_GENRE_BEATMATCH_PRIORS: tuple[tuple[str, float], ...] = (
    ("uk garage", 0.85),
    ("speed garage", 0.85),
    ("garage rock", 0.15),
    ("garage punk", 0.15),
    ("drum and bass", 0.95),
    ("drum & bass", 0.95),
    ("drum n bass", 0.95),
    ("dnb", 0.95),
    ("jungle", 0.85),
    ("hardcore techno", 0.95),
    ("happy hardcore", 0.9),
    ("techno", 0.95),
    ("house", 0.95),
    ("trance", 0.95),
    ("hardstyle", 0.95),
    ("dubstep", 0.85),
    ("breakbeat", 0.85),
    ("edm", 0.9),
    ("eurodance", 0.85),
    ("metal", 0.1),
    ("punk", 0.15),
    ("rock", 0.15),
    ("hardcore", 0.15),
    ("grunge", 0.15),
    ("shoegaze", 0.15),
    ("emo", 0.15),
    ("electro", 0.8),
    ("disco", 0.8),
    ("dance", 0.75),
    ("synthwave", 0.6),
    ("trap", 0.65),
    ("hip hop", 0.6),
    ("hip-hop", 0.6),
    ("rap", 0.6),
    ("funk", 0.55),
    ("dub", 0.5),
    ("r&b", 0.5),
    ("rnb", 0.5),
    ("idm", 0.45),
    ("trip hop", 0.45),
    ("trip-hop", 0.45),
    ("downtempo", 0.45),
    ("soul", 0.4),
    ("reggae", 0.4),
    ("pop", 0.4),
    ("ambient", 0.2),
    ("indie", 0.2),
    ("singer-songwriter", 0.1),
    ("folk", 0.1),
    ("country", 0.1),
    ("blues", 0.1),
    ("jazz", 0.1),
    ("soundtrack", 0.1),
    ("classical", 0.05),
)


@dataclass(frozen=True, slots=True)
class TransitionEdges:
    bpm: float | None = None
    bpm_confidence: float | None = None
    tempo_stability: float | None = None
    intro_tempo_stability: float | None = None
    outro_tempo_stability: float | None = None
    time_signature: int | None = None
    has_beat_reference: bool = False
    camelot: str | None = None
    intro_lufs: float | None = None
    outro_lufs: float | None = None
    accredited_loudness: bool = False
    intro_energy: float | None = None
    outro_energy: float | None = None
    intro_density: float | None = None
    outro_density: float | None = None
    leading_silence_ms: int | None = None
    trailing_silence_ms: int | None = None
    danceability: float | None = None
    valence: float | None = None

    @classmethod
    def from_profile(cls, profile: TrackMixProfile) -> TransitionEdges:
        return cls(
            bpm=profile.bpm,
            bpm_confidence=profile.bpm_confidence,
            tempo_stability=profile.tempo_stability,
            intro_tempo_stability=profile.intro_tempo_stability,
            outro_tempo_stability=profile.outro_tempo_stability,
            time_signature=profile.time_signature,
            has_beat_reference=profile.beat_anchor_ms is not None,
            camelot=profile.camelot,
            intro_lufs=profile.intro_lufs,
            outro_lufs=profile.outro_lufs,
            accredited_loudness=profile.measurement_version == MEASUREMENT_VERSION,
            intro_energy=profile.intro_energy,
            outro_energy=profile.outro_energy,
            intro_density=profile.intro_spectral_density,
            outro_density=profile.outro_spectral_density,
            leading_silence_ms=profile.active_start_ms,
            trailing_silence_ms=_trailing_silence(
                profile.duration_ms, profile.active_end_ms
            ),
            danceability=profile.danceability,
            valence=profile.valence,
        )

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> TransitionEdges | None:
        def value(name: str) -> Any:
            return row.get(f"{TRANSITION_EDGE_PREFIX}{name}")

        quality = value("quality")
        if quality is None or quality == MixProfileQuality.UNAVAILABLE.value:
            return None
        return cls(
            bpm=_optional_float(value("bpm")),
            bpm_confidence=_optional_float(value("bpm_confidence")),
            tempo_stability=_optional_float(value("tempo_stability")),
            intro_tempo_stability=_optional_float(value("intro_tempo_stability")),
            outro_tempo_stability=_optional_float(value("outro_tempo_stability")),
            time_signature=_optional_int(value("time_signature")),
            has_beat_reference=value("beat_anchor_ms") is not None,
            camelot=value("key_camelot"),
            intro_lufs=_optional_float(value("intro_lufs")),
            outro_lufs=_optional_float(value("outro_lufs")),
            accredited_loudness=value("measurement_version") == MEASUREMENT_VERSION,
            intro_energy=_optional_float(value("intro_energy")),
            outro_energy=_optional_float(value("outro_energy")),
            intro_density=_optional_float(value("intro_spectral_density")),
            outro_density=_optional_float(value("outro_spectral_density")),
            leading_silence_ms=_optional_int(value("active_start_ms")),
            trailing_silence_ms=_trailing_silence(
                _optional_int(value("duration_ms")),
                _optional_int(value("active_end_ms")),
            ),
            danceability=_optional_float(
                _first_present(row.get("danceability"), value("danceability"))
            ),
            valence=_optional_float(
                _first_present(row.get("valence"), value("valence"))
            ),
        )


@dataclass(frozen=True, slots=True)
class TransitionFit:
    overall: float
    beatmatch_affinity: float
    beatmatchable: bool
    tempo: float
    tempo_flow: float
    harmonic: float
    harmonic_relationship: str
    level: float
    brightness: float
    silence: float
    mood: float


def score_transition_fit(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
    *,
    beatmatch_affinity: float,
    policy: PlannerPolicy = PLANNER_POLICY,
) -> TransitionFit:
    affinity = _unit(beatmatch_affinity)
    neutral = policy.neutral_dimension_score
    ratio_difference = _tempo_difference(outgoing.bpm, incoming.bpm)
    tempo = (
        neutral
        if ratio_difference is None
        else _linear_score(ratio_difference, 0.0, policy.strict_tempo_tolerance)
    )
    tempo_flow = (
        neutral
        if ratio_difference is None
        else _linear_score(ratio_difference, 0.0, policy.relaxed_tempo_tolerance)
    )
    relationship = camelot_relationship(outgoing.camelot, incoming.camelot)
    harmonic = harmonic_score(relationship, policy)
    beatmatchable = _beatmatchable(outgoing, incoming, ratio_difference, policy)
    level = _level_score(outgoing, incoming, policy)
    brightness = _brightness_score(outgoing, incoming, policy)
    silence = _silence_score(outgoing, incoming, policy)
    mood = _mood_score(outgoing, incoming, policy)
    dimensions = {
        "tempo": tempo,
        "tempo_flow": tempo_flow,
        "harmonic": harmonic,
        "beatmatchable": 1.0 if beatmatchable else 0.0,
        "level": level,
        "brightness": brightness,
        "silence": silence,
        "mood": mood,
    }
    beatmatch_score = _weighted(dimensions, policy.beatmatch_fit_weights)
    smooth_score = _weighted(dimensions, policy.smooth_fit_weights)
    return TransitionFit(
        overall=_round(affinity * beatmatch_score + (1.0 - affinity) * smooth_score),
        beatmatch_affinity=_round(affinity),
        beatmatchable=beatmatchable,
        tempo=_round(tempo),
        tempo_flow=_round(tempo_flow),
        harmonic=_round(harmonic),
        harmonic_relationship=relationship.value,
        level=_round(level),
        brightness=_round(brightness),
        silence=_round(silence),
        mood=_round(mood),
    )


def beatmatch_affinity(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
    *,
    mode: TransitionFitMode = "auto",
    genre_prior: float | None = None,
    policy: PlannerPolicy = PLANNER_POLICY,
) -> float:
    if mode == "beatmatch":
        return 1.0
    if mode == "smooth":
        return 0.0
    prior = policy.default_beatmatch_prior if genre_prior is None else genre_prior
    return _round(_unit(prior) * _rhythm_evidence(outgoing, incoming, policy))


def genre_beatmatch_prior(
    genres: Mapping[str, float] | Iterable[str] | None,
) -> float | None:
    if not genres:
        return None
    weighted = (
        genres.items()
        if isinstance(genres, Mapping)
        else ((genre, 1.0) for genre in genres)
    )
    total = 0.0
    weight_sum = 0.0
    for genre, weight in weighted:
        prior = _genre_prior(str(genre))
        if prior is None or weight is None or float(weight) <= 0.0:
            continue
        total += prior * float(weight)
        weight_sum += float(weight)
    return _round(total / weight_sum) if weight_sum > 0.0 else None


def pair_genre_prior(left: float | None, right: float | None) -> float | None:
    known = [value for value in (left, right) if value is not None]
    return _round(sum(known) / len(known)) if known else None


def harmonic_score(
    relationship: CamelotRelationship,
    policy: PlannerPolicy = PLANNER_POLICY,
) -> float:
    return {
        CamelotRelationship.SAME: policy.harmonic_same_score,
        CamelotRelationship.RELATIVE: policy.harmonic_relative_score,
        CamelotRelationship.ADJACENT: policy.harmonic_adjacent_score,
        CamelotRelationship.INCOMPATIBLE: policy.harmonic_incompatible_score,
        CamelotRelationship.UNKNOWN: policy.harmonic_unknown_score,
    }[relationship]


def normalized_tempo(reference_bpm: float, candidate_bpm: float) -> float:
    options = (candidate_bpm * 0.5, candidate_bpm, candidate_bpm * 2.0)
    return min(options, key=lambda value: abs(value - reference_bpm))


def tempo_ratio(outgoing_bpm: float | None, incoming_bpm: float | None) -> float:
    if not outgoing_bpm or not incoming_bpm:
        return 1.0
    normalized_incoming = normalized_tempo(float(outgoing_bpm), float(incoming_bpm))
    return float(outgoing_bpm) / normalized_incoming


def _genre_prior(genre: str) -> float | None:
    normalized = " ".join(genre.casefold().replace("_", " ").split())
    if not normalized:
        return None
    for keyword, prior in _GENRE_BEATMATCH_PRIORS:
        if keyword in normalized:
            return prior
    return None


def _tempo_difference(
    outgoing_bpm: float | None, incoming_bpm: float | None
) -> float | None:
    if not outgoing_bpm or not incoming_bpm:
        return None
    return abs(tempo_ratio(outgoing_bpm, incoming_bpm) - 1.0)


def _rhythm_evidence(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
    policy: PlannerPolicy,
) -> float:
    values = (
        outgoing.bpm_confidence,
        incoming.bpm_confidence,
        _edge_stability(outgoing.outro_tempo_stability, outgoing.tempo_stability),
        _edge_stability(incoming.intro_tempo_stability, incoming.tempo_stability),
    )
    known = [float(value) for value in values if value is not None]
    if len(known) < len(values):
        return 0.0
    return 1.0 - _linear_score(
        min(known),
        policy.rhythm_evidence_floor,
        policy.rhythm_evidence_ceiling,
    )


def _beatmatchable(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
    ratio_difference: float | None,
    policy: PlannerPolicy,
) -> bool:
    if ratio_difference is None:
        return False
    if not outgoing.has_beat_reference or not incoming.has_beat_reference:
        return False
    if (
        outgoing.bpm_confidence is None
        or incoming.bpm_confidence is None
        or min(outgoing.bpm_confidence, incoming.bpm_confidence)
        < policy.minimum_bpm_confidence
    ):
        return False
    outgoing_stability = _edge_stability(
        outgoing.outro_tempo_stability, outgoing.tempo_stability
    )
    incoming_stability = _edge_stability(
        incoming.intro_tempo_stability, incoming.tempo_stability
    )
    if (
        outgoing_stability is None
        or incoming_stability is None
        or min(outgoing_stability, incoming_stability) < policy.minimum_tempo_stability
    ):
        return False
    if (
        outgoing.time_signature is not None
        and incoming.time_signature is not None
        and outgoing.time_signature != incoming.time_signature
    ):
        return False
    return ratio_difference <= policy.maximum_tempo_adjustment


def _level_score(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
    policy: PlannerPolicy,
) -> float:
    jump = _level_jump_db(outgoing, incoming)
    if jump is None:
        return policy.neutral_dimension_score
    if jump >= 0.0:
        return _linear_score(
            jump, policy.level_rise_tolerance_db, policy.level_rise_limit_db
        )
    return _linear_score(
        -jump, policy.level_drop_tolerance_db, policy.level_drop_limit_db
    )


def _level_jump_db(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
) -> float | None:
    if (
        outgoing.outro_lufs is not None
        and incoming.intro_lufs is not None
        and outgoing.accredited_loudness
        and incoming.accredited_loudness
    ):
        return float(incoming.intro_lufs) - float(outgoing.outro_lufs)
    if outgoing.outro_energy is not None and incoming.intro_energy is not None:
        return (
            float(incoming.intro_energy) - float(outgoing.outro_energy)
        ) * _ENERGY_DB_RANGE
    return None


def _brightness_score(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
    policy: PlannerPolicy,
) -> float:
    if outgoing.outro_density is None or incoming.intro_density is None:
        return policy.neutral_dimension_score
    return _linear_score(
        abs(float(incoming.intro_density) - float(outgoing.outro_density)),
        0.0,
        policy.brightness_tolerance,
    )


def _silence_score(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
    policy: PlannerPolicy,
) -> float:
    if outgoing.trailing_silence_ms is None or incoming.leading_silence_ms is None:
        return policy.neutral_dimension_score
    return _linear_score(
        float(outgoing.trailing_silence_ms + incoming.leading_silence_ms),
        float(policy.silence_tolerance_ms),
        float(policy.silence_limit_ms),
    )


def _mood_score(
    outgoing: TransitionEdges,
    incoming: TransitionEdges,
    policy: PlannerPolicy,
) -> float:
    scores = [
        1.0 - min(1.0, abs(float(left) - float(right)))
        for left, right in (
            (outgoing.danceability, incoming.danceability),
            (outgoing.valence, incoming.valence),
        )
        if left is not None and right is not None
    ]
    if not scores:
        return policy.neutral_dimension_score
    return sum(scores) / len(scores)


def _weighted(dimensions: Mapping[str, float], weights: TransitionFitWeights) -> float:
    total = 0.0
    weight_sum = 0.0
    for name, weight in weights.items():
        total += dimensions[name] * weight
        weight_sum += weight
    return total / weight_sum if weight_sum > 0.0 else 0.0


def _linear_score(value: float, tolerance: float, limit: float) -> float:
    if limit <= tolerance:
        return 1.0 if value <= tolerance else 0.0
    return _unit(1.0 - (value - tolerance) / (limit - tolerance))


def _edge_stability(edge: float | None, overall: float | None) -> float | None:
    return edge if edge is not None else overall


def _trailing_silence(duration_ms: int | None, active_end_ms: int | None) -> int | None:
    if duration_ms is None or active_end_ms is None:
        return None
    return max(0, int(duration_ms) - int(active_end_ms))


def _first_present(*values: Any) -> Any:
    return next((value for value in values if value is not None), None)


def _optional_float(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: Any) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def _unit(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _round(value: float) -> float:
    return round(_unit(value), 4)


__all__ = [
    "TRANSITION_EDGE_COLUMNS",
    "TRANSITION_EDGE_PREFIX",
    "TransitionEdges",
    "TransitionFit",
    "TransitionFitMode",
    "beatmatch_affinity",
    "genre_beatmatch_prior",
    "harmonic_score",
    "normalized_tempo",
    "pair_genre_prior",
    "score_transition_fit",
    "tempo_ratio",
]
