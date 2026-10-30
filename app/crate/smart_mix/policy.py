from __future__ import annotations

from dataclasses import dataclass, field, fields


@dataclass(frozen=True, slots=True)
class TransitionFitWeights:
    tempo: float = 0.0
    tempo_flow: float = 0.0
    harmonic: float = 0.0
    beatmatchable: float = 0.0
    level: float = 0.0
    brightness: float = 0.0
    silence: float = 0.0
    mood: float = 0.0

    def items(self) -> tuple[tuple[str, float], ...]:
        return tuple((item.name, getattr(self, item.name)) for item in fields(self))


BEATMATCH_FIT_WEIGHTS = TransitionFitWeights(
    tempo=0.30,
    harmonic=0.22,
    beatmatchable=0.14,
    level=0.12,
    brightness=0.06,
    silence=0.04,
    mood=0.12,
)
SMOOTH_FIT_WEIGHTS = TransitionFitWeights(
    tempo_flow=0.14,
    harmonic=0.08,
    level=0.30,
    brightness=0.16,
    silence=0.12,
    mood=0.20,
)


@dataclass(frozen=True, slots=True)
class PlannerPolicy:
    version: int = 2
    identifier: str = "smart-mix-v2"
    rules_revision: int = 6
    minimum_bpm_confidence: float = 0.75
    minimum_tempo_stability: float = 0.80
    minimum_beatmatch_beats: int = 8
    maximum_tempo_adjustment: float = 0.04
    hard_maximum_tempo_adjustment: float = 0.06
    fallback_duration_ms: int = 3_000
    manual_ramp_ms: int = 350
    minimum_transition_ms: int = 1_000
    maximum_transition_ms: int = 12_000
    maximum_long_beatmatch_ms: int = 48_000
    long_beatmatch_phrase_bars: tuple[int, ...] = (32, 16, 8)
    minimum_long_beatmatch_stability: float = 0.90
    minimum_outgoing_body_ratio: float = 0.5
    minimum_outgoing_body_ms: int = 30_000
    minimum_incoming_body_ms: int = 10_000
    max_loudness_adjustment_db: float = 6.0
    maximum_unaccredited_gain_db: float = 0.0
    combined_true_peak_ceiling_dbfs: float = -1.0
    equal_power_midpoint_headroom_db: float = 3.0103
    bliss_weight: float = 0.15
    genre_weight: float = 0.10
    strict_tempo_tolerance: float = 0.12
    relaxed_tempo_tolerance: float = 0.25
    default_beatmatch_prior: float = 0.35
    rhythm_evidence_floor: float = 0.5
    rhythm_evidence_ceiling: float = 0.9
    level_rise_tolerance_db: float = 1.5
    level_rise_limit_db: float = 9.0
    level_drop_tolerance_db: float = 3.0
    level_drop_limit_db: float = 15.0
    brightness_tolerance: float = 0.15
    silence_tolerance_ms: int = 1_500
    silence_limit_ms: int = 8_000
    beatmatch_fit_weights: TransitionFitWeights = field(
        default_factory=lambda: BEATMATCH_FIT_WEIGHTS
    )
    smooth_fit_weights: TransitionFitWeights = field(
        default_factory=lambda: SMOOTH_FIT_WEIGHTS
    )
    harmonic_same_score: float = 1.0
    harmonic_relative_score: float = 0.9
    harmonic_adjacent_score: float = 0.8
    harmonic_incompatible_score: float = 0.3
    harmonic_unknown_score: float = 0.5
    neutral_dimension_score: float = 0.5


PLANNER_POLICY = PlannerPolicy()


__all__ = [
    "BEATMATCH_FIT_WEIGHTS",
    "PLANNER_POLICY",
    "PlannerPolicy",
    "SMOOTH_FIT_WEIGHTS",
    "TransitionFitWeights",
]
