from __future__ import annotations

from dataclasses import dataclass, field, fields, replace


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


# The six components of the v3 candidate score, in ``CandidateScore`` order.
CANDIDATE_COMPONENTS = (
    "alignment",
    "energy",
    "harmonic",
    "stability",
    "bass",
    "position",
)


@dataclass(frozen=True, slots=True)
class CandidateWeights:
    """Weights of the v3 candidate score (``crate.smart_mix.candidates``).

    The first six weigh components in [0, 1] and add up to 1. ``vocal`` weighs the
    penalty for voice over voice, which only applies when both profiles carry the
    voice per phrase. ``drums_only_entry`` and ``vocal_free_exit`` weigh two bonuses
    of the stems layer (Smart Mix Stems, STEM-D5), which only apply when both
    profiles carry one.
    """

    alignment: float = 0.25
    energy: float = 0.20
    harmonic: float = 0.15
    stability: float = 0.10
    bass: float = 0.15
    position: float = 0.15
    vocal: float = 6.0
    drums_only_entry: float = 0.05
    vocal_free_exit: float = 0.05

    def components(self) -> tuple[tuple[str, float], ...]:
        """The six component weights, in ``CandidateScore`` order."""
        return tuple((name, getattr(self, name)) for name in CANDIDATE_COMPONENTS)


CANDIDATE_WEIGHTS = CandidateWeights()


@dataclass(frozen=True, slots=True)
class PlannerPolicy:
    version: int = 2
    identifier: str = "smart-mix-v2"
    rules_revision: int = 7
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
    fade_reference_db: float = 6.0
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
    # Candidate menu (SM3-D3). Only the v3 generator reads these; v2 plans one window.
    phrase_lengths: tuple[int, ...] = (8, 16, 32)
    max_candidates: int = 8
    outgoing_phrase_choices: int = 4
    incoming_phrase_choices: int = 3
    # Phrases of a lower structure confidence are ignored (the bar heuristic plans
    # the edge). 0 uses every stored segmentation: at SG1 the confidence did not
    # separate good tracks from bad ones, and every phrase starts on a downbeat.
    minimum_structure_confidence: float = 0.0
    candidate_weights: CandidateWeights = field(
        default_factory=lambda: CANDIDATE_WEIGHTS
    )
    # Energy step (0-1 profile scale) at the handoff that scores 0.
    candidate_energy_step_limit: float = 0.3
    # Music left unplayed (outgoing) or skipped (incoming) that scores 0.
    candidate_position_limit_ms: int = 60_000
    # Voice over voice is penalised in proportion to its time at full level, over
    # the longest blend, so the penalty never saturates: weights.vocal per this.
    candidate_vocal_reference_ms: int = 48_000
    # Phase offsets this close to a whole beat start the incoming on the beat
    # instead of one beat late (grids are rounded to whole milliseconds).
    candidate_phase_snap_ms: int = 5
    # Smart Mix Stems (STEM-D5): score v3 candidates with the stems layer when both
    # profiles of an edge carry one. Gate STEM-G1 decides whether it stays on.
    stems_layer: bool = False


PLANNER_POLICY = PlannerPolicy()
# Smart Mix 3 planner: the v2 policy with its own identity and rules revision. The
# safety limits (tempo, gain, true peak, durations) are v2's and must stay so.
# Revision 2 adds the stems layer (Smart Mix Stems, ST3); without stems on both
# tracks its menus are revision 1's.
PLANNER_POLICY_V3 = replace(
    PLANNER_POLICY,
    identifier="smart-mix-v3",
    rules_revision=2,
    stems_layer=True,
)


__all__ = [
    "BEATMATCH_FIT_WEIGHTS",
    "CANDIDATE_COMPONENTS",
    "CANDIDATE_WEIGHTS",
    "CandidateWeights",
    "PLANNER_POLICY",
    "PLANNER_POLICY_V3",
    "PlannerPolicy",
    "SMOOTH_FIT_WEIGHTS",
    "TransitionFitWeights",
]
