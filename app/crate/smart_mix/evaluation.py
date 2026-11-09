"""Objective metrics for Smart Mix transition plans (Smart Mix 3, SM0).

Every function here is pure: it reads a ``TransitionPlan`` and the two
``TrackMixProfile`` values it was planned from, and never touches audio, the
database, caches or the network. ``tools/smart-mix-eval/run_eval.py`` uses them
to compare planners on the same set of edges.

The deck envelopes mirror the Android engine (``NativeMixAudioProcessor`` and
``BassHandoffFilter``), which is the reference implementation of a plan: the
DJ blend curve and the bass handoff only apply to beatmatch plans, and the
incoming deck only runs at ``incoming_tempo_ratio`` in beatmatch.

Profiles written before schema 2 have no phrases, energy curve or vocal
presence. Phrase metrics then fall back to an 8-bar grid counted from the
downbeat anchor (the heuristic v2 itself uses) and say so in ``basis``; the
vocal metric returns ``None``.
"""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from crate.smart_mix.camelot import CamelotRelationship, camelot_relationship
from crate.smart_mix.models import (
    VOCAL_THRESHOLD,
    TrackMixProfile,
    TransitionContext,
    TransitionFallbackReason,
    TransitionMode,
    TransitionPlan,
)
from crate.smart_mix.policy import PLANNER_POLICY, PlannerPolicy
from crate.smart_mix.transition_fit import tempo_ratio
from crate.smart_mix.versions import MEASUREMENT_VERSION


# A deck counts as "at full level" for overlap metrics while its gain is at
# least half its normal amplitude (-6.02 dB). Equal power keeps both decks
# there for exactly the middle third of a mix.
OVERLAP_FLOOR_GAIN = 0.5
OVERLAP_FLOOR_DB = 20.0 * math.log10(OVERLAP_FLOOR_GAIN)
# BassHandoffFilter: 150 Hz low shelf, -24 dB, swapped with a raised cosine
# over 12.5 % of the mix centred on handoff_progress.
BASS_SHELF_HZ = 150.0
BASS_CUT_DB = -24.0
BASS_SWAP_FRACTION = 0.125
# NativeMixAudioProcessor.djBlendProgress.
DJ_BLEND_ENTRY = 0.3
DJ_BLEND_EXIT = 0.7
# Grid fallback for profiles without phrases: 8 bars from the downbeat.
GRID_PHRASE_BARS = 8
PHRASE_TOLERANCE_BEATS = 0.125
DEFAULT_PHRASE_TOLERANCE_MS = 60
# A phrase has voice from the cut gate SG1b calibrated on the stored byte
# (``VOCAL_THRESHOLD``, 90 of 255), the one the server applies.
VOCAL_PRESENCE_THRESHOLD = VOCAL_THRESHOLD / 255.0
TIMELINE_STEP_MS = 10

PhraseBasis = Literal["phrases", "grid", "mixed"]
EnergyBasis = Literal["phrases", "intro_outro"]

POLICY_VIOLATION_CODES = (
    "track_mismatch",
    "duration_out_of_range",
    "long_beatmatch_ineligible",
    "tempo_out_of_range",
    "gain_out_of_range",
    "true_peak_exceeded",
    "outgoing_window_out_of_range",
    "outgoing_body_too_short",
    "incoming_body_too_short",
    "beatmatch_not_allowed",
    "tempo_adjustment_not_allowed",
    "bass_handoff_not_allowed",
    "long_beatmatch_not_allowed",
)

_EPSILON = 1e-6
_TRUE_PEAK_TOLERANCE_DB = 1e-3
_TEMPO_ADJUSTMENT_FLOOR = 0.001


@dataclass(frozen=True, slots=True)
class PhraseAlignment:
    aligned: int
    checked: int
    basis: PhraseBasis
    start_aligned: bool
    end_aligned: bool

    @property
    def fully_aligned(self) -> bool:
        return self.aligned == self.checked

    def to_dict(self) -> dict[str, Any]:
        return {
            "aligned": self.aligned,
            "checked": self.checked,
            "basis": self.basis,
            "startAligned": self.start_aligned,
            "endAligned": self.end_aligned,
        }


@dataclass(frozen=True, slots=True)
class EnergyStep:
    value: float
    signed: float
    basis: EnergyBasis

    def to_dict(self) -> dict[str, Any]:
        return {"value": self.value, "signed": self.signed, "basis": self.basis}


@dataclass(frozen=True, slots=True)
class MusicLeftOut:
    """Music a plan does not play: after the mix on the outgoing track, before the
    mix on the incoming one. Informative: cutting an outro or an intro is mixing."""

    outgoing_unplayed_ms: int
    incoming_skipped_ms: int

    def to_dict(self) -> dict[str, int]:
        return {
            "outgoingUnplayedMs": self.outgoing_unplayed_ms,
            "incomingSkippedMs": self.incoming_skipped_ms,
        }


@dataclass(frozen=True, slots=True)
class TransitionEvaluation:
    mode: str
    duration_ms: int
    fallback_reason: str | None
    curve: str
    bass_handoff: bool
    policy_violations: tuple[str, ...]
    phrase_alignment: PhraseAlignment | None
    bass_overlap_ms: int
    harmonic_relationship: str
    harmonic_clash_ms: int | None
    energy_step: EnergyStep | None
    vocal_clash_ms: int | None
    music_left_out: MusicLeftOut | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "durationMs": self.duration_ms,
            "fallbackReason": self.fallback_reason,
            "curve": self.curve,
            "bassHandoff": self.bass_handoff,
            "policyViolations": list(self.policy_violations),
            "phraseAlignment": (
                self.phrase_alignment.to_dict() if self.phrase_alignment else None
            ),
            "bassOverlapMs": self.bass_overlap_ms,
            "harmonicRelationship": self.harmonic_relationship,
            "harmonicClashMs": self.harmonic_clash_ms,
            "energyStep": self.energy_step.to_dict() if self.energy_step else None,
            "vocalClashMs": self.vocal_clash_ms,
            "musicLeftOut": (
                self.music_left_out.to_dict() if self.music_left_out else None
            ),
        }


