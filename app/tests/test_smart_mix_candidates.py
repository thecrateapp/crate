from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from crate.smart_mix.candidates import plan_transition_candidates
from crate.smart_mix.evaluation import phrase_alignment, policy_violations
from crate.smart_mix.evaluation import vocal_clash_ms
from crate.smart_mix.models import (
    TrackMixProfile,
    TransitionCandidate,
    TransitionContext,
    TransitionMode,
    TransitionPlan,
)
from crate.smart_mix.planner import plan_transition, plan_transition_v3
from crate.smart_mix.policy import PLANNER_POLICY, PLANNER_POLICY_V3

from tests.smart_mix_candidate_cases import (
    INCOMING_LAYOUT,
    INCOMING_UID,
    LISTEN,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
    context,
    edge_cases,
    profile,
)

GOLDEN_V2 = json.loads(
    (
        Path(__file__).resolve().parent
        / "fixtures/smart_mix/transition_plans_v2_sm2.json"
    ).read_text()
)["cases"]
CASES = edge_cases()


def _candidates(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    ctx: TransitionContext,
    policy=PLANNER_POLICY_V3,
) -> list[TransitionCandidate]:
    return plan_transition_candidates(
        outgoing,
        incoming,
        ctx,
        policy,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
    )


def _v2(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    ctx: TransitionContext,
    policy=PLANNER_POLICY,
) -> TransitionPlan:
    return plan_transition(
        outgoing,
        incoming,
        ctx,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
        policy=policy,
    )


def test_v3_policy_copies_the_v2_safety_limits() -> None:
    assert PLANNER_POLICY_V3.identifier == "smart-mix-v3"
    # Revision 2 is the stems layer (Smart Mix Stems, ST3).
    assert PLANNER_POLICY_V3.rules_revision == 2
    assert PLANNER_POLICY_V3.phrase_lengths == (8, 16, 32)
    assert PLANNER_POLICY_V3.max_candidates == 8
    for name in (
        "maximum_tempo_adjustment",
        "hard_maximum_tempo_adjustment",
        "max_loudness_adjustment_db",
        "maximum_unaccredited_gain_db",
        "combined_true_peak_ceiling_dbfs",
        "minimum_transition_ms",
        "maximum_transition_ms",
        "maximum_long_beatmatch_ms",
        "minimum_long_beatmatch_stability",
        "minimum_bpm_confidence",
        "minimum_tempo_stability",
    ):
        assert getattr(PLANNER_POLICY_V3, name) == getattr(PLANNER_POLICY, name), name


@pytest.mark.parametrize(
    ("outgoing", "incoming", "ctx"),
    [case[1:] for case in CASES],
    ids=[case[0] for case in CASES],
)
def test_all_candidates_pass_policy(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    ctx: TransitionContext,
) -> None:
    candidates = _candidates(outgoing, incoming, ctx)

    assert candidates
    assert [candidate.index for candidate in candidates] == list(range(len(candidates)))
    if ctx.source == "album" or not ctx.automatic:
        # A gapless album or a manual skip has no menu: v2's plan, as it is.
        assert [c.to_plan() for c in candidates] == [
            _v2(outgoing, incoming, ctx, PLANNER_POLICY_V3)
        ]
        return
    for candidate in candidates:
        plan = candidate.to_plan()
        assert isinstance(plan, TransitionPlan)
        assert (
            policy_violations(
                plan, outgoing, incoming, context=ctx, policy=PLANNER_POLICY_V3
            )
            == ()
        )
    scores = [candidate.score for candidate in candidates]
    structured = [candidate for candidate in candidates if candidate.structure_used]
    assert [candidate.score for candidate in structured] == sorted(
        (candidate.score for candidate in structured), reverse=True
    )
    assert all(0.0 <= score <= 1.0 for score in scores)


def test_at_most_eight_candidates() -> None:
    many = (
        (("intro", 8, 0.4),)
        + tuple(("body", 8, 0.5 + 0.01 * index) for index in range(28))
        + (("outro", 8, 0.4),)
    )
    long_out = profile(OUTGOING_UID, layout=many, duration_ms=470_000)
    long_in = profile(INCOMING_UID, layout=many, duration_ms=470_000)

    candidates = _candidates(long_out, long_in, context())
    listen = _candidates(long_out, long_in, context(**LISTEN))

    assert 4 <= len(candidates) <= PLANNER_POLICY_V3.max_candidates == 8
    assert len(listen) <= 8
    plans = [json.dumps(c.to_plan().to_dict(), sort_keys=True) for c in candidates]
    assert len(set(plans)) == len(plans)


def test_falls_back_to_bar_heuristic_without_structure() -> None:
    plain_out = profile(OUTGOING_UID)
    plain_in = profile(INCOMING_UID)
    structured_in = profile(INCOMING_UID, layout=INCOMING_LAYOUT)
    empty_in = replace(structured_in, phrases=(), structure_confidence=0.0)

    for outgoing, incoming in (
        (plain_out, plain_in),
        (plain_out, structured_in),
        (profile(OUTGOING_UID, layout=OUTGOING_LAYOUT), empty_in),
    ):
        for ctx in (context(), context(**LISTEN)):
            candidates = _candidates(outgoing, incoming, ctx)
            planned = plan_transition_v3(
                outgoing,
                incoming,
                ctx,
                outgoing_track_entity_uid=OUTGOING_UID,
                incoming_track_entity_uid=INCOMING_UID,
            )
            v2_plan = _v2(outgoing, incoming, ctx, PLANNER_POLICY_V3)

            assert candidates[0].to_plan() == v2_plan
            assert planned.plan == v2_plan
            assert planned.structure_used is False
            assert all(not candidate.structure_used for candidate in candidates)
            assert all(
                candidate.outgoing_phrase is None and candidate.incoming_phrase is None
                for candidate in candidates
            )
            assert planned.candidates == tuple(candidates)


