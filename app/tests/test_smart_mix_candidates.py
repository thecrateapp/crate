from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from crate.smart_mix.candidates import plan_transition_candidates
from crate.smart_mix.evaluation import (
    music_left_out,
    phrase_alignment,
    policy_violations,
)
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
    # Revision 2 added the stems layer (Smart Mix Stems, ST3); revision 3 keeps it to
    # the beatmatch family with voice from either detector (STEM-G1); revision 4 lets
    # the machine-drum industrial family in; revision 5 serves it to Crate Decks only;
    # revision 6 serves every other source within Listen's caps (LV-G1).
    assert PLANNER_POLICY_V3.rules_revision == 6
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
    assert all(0.0 <= score <= 1.0 for score in scores)
    # The ranking itself, before Listen's caps reorder it (LV-D9).
    ranked = _candidates(outgoing, incoming, ctx, _uncapped())
    structured = [candidate for candidate in ranked if candidate.structure_used]
    assert [candidate.score for candidate in structured] == sorted(
        (candidate.score for candidate in structured), reverse=True
    )
    assert {c.to_plan() for c in candidates} <= {c.to_plan() for c in ranked} | {
        _v2(outgoing, incoming, ctx, PLANNER_POLICY_V3)
    }


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


# --- Listen's caps (LV-D9, LV-G1: 10 s of intro, 20 s of outro) ---------------


def _uncapped() -> object:
    return replace(
        PLANNER_POLICY_V3,
        listen_max_skipped_intro_ms=None,
        listen_max_unplayed_outro_ms=None,
    )


def _within_caps(
    candidate: TransitionCandidate,
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    intro_ms: int = 10_000,
    outro_ms: int = 20_000,
) -> bool:
    left_out = music_left_out(candidate.to_plan(), outgoing, incoming)
    assert left_out is not None
    return (
        left_out.incoming_skipped_ms <= intro_ms
        and left_out.outgoing_unplayed_ms <= outro_ms
    )


def test_v3_policy_carries_listen_caps_and_v2_none() -> None:
    assert PLANNER_POLICY_V3.listen_max_skipped_intro_ms == 10_000
    assert PLANNER_POLICY_V3.listen_max_unplayed_outro_ms == 20_000
    assert PLANNER_POLICY_V3.listen_cap_exempt_sources == ("decks",)
    assert PLANNER_POLICY.listen_max_skipped_intro_ms is None
    assert PLANNER_POLICY.listen_max_unplayed_outro_ms is None
    # The caps change v3's served plans, so they come with a new rules revision.
    assert PLANNER_POLICY_V3.rules_revision == 6


# An outgoing track whose last phrases are a short break and a short outro: v3's first
# choice mixes at the outro and cuts 9.4 s; its menu also mixes at the very end.
SHORT_OUTRO_LAYOUT: tuple[tuple[str, int, float], ...] = (
    ("intro", 16, 0.45),
    ("build", 8, 0.6),
    ("peak", 32, 0.8),
    ("break", 8, 0.5),
    ("outro", 8, 0.5),
)


@pytest.mark.parametrize(
    "source", ["playlist", "radio", "shuffle", "manual", "infinite"]
)
def test_listen_caps_serve_the_best_candidate_within_them(source) -> None:
    outgoing = profile(OUTGOING_UID, layout=SHORT_OUTRO_LAYOUT)
    incoming = profile(INCOMING_UID, layout=INCOMING_LAYOUT)
    ctx = replace(context(**LISTEN), source=source)
    # Caps tighter than LV-G1's, so that v3's own first choice breaks them.
    policy = replace(
        PLANNER_POLICY_V3,
        listen_max_skipped_intro_ms=10_000,
        listen_max_unplayed_outro_ms=5_000,
    )
    uncapped = _candidates(outgoing, incoming, ctx, _uncapped())
    assert not _within_caps(uncapped[0], outgoing, incoming, 10_000, 5_000)
    within = [c for c in uncapped if _within_caps(c, outgoing, incoming, 10_000, 5_000)]
    assert within

    capped = _candidates(outgoing, incoming, ctx, policy)

    assert [c.index for c in capped] == list(range(len(capped)))
    assert len(capped) <= PLANNER_POLICY_V3.max_candidates
    # The candidates within both caps first, in their rank order, then the rest.
    assert [c.to_plan() for c in capped[: len(within)]] == [c.to_plan() for c in within]
    assert {c.to_plan() for c in capped} == {c.to_plan() for c in uncapped}
    assert (
        plan_transition_v3(
            outgoing,
            incoming,
            ctx,
            outgoing_track_entity_uid=OUTGOING_UID,
            incoming_track_entity_uid=INCOMING_UID,
            policy=policy,
        ).plan
        == within[0].to_plan()
    )
    # Crate Decks keeps v3's own order.
    decks = _candidates(outgoing, incoming, replace(ctx, source="decks"), policy)
    assert [c.to_plan() for c in decks] == [c.to_plan() for c in uncapped]


def test_listen_caps_fall_back_to_v2s_plan() -> None:
    outgoing = profile(OUTGOING_UID, layout=OUTGOING_LAYOUT)
    incoming = profile(INCOMING_UID, layout=INCOMING_LAYOUT)
    ctx = context(**LISTEN)
    # Caps no plan keeps: the served plan is v2's own, even beyond the caps.
    strict = replace(
        PLANNER_POLICY_V3,
        listen_max_skipped_intro_ms=-1,
        listen_max_unplayed_outro_ms=-1,
    )
    uncapped = _candidates(outgoing, incoming, ctx, _uncapped())

    capped = _candidates(outgoing, incoming, ctx, strict)

    v2_plan = plan_transition(
        outgoing,
        incoming,
        ctx,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
        policy=strict,
    )
    assert capped[0].to_plan() == v2_plan
    assert [c.index for c in capped] == list(range(len(capped)))
    # The rest keep their rank order after it.
    rest = [c.to_plan() for c in uncapped if c.to_plan() != v2_plan]
    assert [c.to_plan() for c in capped[1:]] == rest[: len(capped) - 1]


def test_v2_ignores_the_listen_caps() -> None:
    plans = {
        name: _v2(outgoing, incoming, ctx).to_dict()
        for name, outgoing, incoming, ctx in CASES
    }

    assert plans == GOLDEN_V2
    assert PLANNER_POLICY.listen_max_skipped_intro_ms is None
