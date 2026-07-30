from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Literal, cast

from crate.smart_mix.camelot import CamelotRelationship, camelot_relationship
from crate.smart_mix.models import (
    MixProfileQuality,
    TrackMixProfile,
    TransitionContext,
    TransitionFallbackReason,
    TransitionMode,
    TransitionPlan,
)
from crate.smart_mix.policy import PLANNER_POLICY_V1, PlannerPolicyV1


HarmonicRelationshipValue = Literal[
    "same",
    "adjacent",
    "relative",
    "incompatible",
    "unknown",
]


@dataclass(frozen=True, slots=True)
class CompatibilityScore:
    planner_version: int
    overall: float
    signal_confidence: float
    tempo: float
    harmonic: float
    harmonic_relationship: HarmonicRelationshipValue
    energy: float
    danceability: float
    valence: float
    bliss: float
    genre: float

    def to_dict(self) -> dict[str, float | int | str]:
        return {
            "plannerVersion": self.planner_version,
            "overall": self.overall,
            "signalConfidence": self.signal_confidence,
            "tempo": self.tempo,
            "harmonic": self.harmonic,
            "harmonicRelationship": self.harmonic_relationship,
            "energy": self.energy,
            "danceability": self.danceability,
            "valence": self.valence,
            "bliss": self.bliss,
            "genre": self.genre,
        }


def score_compatibility(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    *,
    bliss_similarity: float | None = None,
    genre_similarity: float | None = None,
    policy: PlannerPolicyV1 = PLANNER_POLICY_V1,
) -> CompatibilityScore:
    tempo = _tempo_score(outgoing.bpm, incoming.bpm)
    relationship = camelot_relationship(outgoing.camelot, incoming.camelot)
    harmonic = _harmonic_score(relationship, policy)
    energy = _continuity_score(outgoing.outro_energy, incoming.intro_energy, policy)
    danceability = _continuity_score(
        outgoing.danceability,
        incoming.danceability,
        policy,
    )
    valence = _continuity_score(outgoing.valence, incoming.valence, policy)
    bliss = _optional_score(bliss_similarity, policy)
    genre = _optional_score(genre_similarity, policy)
    overall = (
        tempo * policy.tempo_weight
        + harmonic * policy.harmonic_weight
        + energy * policy.energy_weight
        + danceability * policy.danceability_weight
        + valence * policy.valence_weight
        + bliss * policy.bliss_weight
        + genre * policy.genre_weight
    )
    return CompatibilityScore(
        planner_version=policy.version,
        overall=_round_score(overall),
        signal_confidence=_signal_confidence(outgoing, incoming),
        tempo=_round_score(tempo),
        harmonic=_round_score(harmonic),
        harmonic_relationship=cast(HarmonicRelationshipValue, relationship.value),
        energy=_round_score(energy),
        danceability=_round_score(danceability),
        valence=_round_score(valence),
        bliss=_round_score(bliss),
        genre=_round_score(genre),
    )


def plan_transition(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    context: TransitionContext,
    *,
    outgoing_track_entity_uid: str | None = None,
    incoming_track_entity_uid: str | None = None,
    policy: PlannerPolicyV1 = PLANNER_POLICY_V1,
) -> TransitionPlan:
    outgoing_uid = _track_uid(outgoing, outgoing_track_entity_uid, "outgoing")
    incoming_uid = _track_uid(incoming, incoming_track_entity_uid, "incoming")

    if context.source == "album" and context.automatic:
        return _base_plan(
            outgoing_uid,
            incoming_uid,
            mode=TransitionMode.GAPLESS,
            duration_ms=0,
            outgoing_cue_ms=outgoing.duration_ms if outgoing else 0,
            incoming_cue_ms=0,
            confidence=1.0,
            policy=policy,
        )

    if context.source == "manual" or not context.automatic:
        return _base_plan(
            outgoing_uid,
            incoming_uid,
            mode=TransitionMode.ADAPTIVE,
            duration_ms=policy.manual_ramp_ms,
            outgoing_cue_ms=_outgoing_cue(outgoing, policy.manual_ramp_ms),
            incoming_cue_ms=_incoming_cue(incoming),
            confidence=0.5,
            policy=policy,
        )

    if outgoing is None or incoming is None:
        return _fallback_plan(
            outgoing_uid,
            incoming_uid,
            outgoing,
            incoming,
            TransitionFallbackReason.MISSING_PROFILE,
            policy,
        )

    fallback_reason = _beatmatch_fallback_reason(outgoing, incoming, context, policy)
    compatibility = score_compatibility(outgoing, incoming, policy=policy)
    duration_ms = _transition_duration(context.preferred_duration_ms, policy)
    if fallback_reason is not None:
        return _base_plan(
            outgoing_uid,
            incoming_uid,
            mode=TransitionMode.ADAPTIVE,
            duration_ms=duration_ms,
            outgoing_cue_ms=_outgoing_cue(outgoing, duration_ms),
            incoming_cue_ms=_incoming_cue(incoming),
            confidence=compatibility.signal_confidence,
            fallback_reason=fallback_reason,
            outgoing_gain_db=_safe_deck_gain(outgoing.true_peak_dbfs, 0.0, policy),
            incoming_gain_db=_safe_deck_gain(
                incoming.true_peak_dbfs,
                _loudness_delta(outgoing, incoming, policy),
                policy,
            ),
            policy=policy,
        )

    tempo_ratio = _tempo_ratio(outgoing.bpm, incoming.bpm)
    outgoing_cue_ms = _outgoing_cue(outgoing, duration_ms)
    incoming_cue_ms = _incoming_cue(incoming)
    return _base_plan(
        outgoing_uid,
        incoming_uid,
        mode=TransitionMode.BEATMATCH,
        duration_ms=duration_ms,
        outgoing_cue_ms=outgoing_cue_ms,
        incoming_cue_ms=incoming_cue_ms,
        incoming_tempo_ratio=tempo_ratio,
        beat_phase_offset_ms=_beat_phase_offset(incoming, incoming_cue_ms),
        confidence=min(compatibility.overall, compatibility.signal_confidence),
        outgoing_gain_db=_safe_deck_gain(outgoing.true_peak_dbfs, 0.0, policy),
        incoming_gain_db=_safe_deck_gain(
            incoming.true_peak_dbfs,
            _loudness_delta(outgoing, incoming, policy),
            policy,
        ),
        bass_handoff="balanced",
        policy=policy,
    )