def evaluate_transition(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    *,
    context: TransitionContext | None = None,
    policy: PlannerPolicy = PLANNER_POLICY,
) -> TransitionEvaluation:
    """Compute every SM0 metric for one planned edge."""
    return TransitionEvaluation(
        mode=TransitionMode(plan.mode).value,
        duration_ms=plan.duration_ms,
        fallback_reason=(
            TransitionFallbackReason(plan.fallback_reason).value
            if plan.fallback_reason is not None
            else None
        ),
        curve=effective_curve(plan),
        bass_handoff=bass_handoff_engaged(plan),
        policy_violations=policy_violations(
            plan, outgoing, incoming, context=context, policy=policy
        ),
        phrase_alignment=phrase_alignment(plan, outgoing, incoming),
        bass_overlap_ms=bass_overlap_ms(plan, outgoing, incoming),
        harmonic_relationship=_harmonic_relationship(outgoing, incoming).value,
        harmonic_clash_ms=harmonic_clash_ms(plan, outgoing, incoming),
        energy_step=energy_step(plan, outgoing, incoming),
        vocal_clash_ms=vocal_clash_ms(plan, outgoing, incoming),
        music_left_out=music_left_out(plan, outgoing, incoming),
    )


def phrase_alignment(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    *,
    tolerance_beats: float = PHRASE_TOLERANCE_BEATS,
) -> PhraseAlignment | None:
    """Count how many of the four transition boundaries land on a phrase boundary.

    The boundaries are where the mix starts and ends on each track: the
    outgoing cue and cue + duration, and the incoming start (with the beat
    phase offset in beatmatch) and start + duration at the incoming tempo.
    Each is aligned when it lies within ``tolerance_beats`` of a boundary of
    that track's stored phrases, or of the 8-bar grid when the profile has no
    phrases. ``None`` when either track has neither.
    """
    if outgoing is None or incoming is None:
        return None
    outgoing_phrases = _phrase_boundaries(outgoing)
    incoming_phrases = _phrase_boundaries(incoming)
    if outgoing_phrases is None or incoming_phrases is None:
        return None
    outgoing_tolerance = _phrase_tolerance_ms(outgoing, tolerance_beats)
    incoming_tolerance = _phrase_tolerance_ms(incoming, tolerance_beats)
    incoming_start = incoming_start_ms(plan)
    incoming_end = incoming_start + plan.duration_ms * incoming_tempo(plan)
    flags = (
        outgoing_phrases.is_boundary(plan.outgoing_cue_ms, outgoing_tolerance),
        incoming_phrases.is_boundary(incoming_start, incoming_tolerance),
        outgoing_phrases.is_boundary(
            plan.outgoing_cue_ms + plan.duration_ms, outgoing_tolerance
        ),
        incoming_phrases.is_boundary(incoming_end, incoming_tolerance),
    )
    basis: PhraseBasis = (
        outgoing_phrases.basis
        if outgoing_phrases.basis == incoming_phrases.basis
        else "mixed"
    )
    return PhraseAlignment(
        aligned=sum(flags),
        checked=len(flags),
        basis=basis,
        start_aligned=flags[0] and flags[1],
        end_aligned=flags[2] and flags[3],
    )


def bass_overlap_ms(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None = None,
    incoming: TrackMixProfile | None = None,
) -> int:
    """Milliseconds with both decks' bass at full level.

    A deck's bass level is its crossfade gain plus the bass handoff shelf cut
    (beatmatch with ``bass_handoff="balanced"`` only); full level means at or
    above ``OVERLAP_FLOOR_DB``. Loudness staging gains are level matching and
    do not count. Time where a track is outside its active range (silence)
    does not count either.
    """
    return _overlap_ms(plan, outgoing, incoming, _both_basses_check(plan))


def _both_basses_check(plan: TransitionPlan) -> Callable[[float, float, float], bool]:
    handoff = bass_handoff_engaged(plan)

    def both_basses(progress: float, outgoing_db: float, incoming_db: float) -> bool:
        outgoing_cut, incoming_cut = (
            bass_cut_db(progress, plan.handoff_progress) if handoff else (0.0, 0.0)
        )
        return (
            outgoing_db + outgoing_cut >= OVERLAP_FLOOR_DB
            and incoming_db + incoming_cut >= OVERLAP_FLOOR_DB
        )

    return both_basses


