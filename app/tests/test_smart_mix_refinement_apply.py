"""Deterministic validation of a model's transition choice (SM4.PR1, design §9)."""

from __future__ import annotations

import random
from dataclasses import dataclass, replace

import pytest

from crate.smart_mix.candidates import plan_transition_candidates
from crate.smart_mix.evaluation import policy_violations
from crate.smart_mix.models import TransitionPlan
from crate.smart_mix.policy import PLANNER_POLICY_V3
from crate.smart_mix.refinement import (
    MIN_CONFIDENCE,
    REJECTION_CODES,
    apply_refinement,
    deterministic_plan_hash,
    phrase_windows,
)
from tests.smart_mix_candidate_cases import (
    BEAT_MS,
    INCOMING_LAYOUT,
    INCOMING_UID,
    LISTEN,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
    context,
    edge_cases,
    profile,
)

POLICY = PLANNER_POLICY_V3


@dataclass(frozen=True)
class Choice:
    """The fields of a model answer that the validation reads."""

    candidate_index: int = 0
    outgoing_phrase_shift: int = 0
    incoming_phrase_shift: int = 0
    length_step: int = 0
    bass_handoff: str = "keep"
    reason: str = "Phrase-aligned long blend."
    confidence: float = 0.8


def _menu(outgoing, incoming, ctx):
    return plan_transition_candidates(
        outgoing,
        incoming,
        ctx,
        POLICY,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
    )


def _apply(choice, outgoing, incoming, ctx):
    candidates = _menu(outgoing, incoming, ctx)
    return candidates, apply_refinement(
        candidates, choice, (outgoing, incoming), POLICY, context=ctx
    )


def _structured():
    return (
        profile(OUTGOING_UID, layout=OUTGOING_LAYOUT),
        profile(INCOMING_UID, layout=INCOMING_LAYOUT),
    )


def _first(candidates, predicate):
    return next(candidate for candidate in candidates if predicate(candidate))


def test_unknown_candidate_rejected():
    outgoing, incoming = _structured()
    candidates = _menu(outgoing, incoming, context())

    outcome = apply_refinement(
        candidates,
        Choice(candidate_index=len(candidates)),
        (outgoing, incoming),
        POLICY,
        context=context(),
    )

    assert outcome.status == "rejected"
    assert outcome.code == "unknown_candidate"
    assert outcome.plan is None
    assert outcome.candidate_index == len(candidates)
    assert outcome.deterministic_plan_hash == deterministic_plan_hash(candidates)


def test_shift_out_of_range_rejected():
    outgoing, incoming = _structured()
    ctx = context()
    candidates = _menu(outgoing, incoming, ctx)
    out_window, in_window = phrase_windows(outgoing, incoming, candidates)
    last_out = _first(
        candidates, lambda candidate: candidate.outgoing_phrase == out_window.stop - 1
    )
    first_in = _first(
        candidates, lambda candidate: candidate.incoming_phrase == in_window.start
    )

    beyond = apply_refinement(
        candidates,
        Choice(candidate_index=last_out.index, outgoing_phrase_shift=1),
        (outgoing, incoming),
        POLICY,
        context=ctx,
    )
    before = apply_refinement(
        candidates,
        Choice(candidate_index=first_in.index, incoming_phrase_shift=-1),
        (outgoing, incoming),
        POLICY,
        context=ctx,
    )
    assert (beyond.status, beyond.code) == ("rejected", "shift_out_of_range")
    assert (before.status, before.code) == ("rejected", "shift_out_of_range")

    # Without phrases (the bar heuristic) there is nothing to shift to.
    plain = (profile(OUTGOING_UID), profile(INCOMING_UID))
    heuristic, outcome = _apply(
        Choice(candidate_index=0, outgoing_phrase_shift=-1), *plain, ctx
    )
    assert heuristic[0].outgoing_phrase is None
    assert (outcome.status, outcome.code) == ("rejected", "shift_out_of_range")

    # The model sees the last outgoing and first incoming phrases, widened so that
    # every candidate phrase and its neighbours are shown: a shift never reaches a
    # phrase it was not given.
    long_layout = (("body", 16, 0.6),) * 12 + OUTGOING_LAYOUT
    long_out = profile(OUTGOING_UID, layout=long_layout, duration_ms=700_000)
    menu = _menu(long_out, incoming, ctx)
    window, in_window = phrase_windows(long_out, incoming, menu)
    assert 0 < window.start and window.stop == len(long_layout)
    for candidate in menu:
        if candidate.outgoing_phrase is None:
            continue
        assert window.start <= candidate.outgoing_phrase - 1
        assert candidate.incoming_phrase + 1 < in_window.stop