def _beatmatch_fallback_reason(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    context: TransitionContext,
    policy: PlannerPolicyV1,
) -> TransitionFallbackReason | None:
    if not context.allow_beatmatch:
        return TransitionFallbackReason.LOW_CONFIDENCE
    if (
        outgoing.quality is not MixProfileQuality.FULL
        or incoming.quality is not MixProfileQuality.FULL
    ):
        return TransitionFallbackReason.LOW_CONFIDENCE
    if (
        outgoing.bpm is None
        or incoming.bpm is None
        or outgoing.bpm_confidence is None
        or incoming.bpm_confidence is None
        or min(outgoing.bpm_confidence, incoming.bpm_confidence)
        < policy.minimum_bpm_confidence
        or outgoing.downbeat_anchor_ms is None
        or incoming.downbeat_anchor_ms is None
    ):
        return TransitionFallbackReason.LOW_CONFIDENCE
    if (
        outgoing.tempo_stability is None
        or incoming.tempo_stability is None
        or min(outgoing.tempo_stability, incoming.tempo_stability)
        < policy.minimum_tempo_stability
    ):
        return TransitionFallbackReason.UNSTABLE_TEMPO
    if (
        outgoing.time_signature is None
        or incoming.time_signature is None
        or outgoing.time_signature != incoming.time_signature
    ):
        return TransitionFallbackReason.INCOMPATIBLE_METER
    adjustment = abs(_tempo_ratio(outgoing.bpm, incoming.bpm) - 1.0)
    maximum_adjustment = min(
        policy.maximum_tempo_adjustment,
        policy.hard_maximum_tempo_adjustment,
    )
    if adjustment > maximum_adjustment:
        return TransitionFallbackReason.INCOMPATIBLE_TEMPO
    if not context.allow_tempo_adjustment and adjustment > 0.001:
        return TransitionFallbackReason.INCOMPATIBLE_TEMPO
    return None


def _base_plan(
    outgoing_uid: str,
    incoming_uid: str,
    *,
    mode: TransitionMode,
    duration_ms: int,
    outgoing_cue_ms: int,
    incoming_cue_ms: int,
    confidence: float,
    policy: PlannerPolicyV1,
    incoming_tempo_ratio: float = 1.0,
    beat_phase_offset_ms: int = 0,
    outgoing_gain_db: float = 0.0,
    incoming_gain_db: float = 0.0,
    bass_handoff: str = "none",
    fallback_reason: TransitionFallbackReason | None = None,
) -> TransitionPlan:
    return TransitionPlan(
        planner_version=policy.version,
        outgoing_track_entity_uid=outgoing_uid,
        incoming_track_entity_uid=incoming_uid,
        mode=mode,
        duration_ms=duration_ms,
        outgoing_cue_ms=outgoing_cue_ms,
        incoming_cue_ms=incoming_cue_ms,
        incoming_tempo_ratio=round(incoming_tempo_ratio, 6),
        beat_phase_offset_ms=beat_phase_offset_ms,
        handoff_progress=0.5,
        outgoing_gain_db=round(outgoing_gain_db, 4),
        incoming_gain_db=round(incoming_gain_db, 4),
        curve="equal-power",
        bass_handoff=bass_handoff,
        confidence=_round_score(confidence),
        fallback_reason=fallback_reason,
    )