def harmonic_clash_ms(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> int | None:
    """Milliseconds of full-level overlap between keys Camelot calls incompatible.

    Same, relative and adjacent keys give 0. ``None`` when either key is
    unknown. Tempo changes keep the key (time stretch, as the engines do).
    """
    relationship = _harmonic_relationship(outgoing, incoming)
    if relationship is CamelotRelationship.UNKNOWN:
        return None
    if relationship is not CamelotRelationship.INCOMPATIBLE:
        return 0
    return _overlap_ms(plan, outgoing, incoming, _both_full_level)


def energy_step(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> EnergyStep | None:
    """Energy change between the outgoing and incoming phrase at the handoff.

    With phrases on both profiles it compares the energy of the phrase each
    track is playing at ``handoff_progress``. Without them it compares the
    outgoing outro energy with the incoming intro energy. ``value`` is the
    absolute step on the profiles' 0-1 energy scale, ``signed`` is incoming
    minus outgoing. ``None`` when an energy is missing.
    """
    if outgoing is None or incoming is None:
        return None
    outgoing_phrases = _stored_phrases(outgoing)
    incoming_phrases = _stored_phrases(incoming)
    if outgoing_phrases is not None and incoming_phrases is not None:
        handoff_ms = plan.handoff_progress * plan.duration_ms
        outgoing_energy = outgoing_phrases.energy_at(plan.outgoing_cue_ms + handoff_ms)
        incoming_energy = incoming_phrases.energy_at(
            incoming_start_ms(plan) + handoff_ms * incoming_tempo(plan)
        )
        if outgoing_energy is not None and incoming_energy is not None:
            return _energy_step(outgoing_energy, incoming_energy, "phrases")
    if outgoing.outro_energy is None or incoming.intro_energy is None:
        return None
    return _energy_step(outgoing.outro_energy, incoming.intro_energy, "intro_outro")


def vocal_clash_ms(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> int | None:
    """Milliseconds of full-level overlap with vocals on both decks.

    Needs phrases and per-phrase vocal presence (schema 2 with the optional
    detector) on both profiles; ``None`` otherwise. A phrase has vocals when
    its presence byte is at least ``VOCAL_THRESHOLD`` (SG1b), which is
    ``VOCAL_PRESENCE_THRESHOLD`` on the 0-1 scale.
    """
    if outgoing is None or incoming is None:
        return None
    outgoing_phrases = _stored_phrases(outgoing)
    incoming_phrases = _stored_phrases(incoming)
    outgoing_vocals = _vocal_presence(outgoing)
    incoming_vocals = _vocal_presence(incoming)
    if (
        outgoing_phrases is None
        or incoming_phrases is None
        or outgoing_vocals is None
        or incoming_vocals is None
    ):
        return None
    ratio = incoming_tempo(plan)
    incoming_start = incoming_start_ms(plan)

    def both_vocals(position_ms: float) -> bool:
        return _has_vocals(
            outgoing_phrases, outgoing_vocals, plan.outgoing_cue_ms + position_ms
        ) and _has_vocals(
            incoming_phrases, incoming_vocals, incoming_start + position_ms * ratio
        )

    return _overlap_ms(
        plan,
        outgoing,
        incoming,
        _both_full_level,
        position_filter=both_vocals,
    )


def stem_vocal_clash_ms(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> int | None:
    """Milliseconds of full-level overlap with stem vocals on both decks.

    ``vocal_clash_ms`` on the vocal presence of the profiles' stems layers
    (Smart Mix Stems, STEM-D4) instead of YAMNet's voice. ``None`` unless both
    profiles carry phrases and a stems layer.
    """
    both = _both_stems_present(plan, outgoing, incoming, "vocal_present")
    if both is None:
        return None
    return _overlap_ms(plan, outgoing, incoming, _both_full_level, position_filter=both)


def stem_bass_clash_ms(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> int | None:
    """Milliseconds with both basses at full level while both play a bassline.

    ``bass_overlap_ms`` (crossfade gain plus the bass handoff shelf) on the time
    where the stems layers of both profiles have bass. ``None`` unless both
    profiles carry phrases and a stems layer.
    """
    both = _both_stems_present(plan, outgoing, incoming, "bass_present")
    if both is None:
        return None
    return _overlap_ms(
        plan, outgoing, incoming, _both_basses_check(plan), position_filter=both
    )


def _both_stems_present(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    attribute: str,
) -> Callable[[float], bool] | None:
    """A mix-time filter: both decks on a phrase whose stems entry has the stem."""
    if outgoing is None or incoming is None:
        return None
    outgoing_phrases = _stored_phrases(outgoing)
    incoming_phrases = _stored_phrases(incoming)
    outgoing_flags = _stem_presence(outgoing, attribute)
    incoming_flags = _stem_presence(incoming, attribute)
    if (
        outgoing_phrases is None
        or incoming_phrases is None
        or outgoing_flags is None
        or incoming_flags is None
    ):
        return None
    ratio = incoming_tempo(plan)
    incoming_start = incoming_start_ms(plan)

    def both(position_ms: float) -> bool:
        return _flag_at(
            outgoing_phrases, outgoing_flags, plan.outgoing_cue_ms + position_ms
        ) and _flag_at(
            incoming_phrases, incoming_flags, incoming_start + position_ms * ratio
        )

    return both


def music_left_out(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> MusicLeftOut | None:
    """Milliseconds of music the plan leaves out on each track.

    Outgoing: from the end of the mix to the end of the music (``activeEndMs``).
    Incoming: from the start of the music (``activeStartMs``) to where the deck
    starts (``incoming_start_ms``). ``None`` without both profiles.
    """
    if outgoing is None or incoming is None:
        return None
    unplayed = _playable_end_ms(outgoing) - (plan.outgoing_cue_ms + plan.duration_ms)
    skipped = incoming_start_ms(plan) - (incoming.active_start_ms or 0)
    return MusicLeftOut(
        outgoing_unplayed_ms=max(0, unplayed), incoming_skipped_ms=max(0, skipped)
    )


def policy_violations(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    *,
    context: TransitionContext | None = None,
    policy: PlannerPolicy = PLANNER_POLICY,
) -> tuple[str, ...]:
    """Closed codes for every planner rule the plan breaks (``()`` when valid).

    ``TransitionPlan`` already validates its own fields (tempo range 0.94-1.06,
    curve, bass handoff). This checks the planner policy on top: duration,
    long beatmatch eligibility, tempo adjustment, gain range (loudness
    matching within +-6 dB; peak safety may attenuate further, as v2 does for
    hot masters), combined true peak, playable windows and minimum bodies,
    plus what the context allows.
    The planner's short cut (adaptive, ``insufficient_window``, at most the
    manual ramp) is exempt from the duration, peak and body rules, because it
    is the planner's answer when no window fits.
    """
    codes: list[str] = []
    beatmatch = plan.mode == TransitionMode.BEATMATCH
    gapless = plan.mode == TransitionMode.GAPLESS
    short_cut = _is_short_cut(plan, policy)
    ratio = plan.incoming_tempo_ratio
    if (
        outgoing is not None
        and outgoing.track_entity_uid != plan.outgoing_track_entity_uid
    ) or (
        incoming is not None
        and incoming.track_entity_uid != plan.incoming_track_entity_uid
    ):
        codes.append("track_mismatch")
    if not gapless and not short_cut:
        if (
            plan.duration_ms < policy.minimum_transition_ms
            or plan.duration_ms > policy.maximum_long_beatmatch_ms
        ):
            codes.append("duration_out_of_range")
        elif plan.duration_ms > policy.maximum_transition_ms and not (
            beatmatch
            and plan.curve == "dj-blend"
            and _long_beatmatch_stable(outgoing, incoming, policy)
        ):
            codes.append("long_beatmatch_ineligible")
    maximum_adjustment = (
        min(policy.maximum_tempo_adjustment, policy.hard_maximum_tempo_adjustment)
        if beatmatch
        else 0.0
    )
    if abs(ratio - 1.0) > maximum_adjustment + _EPSILON:
        codes.append("tempo_out_of_range")
    if not _gains_in_range(plan, outgoing, incoming, policy):
        codes.append("gain_out_of_range")
    if outgoing is not None and incoming is not None and not short_cut:
        if any(
            _deck_peak_dbfs(profile) + gain + policy.equal_power_midpoint_headroom_db
            > policy.combined_true_peak_ceiling_dbfs + _TRUE_PEAK_TOLERANCE_DB
            for profile, gain in (
                (outgoing, plan.outgoing_gain_db),
                (incoming, plan.incoming_gain_db),
            )
        ):
            codes.append("true_peak_exceeded")
    if outgoing is not None and not gapless:
        playable_end = _playable_end_ms(outgoing)
        window_end = outgoing.duration_ms if short_cut else playable_end
        if plan.outgoing_cue_ms + plan.duration_ms > window_end + 1:
            codes.append("outgoing_window_out_of_range")
        earliest_cue = min(
            int(playable_end * policy.minimum_outgoing_body_ratio),
            policy.minimum_outgoing_body_ms,
        )
        if not short_cut and plan.outgoing_cue_ms < earliest_cue:
            codes.append("outgoing_body_too_short")
    if incoming is not None and not gapless and not short_cut:
        available_end = _playable_end_ms(incoming) - policy.minimum_incoming_body_ms
        if plan.incoming_cue_ms + plan.duration_ms * incoming_tempo(plan) > (
            available_end + 1
        ):
            codes.append("incoming_body_too_short")
    if context is not None:
        if beatmatch and not context.allow_beatmatch:
            codes.append("beatmatch_not_allowed")
        if (
            abs(ratio - 1.0) > _TEMPO_ADJUSTMENT_FLOOR
            and not context.allow_tempo_adjustment
        ):
            codes.append("tempo_adjustment_not_allowed")
        if plan.bass_handoff == "balanced" and not context.allow_bass_handoff:
            codes.append("bass_handoff_not_allowed")
        if (
            plan.duration_ms > policy.maximum_transition_ms
            and not context.allow_long_beatmatch
        ):
            codes.append("long_beatmatch_not_allowed")
    return tuple(codes)


@dataclass(frozen=True, slots=True)
class PolicyLimits:
    """The planner policy resolved for one edge (Smart Mix Stems, STEM-D10).

    Crate Decks may change a server plan locally (another candidate, a shifted
    phrase, another length or bass handoff) and must check the result against these
    before it plays it. ``limit_violations`` is the reference check: for a plan that
    mixes (neither gapless nor the planner's short cut) it gives exactly the codes of
    ``policy_violations`` but ``track_mismatch``.

    Bounds are inclusive. A deck's gain is valid from ``-maximum_cut_db`` to the
    lower of ``maximum_boost_db`` and its peak-limited gain, or exactly at its
    peak-limited gain (``ceiling - headroom - true peak``: what a hot master needs).
    Windows are in each track's own time: the outgoing mix runs from its cue
    (``outgoing_earliest_cue_ms`` at the earliest) to cue + duration (at most
    ``outgoing_latest_end_ms``); the incoming cue plus the duration at the incoming
    tempo ends by ``incoming_latest_end_ms``.
    """

    rules_revision: int
    beatmatch_allowed: bool
    tempo_adjustment_allowed: bool
    bass_handoff_allowed: bool
    long_beatmatch_allowed: bool
    long_beatmatch_eligible: bool
    maximum_tempo_adjustment: float
    minimum_transition_ms: int
    maximum_transition_ms: int
    maximum_long_beatmatch_ms: int
    maximum_boost_db: float
    maximum_cut_db: float
    outgoing_peak_limited_gain_db: float
    incoming_peak_limited_gain_db: float
    outgoing_earliest_cue_ms: int
    outgoing_latest_end_ms: int
    incoming_latest_end_ms: int
    phrase_lengths: tuple[int, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "rulesRevision": self.rules_revision,
            "beatmatchAllowed": self.beatmatch_allowed,
            "tempoAdjustmentAllowed": self.tempo_adjustment_allowed,
            "bassHandoffAllowed": self.bass_handoff_allowed,
            "longBeatmatchAllowed": self.long_beatmatch_allowed,
            "longBeatmatchEligible": self.long_beatmatch_eligible,
            "maximumTempoAdjustment": self.maximum_tempo_adjustment,
            "minimumTransitionMs": self.minimum_transition_ms,
            "maximumTransitionMs": self.maximum_transition_ms,
            "maximumLongBeatmatchMs": self.maximum_long_beatmatch_ms,
            "maximumBoostDb": self.maximum_boost_db,
            "maximumCutDb": self.maximum_cut_db,
            "outgoingPeakLimitedGainDb": self.outgoing_peak_limited_gain_db,
            "incomingPeakLimitedGainDb": self.incoming_peak_limited_gain_db,
            "outgoingEarliestCueMs": self.outgoing_earliest_cue_ms,
            "outgoingLatestEndMs": self.outgoing_latest_end_ms,
            "incomingLatestEndMs": self.incoming_latest_end_ms,
            "phraseLengths": list(self.phrase_lengths),
        }


def policy_limits(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    context: TransitionContext,
    policy: PlannerPolicy = PLANNER_POLICY,
) -> PolicyLimits:
    """``policy_violations``' rules for the plans of one edge, as bounds."""
    accredited = _has_accredited_measurement(outgoing) and _has_accredited_measurement(
        incoming
    )
    outgoing_end = _playable_end_ms(outgoing)
    return PolicyLimits(
        rules_revision=policy.rules_revision,
        beatmatch_allowed=context.allow_beatmatch,
        tempo_adjustment_allowed=context.allow_tempo_adjustment,
        bass_handoff_allowed=context.allow_bass_handoff,
        long_beatmatch_allowed=context.allow_long_beatmatch,
        long_beatmatch_eligible=_long_beatmatch_stable(outgoing, incoming, policy),
        maximum_tempo_adjustment=min(
            policy.maximum_tempo_adjustment, policy.hard_maximum_tempo_adjustment
        ),
        minimum_transition_ms=policy.minimum_transition_ms,
        maximum_transition_ms=policy.maximum_transition_ms,
        maximum_long_beatmatch_ms=policy.maximum_long_beatmatch_ms,
        maximum_boost_db=max(
            0.0,
            policy.max_loudness_adjustment_db
            if accredited
            else policy.maximum_unaccredited_gain_db,
        ),
        maximum_cut_db=policy.max_loudness_adjustment_db,
        outgoing_peak_limited_gain_db=_peak_limited_gain_db(outgoing, policy),
        incoming_peak_limited_gain_db=_peak_limited_gain_db(incoming, policy),
        outgoing_earliest_cue_ms=min(
            int(outgoing_end * policy.minimum_outgoing_body_ratio),
            policy.minimum_outgoing_body_ms,
        ),
        outgoing_latest_end_ms=outgoing_end + 1,
        incoming_latest_end_ms=(
            _playable_end_ms(incoming) - policy.minimum_incoming_body_ms + 1
        ),
        phrase_lengths=tuple(policy.phrase_lengths),
    )


def limit_violations(plan: TransitionPlan, limits: PolicyLimits) -> tuple[str, ...]:
    """The codes ``policy_violations`` gives a mixing plan, from ``limits`` alone."""
    codes: list[str] = []
    beatmatch = plan.mode == TransitionMode.BEATMATCH
    ratio = plan.incoming_tempo_ratio
    duration = plan.duration_ms
    long_blend = duration > limits.maximum_transition_ms
    if (
        duration < limits.minimum_transition_ms
        or duration > limits.maximum_long_beatmatch_ms
    ):
        codes.append("duration_out_of_range")
    elif long_blend and not (
        beatmatch and plan.curve == "dj-blend" and limits.long_beatmatch_eligible
    ):
        codes.append("long_beatmatch_ineligible")
    maximum_adjustment = limits.maximum_tempo_adjustment if beatmatch else 0.0
    if abs(ratio - 1.0) > maximum_adjustment + _EPSILON:
        codes.append("tempo_out_of_range")
    gains = (
        (plan.outgoing_gain_db, limits.outgoing_peak_limited_gain_db),
        (plan.incoming_gain_db, limits.incoming_peak_limited_gain_db),
    )
    if not all(
        gain <= limits.maximum_boost_db + _EPSILON
        and (
            gain >= -limits.maximum_cut_db - _EPSILON
            or abs(gain - peak_limited) <= _TRUE_PEAK_TOLERANCE_DB
        )
        for gain, peak_limited in gains
    ):
        codes.append("gain_out_of_range")
    if any(
        gain > peak_limited + _TRUE_PEAK_TOLERANCE_DB for gain, peak_limited in gains
    ):
        codes.append("true_peak_exceeded")
    if plan.outgoing_cue_ms + duration > limits.outgoing_latest_end_ms:
        codes.append("outgoing_window_out_of_range")
    if plan.outgoing_cue_ms < limits.outgoing_earliest_cue_ms:
        codes.append("outgoing_body_too_short")
    if (
        plan.incoming_cue_ms + duration * incoming_tempo(plan)
        > limits.incoming_latest_end_ms
    ):
        codes.append("incoming_body_too_short")
    if beatmatch and not limits.beatmatch_allowed:
        codes.append("beatmatch_not_allowed")
    if (
        abs(ratio - 1.0) > _TEMPO_ADJUSTMENT_FLOOR
        and not limits.tempo_adjustment_allowed
    ):
        codes.append("tempo_adjustment_not_allowed")
    if plan.bass_handoff == "balanced" and not limits.bass_handoff_allowed:
        codes.append("bass_handoff_not_allowed")
    if long_blend and not limits.long_beatmatch_allowed:
        codes.append("long_beatmatch_not_allowed")
    return tuple(codes)


def _peak_limited_gain_db(profile: TrackMixProfile, policy: PlannerPolicy) -> float:
    return round(
        policy.combined_true_peak_ceiling_dbfs
        - policy.equal_power_midpoint_headroom_db
        - _deck_peak_dbfs(profile),
        6,
    )


def crossfade_gains(progress: float, curve: str) -> tuple[float, float]:
    """Linear (outgoing, incoming) crossfade gains at a mix progress in [0, 1]."""
    if curve == "dj-blend":
        crossfade = _dj_blend_progress(progress)
    elif curve == "equal-power":
        crossfade = _clamp_unit(progress)
    else:
        raise ValueError(f"Unsupported transition curve: {curve!r}")
    outgoing = 0.0 if crossfade >= 1.0 else math.cos(crossfade * math.pi * 0.5)
    return outgoing, math.sin(crossfade * math.pi * 0.5)


def staging_gains(
    progress: float,
    outgoing_gain_db: float,
    incoming_gain_db: float,
) -> tuple[float, float]:
    """Linear (outgoing, incoming) loudness staging factors at a mix progress.

    The outgoing deck eases into its gain over the first half; the incoming
    deck starts at its gain and eases back to unity over the second half.
    """
    position = _clamp_unit(progress)
    outgoing_weight = (
        1.0 if position >= 0.5 else 0.5 - 0.5 * math.cos(math.pi * position / 0.5)
    )
    incoming_weight = (
        1.0
        if position <= 0.5
        else 0.5 + 0.5 * math.cos(math.pi * (position - 0.5) / 0.5)
    )
    return (
        _staging(_db_to_gain(outgoing_gain_db), outgoing_weight),
        _staging(_db_to_gain(incoming_gain_db), incoming_weight),
    )


def bass_cut_db(progress: float, handoff_progress: float) -> tuple[float, float]:
    """(outgoing, incoming) bass shelf cut in dB during a bass handoff."""
    half_window = BASS_SWAP_FRACTION / 2.0
    centre = max(half_window, min(1.0 - half_window, handoff_progress))
    position = (progress - (centre - half_window)) / BASS_SWAP_FRACTION
    if position <= 0.0:
        swapped = 0.0
    elif position >= 1.0:
        swapped = 1.0
    else:
        swapped = 0.5 - 0.5 * math.cos(math.pi * position)
    return BASS_CUT_DB * swapped, BASS_CUT_DB * (1.0 - swapped)


def effective_curve(plan: TransitionPlan) -> str:
    """The crossfade curve the engines apply: DJ blend only in beatmatch."""
    return plan.curve if plan.mode == TransitionMode.BEATMATCH else "equal-power"


def bass_handoff_engaged(plan: TransitionPlan) -> bool:
    return plan.mode == TransitionMode.BEATMATCH and plan.bass_handoff == "balanced"


def incoming_tempo(plan: TransitionPlan) -> float:
    """Playback rate of the incoming deck during the mix."""
    if plan.mode == TransitionMode.BEATMATCH:
        return plan.incoming_tempo_ratio
    return 1.0


def incoming_start_ms(plan: TransitionPlan) -> int:
    """Incoming position when the mix starts (``startIncomingCueMs`` on Android)."""
    if plan.mode != TransitionMode.BEATMATCH:
        return plan.incoming_cue_ms
    return plan.incoming_cue_ms + round(
        plan.beat_phase_offset_ms * plan.incoming_tempo_ratio
    )


def edge_tempo_delta(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
) -> float | None:
    """Tempo adjustment the incoming track needs, as ``|ratio - 1|``.

    Uses the tempos the planner uses at the cues (outro and intro, falling
    back to the track BPM), with half and double time folded.
    """
    outgoing_bpm = (
        outgoing.outro_bpm
        if outgoing.outro_bpm and outgoing.outro_beat_ms is not None
        else outgoing.bpm
    )
    incoming_bpm = (
        incoming.intro_bpm
        if incoming.intro_bpm and incoming.intro_beat_ms is not None
        else incoming.bpm
    )
    if not outgoing_bpm or not incoming_bpm:
        return None
    return abs(tempo_ratio(outgoing_bpm, incoming_bpm) - 1.0)


# --- timeline --------------------------------------------------------------


def _overlap_ms(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    level_check: Callable[[float, float, float], bool],
    *,
    position_filter: Callable[[float], bool] | None = None,
) -> int:
    duration_ms = plan.duration_ms
    if duration_ms <= 0:
        return 0
    curve = effective_curve(plan)
    ratio = incoming_tempo(plan)
    incoming_start = incoming_start_ms(plan)
    total = 0.0
    for position_ms, weight_ms in _timeline(duration_ms):
        progress = position_ms / duration_ms
        outgoing_gain, incoming_gain = crossfade_gains(progress, curve)
        if not level_check(
            progress, _gain_to_db(outgoing_gain), _gain_to_db(incoming_gain)
        ):
            continue
        if not _sounding(outgoing, plan.outgoing_cue_ms + position_ms):
            continue
        if not _sounding(incoming, incoming_start + position_ms * ratio):
            continue
        if position_filter is not None and not position_filter(position_ms):
            continue
        total += weight_ms
    return round(total)


def _both_full_level(_progress: float, outgoing_db: float, incoming_db: float) -> bool:
    return outgoing_db >= OVERLAP_FLOOR_DB and incoming_db >= OVERLAP_FLOOR_DB


def _timeline(duration_ms: int) -> Iterator[tuple[float, float]]:
    start = 0
    while start < duration_ms:
        width = min(TIMELINE_STEP_MS, duration_ms - start)
        yield start + width / 2.0, float(width)
        start += TIMELINE_STEP_MS


def _sounding(profile: TrackMixProfile | None, position_ms: float) -> bool:
    if profile is None:
        return True
    start_ms = profile.active_start_ms or 0
    end_ms = _playable_end_ms(profile)
    return start_ms <= position_ms < end_ms


def _playable_end_ms(profile: TrackMixProfile) -> int:
    if profile.active_end_ms is not None:
        return min(profile.active_end_ms, profile.duration_ms)
    return profile.duration_ms


# --- phrases ---------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Phrase:
    start_ms: float
    end_ms: float | None
    energy: float | None


class _StoredPhrases:
    basis: PhraseBasis = "phrases"

    def __init__(self, phrases: Sequence[_Phrase]) -> None:
        self._phrases = tuple(phrases)
        self._starts = [phrase.start_ms for phrase in self._phrases]
        boundaries = set(self._starts)
        boundaries.update(
            phrase.end_ms for phrase in self._phrases if phrase.end_ms is not None
        )
        self._boundaries = sorted(boundaries)

    def is_boundary(self, position_ms: float, tolerance_ms: float) -> bool:
        return _near_any(self._boundaries, position_ms, tolerance_ms)

    def index_at(self, position_ms: float) -> int | None:
        index = bisect_right(self._starts, position_ms) - 1
        if index < 0:
            return None
        end_ms = self._phrases[index].end_ms
        if end_ms is not None and position_ms >= end_ms:
            return None
        return index

    def energy_at(self, position_ms: float) -> float | None:
        index = self.index_at(position_ms)
        return None if index is None else self._phrases[index].energy


class _GridPhrases:
    basis: PhraseBasis = "grid"

    def __init__(
        self,
        *,
        anchor_ms: int,
        beat_ms: float,
        phrase_beats: int,
        grid: tuple[int, ...],
    ) -> None:
        self._beat_ms = beat_ms
        self._phrase_beats = phrase_beats
        self._grid = grid
        self._anchor_ms = float(anchor_ms)
        self._downbeat_index = _nearest_index(grid, anchor_ms) if grid else 0

    def is_boundary(self, position_ms: float, tolerance_ms: float) -> bool:
        grid = self._grid
        if grid and grid[0] - tolerance_ms <= position_ms <= grid[-1] + tolerance_ms:
            index = _nearest_index(grid, position_ms)
            return (
                abs(grid[index] - position_ms) <= tolerance_ms
                and (index - self._downbeat_index) % self._phrase_beats == 0
            )
        phrase_ms = self._phrase_beats * self._beat_ms
        offset = (position_ms - self._extrapolation_anchor(position_ms)) % phrase_ms
        return min(offset, phrase_ms - offset) <= tolerance_ms

    def _extrapolation_anchor(self, position_ms: float) -> float:
        grid = self._grid
        if not grid:
            return self._anchor_ms
        aligned = range(
            self._downbeat_index % self._phrase_beats, len(grid), self._phrase_beats
        )
        if not aligned:
            return self._anchor_ms
        index = aligned[0] if position_ms < grid[0] else aligned[-1]
        return float(grid[index])


def _phrase_boundaries(
    profile: TrackMixProfile,
) -> _StoredPhrases | _GridPhrases | None:
    stored = _stored_phrases(profile)
    if stored is not None:
        return stored
    anchor_ms = (
        profile.downbeat_anchor_ms
        if profile.downbeat_anchor_ms is not None
        else profile.beat_anchor_ms
    )
    if not profile.bpm or anchor_ms is None:
        return None
    return _GridPhrases(
        anchor_ms=anchor_ms,
        beat_ms=60_000.0 / profile.bpm,
        phrase_beats=GRID_PHRASE_BARS * _beats_per_bar(profile),
        grid=tuple(profile.beat_grid_ms),
    )


def _stored_phrases(profile: TrackMixProfile) -> _StoredPhrases | None:
    """Schema 2 phrases (SM1), read without depending on their concrete type.

    Each item may be a mapping or an object with ``start_ms``/``startMs``,
    ``bars`` and ``energy`` (0-1). A phrase ends where the next one starts, or
    after its bars when that comes first.
    """
    raw = getattr(profile, "phrases", None)
    if not raw:
        return None
    beat_ms = 60_000.0 / profile.bpm if profile.bpm else None
    beats_per_bar = _beats_per_bar(profile)
    items: list[tuple[float, float | None, float | None]] = []
    for item in raw:
        start = _field(item, "start_ms", "startMs")
        if start is None:
            continue
        bars = _field(item, "bars", "bars")
        energy = _field(item, "energy", "energy")
        length = (
            float(bars) * beats_per_bar * beat_ms
            if bars is not None and beat_ms is not None
            else None
        )
        items.append(
            (
                float(start),
                length,
                float(energy) if energy is not None else None,
            )
        )
    if not items:
        return None
    items.sort(key=lambda value: value[0])
    phrases: list[_Phrase] = []
    for index, (start, length, energy) in enumerate(items):
        next_start = items[index + 1][0] if index + 1 < len(items) else None
        own_end = start + length if length is not None else None
        candidates = [value for value in (next_start, own_end) if value is not None]
        phrases.append(
            _Phrase(
                start_ms=start,
                end_ms=min(candidates) if candidates else None,
                energy=energy,
            )
        )
    return _StoredPhrases(phrases)


def _vocal_presence(profile: TrackMixProfile) -> tuple[float, ...] | None:
    raw = getattr(profile, "vocal_presence", None)
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray, memoryview)):
        return tuple(value / 255.0 for value in bytes(raw))
    return tuple(float(value) for value in raw)


def _has_vocals(
    phrases: _StoredPhrases,
    presence: tuple[float, ...],
    position_ms: float,
) -> bool:
    index = phrases.index_at(position_ms)
    if index is None or index >= len(presence):
        return False
    return presence[index] >= VOCAL_PRESENCE_THRESHOLD


def _stem_presence(profile: TrackMixProfile, attribute: str) -> tuple[bool, ...] | None:
    layer = getattr(profile, "stems", None)
    if layer is None:
        return None
    return tuple(bool(getattr(entry, attribute)) for entry in layer.phrases)


def _flag_at(
    phrases: _StoredPhrases, flags: tuple[bool, ...], position_ms: float
) -> bool:
    index = phrases.index_at(position_ms)
    return index is not None and index < len(flags) and flags[index]


def _phrase_tolerance_ms(profile: TrackMixProfile, tolerance_beats: float) -> float:
    if not profile.bpm:
        return float(DEFAULT_PHRASE_TOLERANCE_MS)
    return tolerance_beats * 60_000.0 / profile.bpm


def _beats_per_bar(profile: TrackMixProfile) -> int:
    return profile.time_signature or 4


def _field(item: Any, snake_case: str, camel_case: str) -> Any:
    if isinstance(item, Mapping):
        return item.get(snake_case, item.get(camel_case))
    value = getattr(item, snake_case, None)
    return value if value is not None else getattr(item, camel_case, None)


def _near_any(
    sorted_values: Sequence[float], position: float, tolerance: float
) -> bool:
    if not sorted_values:
        return False
    index = _nearest_index(sorted_values, position)
    return abs(sorted_values[index] - position) <= tolerance


def _nearest_index(sorted_values: Sequence[float], position: float) -> int:
    index = bisect_left(sorted_values, position)
    if index <= 0:
        return 0
    if index >= len(sorted_values):
        return len(sorted_values) - 1
    before = sorted_values[index - 1]
    after = sorted_values[index]
    return index - 1 if position - before <= after - position else index


# --- helpers ---------------------------------------------------------------


def _harmonic_relationship(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> CamelotRelationship:
    if outgoing is None or incoming is None:
        return CamelotRelationship.UNKNOWN
    return camelot_relationship(outgoing.camelot, incoming.camelot)


def _energy_step(outgoing: float, incoming: float, basis: EnergyBasis) -> EnergyStep:
    signed = round(float(incoming) - float(outgoing), 6)
    return EnergyStep(value=abs(signed), signed=signed, basis=basis)


def _is_short_cut(plan: TransitionPlan, policy: PlannerPolicy) -> bool:
    return (
        plan.mode == TransitionMode.ADAPTIVE
        and plan.fallback_reason == TransitionFallbackReason.INSUFFICIENT_WINDOW
        and plan.duration_ms <= policy.manual_ramp_ms
    )


def _gains_in_range(
    plan: TransitionPlan,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    policy: PlannerPolicy,
) -> bool:
    """The planner's gain rule: loudness matching within the policy range.

    Boosts stop at ``max_loudness_adjustment_db`` (at
    ``maximum_unaccredited_gain_db`` unless both decks carry an accredited
    loudness measurement). Attenuation beyond the range is only valid when
    it is exactly what the combined true peak ceiling needs for that deck.
    """
    accredited = (
        outgoing is not None
        and incoming is not None
        and _has_accredited_measurement(outgoing)
        and _has_accredited_measurement(incoming)
    )
    maximum_boost = (
        policy.max_loudness_adjustment_db
        if accredited
        else policy.maximum_unaccredited_gain_db
    )
    for profile, gain in (
        (outgoing, plan.outgoing_gain_db),
        (incoming, plan.incoming_gain_db),
    ):
        if gain > max(0.0, maximum_boost) + _EPSILON:
            return False
        if gain >= -policy.max_loudness_adjustment_db - _EPSILON:
            continue
        if profile is None:
            return False
        peak_limited_gain = (
            policy.combined_true_peak_ceiling_dbfs
            - policy.equal_power_midpoint_headroom_db
            - _deck_peak_dbfs(profile)
        )
        if abs(gain - peak_limited_gain) > _TRUE_PEAK_TOLERANCE_DB:
            return False
    return True


def _long_beatmatch_stable(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    policy: PlannerPolicy,
) -> bool:
    if outgoing is None or incoming is None:
        return False
    return all(
        stability is not None and stability >= policy.minimum_long_beatmatch_stability
        for stability in (outgoing.tempo_stability, incoming.tempo_stability)
    )


def _deck_peak_dbfs(profile: TrackMixProfile) -> float:
    if profile.true_peak_dbfs is not None and _has_accredited_measurement(profile):
        return float(profile.true_peak_dbfs)
    return 0.0


def _has_accredited_measurement(profile: TrackMixProfile) -> bool:
    return profile.measurement_version == MEASUREMENT_VERSION


def _dj_blend_progress(progress: float) -> float:
    position = _clamp_unit(progress)
    if position <= DJ_BLEND_ENTRY:
        return 0.5 * _smoothstep(position / DJ_BLEND_ENTRY)
    if position < DJ_BLEND_EXIT:
        return 0.5
    return 0.5 + 0.5 * _smoothstep((position - DJ_BLEND_EXIT) / (1.0 - DJ_BLEND_EXIT))


def _smoothstep(value: float) -> float:
    position = _clamp_unit(value)
    return position * position * (3.0 - 2.0 * position)


def _staging(gain: float, weight: float) -> float:
    return 1.0 + (gain - 1.0) * weight


def _db_to_gain(value_db: float) -> float:
    return 10.0 ** (value_db / 20.0)


def _gain_to_db(gain: float) -> float:
    if gain <= 0.0:
        return -math.inf
    return 20.0 * math.log10(gain)


def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


__all__ = [
    "BASS_CUT_DB",
    "BASS_SHELF_HZ",
    "BASS_SWAP_FRACTION",
    "DJ_BLEND_ENTRY",
    "DJ_BLEND_EXIT",
    "EnergyStep",
    "GRID_PHRASE_BARS",
    "MusicLeftOut",
    "OVERLAP_FLOOR_DB",
    "OVERLAP_FLOOR_GAIN",
    "POLICY_VIOLATION_CODES",
    "PhraseAlignment",
    "PolicyLimits",
    "TransitionEvaluation",
    "bass_cut_db",
    "bass_handoff_engaged",
    "bass_overlap_ms",
    "crossfade_gains",
    "edge_tempo_delta",
    "effective_curve",
    "energy_step",
    "evaluate_transition",
    "harmonic_clash_ms",
    "incoming_start_ms",
    "incoming_tempo",
    "limit_violations",
    "music_left_out",
    "phrase_alignment",
    "policy_limits",
    "policy_violations",
    "staging_gains",
    "stem_bass_clash_ms",
    "stem_vocal_clash_ms",
    "vocal_clash_ms",
]
