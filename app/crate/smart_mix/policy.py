from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PlannerPolicy:
    version: int = 2
    identifier: str = "smart-mix-v2"
    minimum_bpm_confidence: float = 0.75
    minimum_tempo_stability: float = 0.80
    maximum_tempo_adjustment: float = 0.04
    hard_maximum_tempo_adjustment: float = 0.06
    fallback_duration_ms: int = 3_000
    manual_ramp_ms: int = 350
    minimum_transition_ms: int = 1_000
    maximum_transition_ms: int = 12_000
    minimum_outgoing_body_ratio: float = 0.5
    minimum_outgoing_body_ms: int = 30_000
    minimum_incoming_body_ms: int = 10_000
    max_loudness_adjustment_db: float = 6.0
    maximum_unaccredited_gain_db: float = 0.0
    combined_true_peak_ceiling_dbfs: float = -1.0
    equal_power_midpoint_headroom_db: float = 3.0103
    tempo_weight: float = 0.28
    harmonic_weight: float = 0.22
    energy_weight: float = 0.18
    danceability_weight: float = 0.10
    valence_weight: float = 0.07
    bliss_weight: float = 0.10
    genre_weight: float = 0.05
    harmonic_same_score: float = 1.0
    harmonic_relative_score: float = 0.9
    harmonic_adjacent_score: float = 0.8
    harmonic_incompatible_score: float = 0.3
    harmonic_unknown_score: float = 0.5
    neutral_dimension_score: float = 0.5


PLANNER_POLICY = PlannerPolicy()


__all__ = ["PLANNER_POLICY", "PlannerPolicy"]