def _fallback_plan(
    outgoing_uid: str,
    incoming_uid: str,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    reason: TransitionFallbackReason,
    policy: PlannerPolicyV1,
) -> TransitionPlan:
    return _base_plan(
        outgoing_uid,
        incoming_uid,
        mode=TransitionMode.ADAPTIVE,
        duration_ms=policy.fallback_duration_ms,
        outgoing_cue_ms=_outgoing_cue(outgoing, policy.fallback_duration_ms),
        incoming_cue_ms=_incoming_cue(incoming),
        confidence=0.0,
        fallback_reason=reason,
        policy=policy,
    )


def _track_uid(
    profile: TrackMixProfile | None,
    explicit_uid: str | None,
    side: str,
) -> str:
    value = profile.track_entity_uid if profile else explicit_uid
    if not value:
        raise ValueError(f"{side}_track_entity_uid is required")
    return str(value)


def _transition_duration(preferred_ms: int, policy: PlannerPolicyV1) -> int:
    if preferred_ms <= 0:
        return policy.fallback_duration_ms
    return min(
        policy.maximum_transition_ms,
        max(policy.minimum_transition_ms, preferred_ms),
    )


def _outgoing_cue(profile: TrackMixProfile | None, duration_ms: int) -> int:
    if profile is None:
        return 0
    if profile.outro_cue_ms is not None:
        return profile.outro_cue_ms
    return max(0, profile.duration_ms - duration_ms)


def _incoming_cue(profile: TrackMixProfile | None) -> int:
    if profile is None:
        return 0
    return profile.intro_cue_ms or 0


def _tempo_ratio(outgoing_bpm: float | None, incoming_bpm: float | None) -> float:
    if not outgoing_bpm or not incoming_bpm:
        return 1.0
    normalized_incoming = _normalized_tempo(float(outgoing_bpm), float(incoming_bpm))
    return float(outgoing_bpm) / normalized_incoming


def _normalized_tempo(reference_bpm: float, candidate_bpm: float) -> float:
    options = (candidate_bpm * 0.5, candidate_bpm, candidate_bpm * 2.0)
    return min(options, key=lambda value: abs(value - reference_bpm))


def _tempo_score(outgoing_bpm: float | None, incoming_bpm: float | None) -> float:
    if not outgoing_bpm or not incoming_bpm:
        return 0.5
    difference = abs(_tempo_ratio(outgoing_bpm, incoming_bpm) - 1.0)
    return max(0.0, 1.0 - difference / 0.12)


def _harmonic_score(
    relationship: CamelotRelationship,
    policy: PlannerPolicyV1,
) -> float:
    return {
        CamelotRelationship.SAME: policy.harmonic_same_score,
        CamelotRelationship.RELATIVE: policy.harmonic_relative_score,
        CamelotRelationship.ADJACENT: policy.harmonic_adjacent_score,
        CamelotRelationship.INCOMPATIBLE: policy.harmonic_incompatible_score,
        CamelotRelationship.UNKNOWN: policy.harmonic_unknown_score,
    }[relationship]


def _continuity_score(
    outgoing: float | None,
    incoming: float | None,
    policy: PlannerPolicyV1,
) -> float:
    if outgoing is None or incoming is None:
        return policy.neutral_dimension_score
    return max(0.0, 1.0 - abs(float(outgoing) - float(incoming)))


def _optional_score(
    value: float | None,
    policy: PlannerPolicyV1,
) -> float:
    if value is None:
        return policy.neutral_dimension_score
    return max(0.0, min(1.0, float(value)))


def _signal_confidence(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
) -> float:
    values = [
        outgoing.bpm_confidence,
        incoming.bpm_confidence,
        outgoing.tempo_stability,
        incoming.tempo_stability,
        outgoing.key_confidence,
        incoming.key_confidence,
    ]
    available = [float(value) for value in values if value is not None]
    if not available:
        return 0.0
    return _round_score(sum(available) / len(values))


def _loudness_delta(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    policy: PlannerPolicyV1,
) -> float:
    if outgoing.outro_lufs is None or incoming.intro_lufs is None:
        return 0.0
    desired = float(outgoing.outro_lufs) - float(incoming.intro_lufs)
    return max(
        -policy.max_loudness_adjustment_db,
        min(policy.max_loudness_adjustment_db, desired),
    )


def _safe_deck_gain(
    true_peak_dbfs: float | None,
    desired_gain_db: float,
    policy: PlannerPolicyV1,
) -> float:
    peak = float(true_peak_dbfs) if true_peak_dbfs is not None else 0.0
    safe_gain = (
        policy.combined_true_peak_ceiling_dbfs
        - policy.equal_power_midpoint_headroom_db
        - peak
    )
    return min(desired_gain_db, safe_gain)


def _beat_phase_offset(profile: TrackMixProfile, cue_ms: int) -> int:
    if not profile.bpm or profile.downbeat_anchor_ms is None:
        return 0
    beat_period_ms = max(1, round(60_000.0 / profile.bpm))
    return int((profile.downbeat_anchor_ms - cue_ms) % beat_period_ms)


def _round_score(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return round(max(0.0, min(1.0, value)), 6)


__all__ = [
    "CompatibilityScore",
    "plan_transition",
    "score_compatibility",
]