def test_length_step_respects_policy():
    outgoing, incoming = _structured()
    ctx = context()
    candidates = _menu(outgoing, incoming, ctx)
    sixteen = _first(candidates, lambda candidate: candidate.length_bars == 16)

    shorter = apply_refinement(
        candidates,
        Choice(candidate_index=sixteen.index, length_step=-1),
        (outgoing, incoming),
        POLICY,
        context=ctx,
    )
    assert shorter.status == "ready", shorter.code
    assert shorter.plan is not None
    # Eight bars at 125 BPM.
    assert shorter.plan.duration_ms == 8 * 4 * BEAT_MS
    assert shorter.adjustments["lengthStep"] == -1

    # 32 bars at 125 BPM last 61.44 s: longer than the 48 s long blend.
    longer = apply_refinement(
        candidates,
        Choice(candidate_index=sixteen.index, length_step=1),
        (outgoing, incoming),
        POLICY,
        context=ctx,
    )
    assert (longer.status, longer.code) == ("rejected", "plan_invalid")

    eight = _first(candidates, lambda candidate: candidate.length_bars == 8)
    below = apply_refinement(
        candidates,
        Choice(candidate_index=eight.index, length_step=-1),
        (outgoing, incoming),
        POLICY,
        context=ctx,
    )
    assert (below.status, below.code) == ("rejected", "length_not_allowed")

    fitted = _first(
        candidates,
        lambda candidate: (
            candidate.length_bars is None and candidate.outgoing_phrase is not None
        ),
    )
    unstepped = apply_refinement(
        candidates,
        Choice(candidate_index=fitted.index, length_step=1),
        (outgoing, incoming),
        POLICY,
        context=ctx,
    )
    assert (unstepped.status, unstepped.code) == ("rejected", "length_not_allowed")


def test_balanced_bass_requires_context():
    outgoing, incoming = _structured()
    listen = context(**LISTEN)
    candidates, refused = _apply(
        Choice(candidate_index=0, bass_handoff="balanced"), outgoing, incoming, listen
    )
    assert candidates[0].bass_handoff == "none"
    assert (refused.status, refused.code) == ("rejected", "bass_handoff_not_allowed")

    dj = context()
    menu = _menu(outgoing, incoming, dj)
    plain_bass = _first(menu, lambda candidate: candidate.bass_handoff == "none")
    accepted = apply_refinement(
        menu,
        Choice(candidate_index=plain_bass.index, bass_handoff="balanced"),
        (outgoing, incoming),
        POLICY,
        context=dj,
    )
    assert accepted.status == "ready", accepted.code
    assert accepted.plan.bass_handoff == "balanced"
    assert accepted.adjustments["bassHandoff"] == "balanced"

    # A crossfade never hands the bass over.
    fast = profile(INCOMING_UID, layout=INCOMING_LAYOUT, bpm=140.0)
    crossfades, crossfade = _apply(
        Choice(candidate_index=0, bass_handoff="balanced"), outgoing, fast, dj
    )
    assert crossfades[0].mode == "adaptive"
    assert crossfade.code == "bass_handoff_not_allowed"


def test_low_confidence_rejected():
    outgoing, incoming = _structured()
    ctx = context()
    _, unsure = _apply(
        Choice(confidence=MIN_CONFIDENCE - 0.01), outgoing, incoming, ctx
    )
    _, sure = _apply(Choice(confidence=MIN_CONFIDENCE), outgoing, incoming, ctx)

    assert MIN_CONFIDENCE == 0.55
    assert (unsure.status, unsure.code) == ("rejected", "low_confidence")
    assert sure.status == "ready"


def test_valid_refinement_builds_transition_plan():
    outgoing, incoming = _structured()
    ctx = context()
    candidates = _menu(outgoing, incoming, ctx)
    assert len(candidates) >= 4

    kept = apply_refinement(
        candidates,
        Choice(candidate_index=2),
        (outgoing, incoming),
        POLICY,
        context=ctx,
    )
    assert kept.status == "ready" and kept.code is None
    assert kept.plan == candidates[2].to_plan()
    assert kept.candidate_index == 2
    assert kept.adjustments == {
        "outgoingPhraseShift": 0,
        "incomingPhraseShift": 0,
        "lengthStep": 0,
        "bassHandoff": "keep",
    }
    assert kept.reason == Choice().reason
    assert kept.confidence == Choice().confidence

    phrased = _first(
        candidates,
        lambda candidate: (
            candidate.outgoing_phrase is not None and candidate.outgoing_phrase > 0
        ),
    )
    earlier = apply_refinement(
        candidates,
        Choice(candidate_index=phrased.index, outgoing_phrase_shift=-1),
        (outgoing, incoming),
        POLICY,
        context=ctx,
    )
    assert earlier.status == "ready", earlier.code
    plan = earlier.plan
    assert isinstance(plan, TransitionPlan)
    assert (
        plan.outgoing_cue_ms == outgoing.phrases[phrased.outgoing_phrase - 1].start_ms
    )
    assert plan.outgoing_track_entity_uid == OUTGOING_UID
    assert plan.incoming_track_entity_uid == INCOMING_UID
    assert plan.planner_version == candidates[0].planner_version
    assert policy_violations(plan, outgoing, incoming, context=ctx, policy=POLICY) == ()
    assert earlier.deterministic_plan_hash == deterministic_plan_hash(candidates)
    assert earlier.deterministic_plan_hash != deterministic_plan_hash(candidates[1:])