def test_best_candidate_prefers_phrase_aligned() -> None:
    # The detected outro cue sits half a phrase into the outro: v2 mixes from there.
    outgoing = profile(OUTGOING_UID, layout=OUTGOING_LAYOUT, outro_cue_ms=215_520)
    incoming = profile(INCOMING_UID, layout=INCOMING_LAYOUT, intro_cue_ms=8_160)
    ctx = context()

    planned = plan_transition_v3(
        outgoing,
        incoming,
        ctx,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
    )
    best = planned.candidates[0]
    v2_alignment = phrase_alignment(_v2(outgoing, incoming, ctx), outgoing, incoming)
    v3_alignment = phrase_alignment(planned.plan, outgoing, incoming)

    assert planned.structure_used is True
    assert best.structure_used
    assert planned.plan == best.to_plan()
    assert v2_alignment is not None and v3_alignment is not None
    assert v3_alignment.fully_aligned
    assert v3_alignment.aligned > v2_alignment.aligned
    assert best.breakdown.alignment == max(
        candidate.breakdown.alignment for candidate in planned.candidates
    )
    # Mixing the outro over the intro, 16 bars: both ends on phrase boundaries.
    assert best.outgoing_phrase == len(OUTGOING_LAYOUT) - 1
    assert best.incoming_phrase == 0
    assert best.length_bars == 16
    assert best.mode is TransitionMode.BEATMATCH
    assert best.bass_handoff == "balanced"


def test_vocal_overlap_penalised_only_with_voice_on_both_sides() -> None:
    # Voice on the outgoing outro and on the incoming intro; the incoming build is
    # instrumental.
    out_voice = (20, 40, 160, 30, 170, 150)
    in_voice = (140, 20, 30, 30, 160, 10)
    voiced_out = profile(OUTGOING_UID, layout=OUTGOING_LAYOUT, vocals=out_voice)
    voiced_in = profile(INCOMING_UID, layout=INCOMING_LAYOUT, vocals=in_voice)
    silent_in = profile(INCOMING_UID, layout=INCOMING_LAYOUT)
    ctx = context()

    whole_menu = replace(PLANNER_POLICY_V3, max_candidates=1_000)

    both = _candidates(voiced_out, voiced_in, ctx, whole_menu)
    one_side = _candidates(voiced_out, silent_in, ctx, whole_menu)
    neither = _candidates(
        profile(OUTGOING_UID, layout=OUTGOING_LAYOUT), silent_in, ctx, whole_menu
    )

    assert all(candidate.breakdown.vocal is None for candidate in one_side)
    assert all(candidate.breakdown.vocal is None for candidate in neither)
    assert [(c.to_plan(), c.score) for c in one_side] == [
        (c.to_plan(), c.score) for c in neither
    ]
    assert any((candidate.breakdown.vocal or 0.0) > 0.0 for candidate in both)
    best_ignoring_voice = neither[0].to_plan()
    clash_ignoring_voice = vocal_clash_ms(best_ignoring_voice, voiced_out, voiced_in)
    clash_with_voice = vocal_clash_ms(both[0].to_plan(), voiced_out, voiced_in)
    assert clash_ignoring_voice is not None and clash_with_voice is not None
    assert clash_ignoring_voice > 0
    assert clash_with_voice < clash_ignoring_voice
    for candidate in both:
        penalty = PLANNER_POLICY_V3.candidate_weights.vocal * (
            candidate.breakdown.vocal or 0.0
        )
        assert candidate.score == pytest.approx(
            max(
                0.0,
                candidate.breakdown.weighted_sum(PLANNER_POLICY_V3.candidate_weights)
                - penalty,
            ),
            abs=1e-5,
        )


def test_v2_planner_unchanged() -> None:
    plans = {
        name: _v2(outgoing, incoming, ctx).to_dict()
        for name, outgoing, incoming, ctx in CASES
    }

    assert plans == GOLDEN_V2


def test_candidates_deterministic() -> None:
    for _name, outgoing, incoming, ctx in CASES:
        first = _candidates(outgoing, incoming, ctx)
        second = _candidates(outgoing, incoming, ctx)

        assert first == second
        assert [c.to_dict() for c in first] == [c.to_dict() for c in second]
    # The beat grid is not part of the plan read: it must not change a candidate.
    outgoing = profile(OUTGOING_UID, layout=OUTGOING_LAYOUT)
    incoming = profile(INCOMING_UID, layout=INCOMING_LAYOUT)
    with_grid = replace(
        outgoing,
        beat_grid_format="delta-ms-v1",
        beat_grid_ms=tuple(480 + 480 * beat for beat in range(480)),
    )
    assert _candidates(with_grid, incoming, context()) == _candidates(
        outgoing, incoming, context()
    )
