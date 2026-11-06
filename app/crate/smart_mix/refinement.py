"""Deterministic validation of a model's transition choice (SM3-D1, design §9).

The model never writes milliseconds, ratios or gains. It picks one candidate of
the v3 menu by index and may move the outgoing or incoming phrase by one, step the
length to the previous or next phrase length, or set the bass handoff.
``apply_refinement`` rebuilds the plan from that candidate with the generator's
own code (``crate.smart_mix.candidates.recompose_candidate``), validates it again
with ``TransitionPlan`` and the planner policy, and rejects anything else with a
closed code. A rejected choice leaves the client on the deterministic plan.

``phrase_windows`` names the phrases the prompt shows: the last outgoing and the
first incoming ones, widened so that every candidate phrase and its neighbours
are visible. A shift can only land on a phrase the model was shown.

Every function is pure: no database, cache or model access.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, Literal, Protocol

from crate.smart_mix.candidates import recompose_candidate
from crate.smart_mix.evaluation import policy_violations
from crate.smart_mix.models import (
    TrackMixProfile,
    TransitionCandidate,
    TransitionContext,
    TransitionMode,
    TransitionPlan,
)
from crate.smart_mix.policy import PlannerPolicy

# The Music Paths review threshold: a less confident choice keeps the planner's.
MIN_CONFIDENCE = 0.55
# Phrases shown around the mix window (design §8).
OUTGOING_PHRASES_SHOWN = 6
INCOMING_PHRASES_SHOWN = 6

RejectionCode = Literal[
    "unknown_candidate",
    "low_confidence",
    "shift_out_of_range",
    "length_not_allowed",
    "bass_handoff_not_allowed",
    "plan_invalid",
    "policy_violation",
    # Set by the worker: the answer did not match the response schema, or the
    # menu offered no choice and the model was not called.
    "response_invalid",
    "single_candidate",
]
REJECTION_CODES: frozenset[str] = frozenset(RejectionCode.__args__)  # type: ignore[attr-defined]


class RefinementChoice(Protocol):
    """The fields of a model answer the validation reads (see the prompt module)."""

    @property
    def candidate_index(self) -> int: ...
    @property
    def outgoing_phrase_shift(self) -> int: ...
    @property
    def incoming_phrase_shift(self) -> int: ...
    @property
    def length_step(self) -> int: ...
    @property
    def bass_handoff(self) -> str: ...
    @property
    def reason(self) -> str: ...
    @property
    def confidence(self) -> float: ...


@dataclass(frozen=True, slots=True)
class RefinementOutcome:
    """A validated choice: a plan when ``ready``, a closed code when ``rejected``."""

    status: Literal["ready", "rejected"]
    code: str | None
    candidate_index: int | None
    adjustments: dict[str, int | str]
    plan: TransitionPlan | None
    reason: str | None
    confidence: float | None
    deterministic_plan_hash: str


def refinement_key(
    *,
    planner_identifier: str,
    rules_revision: int,
    outgoing_track_entity_uid: str,
    incoming_track_entity_uid: str,
    outgoing_profile_revision: str,
    incoming_profile_revision: str,
    context: Mapping[str, Any],
    prompt_version: str,
    schema_fingerprint: str,
    config_fingerprint: str,
    send_genre: bool,
) -> str:
    """The identity a refinement is paid for once (SM3-D5).

    ``context`` is the request context as the plan cache normalizes it, plus the
    set history the prompt reads. ``config_fingerprint`` changes with the model or
    profile; ``send_genre`` changes the prompt.
    """
    identity = {
        "planner": planner_identifier,
        "rules": rules_revision,
        "outgoing": [str(outgoing_track_entity_uid), outgoing_profile_revision],
        "incoming": [str(incoming_track_entity_uid), incoming_profile_revision],
        "context": dict(context),
        "prompt": prompt_version,
        "schema": schema_fingerprint,
        "config": config_fingerprint,
        "genre": bool(send_genre),
    }
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def context_from_payload(payload: Mapping[str, Any]) -> TransitionContext:
    """The planner context of a normalized request context (camelCase keys)."""
    return TransitionContext(
        source=str(payload["source"]),
        automatic=bool(payload["automatic"]),
        offline=bool(payload["offline"]),
        preferred_duration_ms=int(payload["preferredDurationMs"]),
        user_cue_profile=str(payload["userCueProfile"]),
        allow_beatmatch=bool(payload["allowBeatmatch"]),
        allow_tempo_adjustment=bool(payload["allowTempoAdjustment"]),
        allow_bass_handoff=bool(payload.get("allowBassHandoff", False)),
        allow_long_beatmatch=bool(payload.get("allowLongBeatmatch", False)),
    )


def phrase_windows(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    candidates: Sequence[TransitionCandidate],
) -> tuple[range, range]:
    """Indices of the outgoing and incoming phrases the model is shown."""
    outgoing_count = len(outgoing.phrases or ())
    incoming_count = len(incoming.phrases or ())
    outgoing_start = max(0, outgoing_count - OUTGOING_PHRASES_SHOWN)
    incoming_stop = min(incoming_count, INCOMING_PHRASES_SHOWN)
    for candidate in candidates:
        if candidate.outgoing_phrase is not None:
            outgoing_start = min(outgoing_start, max(0, candidate.outgoing_phrase - 1))
        if candidate.incoming_phrase is not None:
            incoming_stop = max(
                incoming_stop, min(incoming_count, candidate.incoming_phrase + 2)
            )
    return range(outgoing_start, outgoing_count), range(0, incoming_stop)


def deterministic_plan_hash(candidates: Sequence[TransitionCandidate]) -> str:
    """Hash of the planner's own plan (the first candidate), to measure changes."""
    plan = candidates[0].to_plan().to_dict() if candidates else None
    canonical = json.dumps(plan, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def apply_refinement(
    candidates: Sequence[TransitionCandidate],
    response: RefinementChoice,
    profiles: tuple[TrackMixProfile, TrackMixProfile],
    policy: PlannerPolicy,
    *,
    context: TransitionContext,
) -> RefinementOutcome:
    """Rebuild and validate the plan a model chose (design §9)."""
    outgoing, incoming = profiles
    index = int(response.candidate_index)
    outgoing_shift = int(response.outgoing_phrase_shift)
    incoming_shift = int(response.incoming_phrase_shift)
    length_step = int(response.length_step)
    adjustments: dict[str, int | str] = {
        "outgoingPhraseShift": outgoing_shift,
        "incomingPhraseShift": incoming_shift,
        "lengthStep": length_step,
        "bassHandoff": response.bass_handoff,
    }
    base_hash = deterministic_plan_hash(candidates)

    def outcome(code: str | None, plan: TransitionPlan | None = None):
        return RefinementOutcome(
            status="ready" if code is None else "rejected",
            code=code,
            candidate_index=index,
            adjustments=adjustments,
            plan=plan if code is None else None,
            reason=response.reason,
            confidence=float(response.confidence),
            deterministic_plan_hash=base_hash,
        )

    if not 0 <= index < len(candidates):
        return outcome("unknown_candidate")
    if float(response.confidence) < MIN_CONFIDENCE:
        return outcome("low_confidence")
    candidate = candidates[index]
    phrased = (
        candidate.outgoing_phrase is not None and candidate.incoming_phrase is not None
    )
    outgoing_phrase = candidate.outgoing_phrase
    incoming_phrase = candidate.incoming_phrase
    if outgoing_shift or incoming_shift:
        if not phrased:
            return outcome("shift_out_of_range")
        assert outgoing_phrase is not None and incoming_phrase is not None
        outgoing_window, incoming_window = phrase_windows(
            outgoing, incoming, candidates
        )
        outgoing_phrase += outgoing_shift
        incoming_phrase += incoming_shift
        if outgoing_phrase not in outgoing_window or (
            incoming_phrase not in incoming_window
        ):
            return outcome("shift_out_of_range")
    length_bars = candidate.length_bars
    if length_step:
        lengths = sorted(policy.phrase_lengths)
        if not phrased or length_bars not in lengths:
            return outcome("length_not_allowed")
        position = lengths.index(length_bars) + length_step
        if not 0 <= position < len(lengths):
            return outcome("length_not_allowed")
        length_bars = lengths[position]
    bass_handoff = (
        candidate.bass_handoff
        if response.bass_handoff == "keep"
        else response.bass_handoff
    )
    if bass_handoff == "balanced" and (
        not context.allow_bass_handoff or candidate.mode != TransitionMode.BEATMATCH
    ):
        return outcome("bass_handoff_not_allowed")

    try:
        if not (outgoing_shift or incoming_shift or length_step) and (
            bass_handoff == candidate.bass_handoff
        ):
            plan = candidate.to_plan()
        elif not phrased:
            # A bar heuristic candidate: only its bass handoff can change.
            plan = replace(candidate.to_plan(), bass_handoff=bass_handoff)
        else:
            assert outgoing_phrase is not None and incoming_phrase is not None
            plan = recompose_candidate(
                outgoing,
                incoming,
                context,
                policy,
                outgoing_phrase=outgoing_phrase,
                incoming_phrase=incoming_phrase,
                length_bars=length_bars,
                bass_handoff=bass_handoff,
                curve=candidate.curve,
                outgoing_track_entity_uid=candidate.outgoing_track_entity_uid,
                incoming_track_entity_uid=candidate.incoming_track_entity_uid,
            )
    except ValueError:
        return outcome("plan_invalid")
    if plan is None:
        return outcome("plan_invalid")
    if policy_violations(plan, outgoing, incoming, context=context, policy=policy):
        return outcome("policy_violation")
    return outcome(None, plan)


__all__ = [
    "INCOMING_PHRASES_SHOWN",
    "MIN_CONFIDENCE",
    "OUTGOING_PHRASES_SHOWN",
    "REJECTION_CODES",
    "RefinementChoice",
    "RefinementOutcome",
    "apply_refinement",
    "context_from_payload",
    "deterministic_plan_hash",
    "phrase_windows",
    "refinement_key",
]