@pytest.mark.parametrize("seed", [7])
def test_refined_plan_never_violates_policy(seed):
    rng = random.Random(seed)
    edges = [
        (name, outgoing, incoming, ctx)
        for name, outgoing, incoming, ctx in edge_cases()
        if outgoing is not None and incoming is not None
    ]
    # Variety beyond the shared cases: other tempos, keys and phrase lengths.
    outgoing, incoming = _structured()
    edges += [
        ("listen_bass", outgoing, incoming, context(**LISTEN)),
        (
            "slower_incoming",
            outgoing,
            profile(INCOMING_UID, layout=INCOMING_LAYOUT, bpm=121.0),
            context(),
        ),
        (
            "short_phrases",
            profile(OUTGOING_UID, layout=(("body", 8, 0.6),) * 14),
            profile(INCOMING_UID, layout=(("body", 8, 0.6),) * 14),
            context(),
        ),
        (
            "no_long_blend",
            outgoing,
            incoming,
            replace(context(), allow_long_beatmatch=False),
        ),
    ]
    menus = {name: _menu(out, inc, ctx) for name, out, inc, ctx in edges}
    outcomes = {"ready": 0, "rejected": 0}
    for _ in range(1000):
        name, out, inc, ctx = rng.choice(edges)
        candidates = menus[name]
        # Answers a model could give, most of them confident and small changes.
        choice = Choice(
            candidate_index=rng.randrange(0, 9),
            outgoing_phrase_shift=rng.choice((-1, 0, 0, 1)),
            incoming_phrase_shift=rng.choice((-1, 0, 0, 1)),
            length_step=rng.choice((-1, 0, 0, 1)),
            bass_handoff=rng.choice(("keep", "keep", "none", "balanced")),
            confidence=rng.choice((0.2, 0.54, 0.55, 0.7, 0.9)),
        )
        outcome = apply_refinement(candidates, choice, (out, inc), POLICY, context=ctx)
        outcomes[outcome.status] += 1
        if outcome.status == "rejected":
            assert outcome.code in REJECTION_CODES
            assert outcome.plan is None
            continue
        plan = outcome.plan
        assert outcome.code is None and plan is not None
        assert choice.confidence >= MIN_CONFIDENCE
        assert policy_violations(plan, out, inc, context=ctx, policy=POLICY) == ()
        assert (
            POLICY.minimum_transition_ms
            <= plan.duration_ms
            <= POLICY.maximum_long_beatmatch_ms
        ) or plan.mode == "gapless"
        assert 0.94 <= plan.incoming_tempo_ratio <= 1.06
        if plan.bass_handoff == "balanced":
            assert ctx.allow_bass_handoff and plan.mode == "beatmatch"
        if plan.duration_ms > POLICY.maximum_transition_ms:
            assert ctx.allow_long_beatmatch and plan.curve == "dj-blend"
    # Both branches are exercised.
    assert outcomes["ready"] > 100 and outcomes["rejected"] > 100


def test_bass_answers_match_what_the_prompt_offers():
    # The validation stays strict: a bass_handoff the candidate's bassOk does not
    # list is rejected, and every value it lists passes the bass check.
    from crate.llm.prompts.smart_mix_transition import build_refinement_input

    fast = profile(INCOMING_UID, layout=INCOMING_LAYOUT, bpm=140.0)
    cases = [
        *edge_cases(),
        (
            "crossfade_dj",
            profile(OUTGOING_UID, layout=OUTGOING_LAYOUT),
            fast,
            context(),
        ),
    ]
    checked = 0
    for name, outgoing, incoming, ctx in cases:
        if outgoing is None or incoming is None:
            continue
        candidates = _menu(outgoing, incoming, ctx)
        items = build_refinement_input(
            outgoing, incoming, candidates, policy=POLICY, context=ctx
        )["candidates"]
        for index, item in enumerate(items):
            for value in ("keep", "none", "balanced"):
                outcome = apply_refinement(
                    candidates,
                    Choice(candidate_index=index, bass_handoff=value),
                    (outgoing, incoming),
                    POLICY,
                    context=ctx,
                )
                refused = outcome.code == "bass_handoff_not_allowed"
                assert refused == (value not in item["bassOk"]), (name, index, value)
                checked += 1
    assert checked > 50
