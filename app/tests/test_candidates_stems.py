"""The stems layer in the smart-mix-v3 candidate score (Smart Mix Stems, ST3.PR1).

The stem terms apply only when both profiles carry a stems layer (STEM-D5). Without
it, the menu of rules revision 2 is the menu of revision 1, recorded in
``fixtures/smart_mix/candidates_v3_rules1.json`` before the stems layer existed.

The edges below make two candidates tie without stems: an 8-bar blend from the
outgoing outro into the incoming intro, or into the build that follows it. Both are
aligned on every boundary, hand off between phrases of the same energy and leave no
music out, so v3 keeps the earlier incoming phrase. The stems layer is what tells them
apart.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from crate.smart_mix.candidates import plan_transition_candidates
from crate.smart_mix.evaluation import stem_bass_clash_ms, stem_vocal_clash_ms
from crate.smart_mix.models import (
    StemPhraseLevels,
    StemsLayer,
    TrackMixProfile,
    TransitionCandidate,
    TransitionContext,
)
from crate.smart_mix.planner import plan_transition_v3
from crate.smart_mix.policy import PLANNER_POLICY_V3
from crate.smart_mix.stems import STEM_VOCAL_DETECTOR

from tests.smart_mix_candidate_cases import (
    INCOMING_UID,
    LISTEN,
    OUTGOING_UID,
    context,
    edge_cases,
    phrases,
    profile,
)

GOLDEN = json.loads(
    (
        Path(__file__).resolve().parent / "fixtures/smart_mix/candidates_v3_rules1.json"
    ).read_text()
)
# The two extra edges of the golden file, next to edge_cases().
EXTRA_LAYOUTS = {
    "voiced_listen": (
        (20, 40, 160, 30, 170, 150),
        (140, 20, 180, 30, 160, 10),
        LISTEN,
    ),
    "structured_no_handoff": (None, None, {"allow_bass_handoff": False}),
}

OUT_LAYOUT = (
    ("intro", 16, 0.5),
    ("peak", 32, 0.8),
    ("break", 16, 0.5),
    ("peak", 32, 0.8),
    ("outro", 8, 0.5),
)
IN_LAYOUT = (
    ("intro", 8, 0.5),
    ("build", 8, 0.5),
    ("peak", 32, 0.8),
    ("break", 16, 0.5),
    ("peak", 32, 0.8),
    ("outro", 16, 0.45),
)
OUTRO = len(OUT_LAYOUT) - 1
INTRO, BUILD = 0, 1


def _golden_cases() -> list[tuple[str, object, object, TransitionContext]]:
    from tests.smart_mix_candidate_cases import (
        INCOMING_LAYOUT,
        OUTGOING_LAYOUT,
    )

    cases = list(edge_cases())
    for name, (out_voice, in_voice, ctx) in EXTRA_LAYOUTS.items():
        cases.append(
            (
                name,
                profile(OUTGOING_UID, layout=OUTGOING_LAYOUT, vocals=out_voice),
                profile(INCOMING_UID, layout=INCOMING_LAYOUT, vocals=in_voice),
                context(**ctx),
            )
        )
    return cases


def _menu(
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


def _layer(
    track: TrackMixProfile,
    *,
    vocals: set[int] = frozenset(),
    bass: set[int] = frozenset(),
    drums: set[int] = frozenset(),
) -> StemsLayer:
    """A stems layer on the track's phrases with presence where the sets say."""
    assert track.phrases is not None
    entries = []
    for index, phrase in enumerate(track.phrases):
        end = (
            track.phrases[index + 1].start_ms
            if index + 1 < len(track.phrases)
            else track.active_end_ms or track.duration_ms
        )
        entries.append(
            StemPhraseLevels(
                start_ms=phrase.start_ms,
                end_ms=end,
                drums=200 if index in drums else 20,
                bass=200 if index in bass else 20,
                other=150,
                vocals=200 if index in vocals else 20,
                vocal_present=index in vocals,
                bass_present=index in bass,
                drums_present=index in drums,
            )
        )
    return StemsLayer(
        producer="crate-server/stems-1",
        separator_model="htdemucs",
        separator_version="htdemucs-onnx-1",
        phrases=tuple(entries),
        vocal_detector=STEM_VOCAL_DETECTOR,
    )


def _with_stems(track: TrackMixProfile, **presence: set[int]) -> TrackMixProfile:
    return replace(track, stems=_layer(track, **presence))


def _pair(
    *,
    out_vocals: tuple[int, ...] | None = None,
    in_vocals: tuple[int, ...] | None = None,
) -> tuple[TrackMixProfile, TrackMixProfile]:
    """The two tracks of the tie, with YAMNet voice bytes when given."""
    return (
        profile(OUTGOING_UID, layout=OUT_LAYOUT, vocals=out_vocals),
        profile(INCOMING_UID, layout=IN_LAYOUT, vocals=in_vocals),
    )


def _picked(
    menu: list[TransitionCandidate],
) -> tuple[int | None, int | None, int | None]:
    best = menu[0]
    return best.outgoing_phrase, best.incoming_phrase, best.length_bars


# --- golden -----------------------------------------------------------------------


def test_rules_revision_2_is_the_stems_layer() -> None:
    assert PLANNER_POLICY_V3.rules_revision == 2
    assert PLANNER_POLICY_V3.stems_layer is True
    assert GOLDEN["rulesRevision"] == 1


@pytest.mark.parametrize(
    "case", _golden_cases(), ids=[case[0] for case in _golden_cases()]
)
def test_identical_candidates_and_scores_without_stems(case) -> None:
    name, outgoing, incoming, ctx = case

    menu = _menu(outgoing, incoming, ctx)

    assert [candidate.to_dict() for candidate in menu] == GOLDEN["cases"][name]
    assert not any(candidate.stems_used for candidate in menu)


@pytest.mark.parametrize(
    "case",
    [case for case in _golden_cases() if case[1] is not None and case[1].phrases],
    ids=[
        case[0] for case in _golden_cases() if case[1] is not None and case[1].phrases
    ],
)
def test_one_stems_layer_alone_changes_nothing(case) -> None:
    name, outgoing, incoming, ctx = case
    every = set(range(len(outgoing.phrases)))
    with_outgoing_stems = _with_stems(outgoing, vocals=every, bass=every, drums=every)

    menu = _menu(with_outgoing_stems, incoming, ctx)

    assert [candidate.to_dict() for candidate in menu] == GOLDEN["cases"][name]


def test_no_stem_terms_when_the_policy_turns_the_layer_off() -> None:
    outgoing, incoming = _pair()
    voiced_out = _with_stems(outgoing, vocals={OUTRO}, bass={OUTRO})
    voiced_in = _with_stems(incoming, vocals={INTRO}, bass={INTRO})
    off = replace(PLANNER_POLICY_V3, stems_layer=False)

    assert _menu(voiced_out, voiced_in, context(), off) == _menu(
        outgoing, incoming, context(), off
    )


# --- vocals -----------------------------------------------------------------------


def test_prefers_an_overlap_where_the_stem_vocals_do_not_collide() -> None:
    # YAMNet hears voice on the incoming build and none on its intro; the vocal stem
    # says the opposite, as in genres where YAMNet fails (SG1b).
    yamnet_out = (20, 160, 20, 160, 170)
    yamnet_in = (20, 170, 160, 20, 160, 10)
    outgoing, incoming = _pair(out_vocals=yamnet_out, in_vocals=yamnet_in)
    ctx = context()

    without = _menu(outgoing, incoming, ctx)
    stems_out = _with_stems(outgoing, vocals={1, 3, OUTRO})
    stems_in = _with_stems(incoming, vocals={INTRO, 2, 4})
    planned = plan_transition_v3(
        stems_out,
        stems_in,
        ctx,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
    )
    with_stems = list(planned.candidates)

    assert _picked(without) == (OUTRO, INTRO, 8)
    assert _picked(with_stems) == (OUTRO, BUILD, 8)
    assert planned.stems_used is True
    assert all(candidate.stems_used for candidate in with_stems)
    # The stem vocals replace YAMNet's in the penalty: none left on the plan picked.
    best = with_stems[0]
    assert best.breakdown.stems is not None
    assert best.breakdown.stems.vocal_overlap_ms == 0
    assert stem_vocal_clash_ms(best.to_plan(), stems_out, stems_in) == 0
    assert stem_vocal_clash_ms(without[0].to_plan(), stems_out, stems_in) > 0


# --- bass ---------------------------------------------------------------------------


def test_avoids_two_basslines_when_another_candidate_exists() -> None:
    # No bass handoff (Listen, or a crossfade): both basses play through the blend
    # unless one of the phrases has none.
    outgoing, incoming = _pair()
    ctx = context(allow_bass_handoff=False)
    stems_out = _with_stems(outgoing, bass={1, 2, 3, OUTRO})
    stems_in = _with_stems(incoming, bass={INTRO, 2, 3, 4, 5})

    without = _menu(outgoing, incoming, ctx)
    with_stems = _menu(stems_out, stems_in, ctx)

    assert _picked(without) == (OUTRO, INTRO, 8)
    assert _picked(with_stems) == (OUTRO, BUILD, 8)
    best = with_stems[0]
    assert best.breakdown.stems is not None
    assert best.breakdown.stems.bass_overlap_ms == 0
    assert stem_bass_clash_ms(best.to_plan(), stems_out, stems_in) == 0
    assert stem_bass_clash_ms(without[0].to_plan(), stems_out, stems_in) > 0
    # Into the intro the two basslines overlap: its bass component says so.
    into_intro = next(
        candidate
        for candidate in with_stems
        if (candidate.outgoing_phrase, candidate.incoming_phrase, candidate.length_bars)
        == (OUTRO, INTRO, 8)
    )
    assert into_intro.breakdown.stems is not None
    assert into_intro.breakdown.stems.bass_overlap_ms > 0
    assert into_intro.breakdown.bass < best.breakdown.bass


def test_the_bass_handoff_keeps_two_basslines_apart() -> None:
    outgoing, incoming = _pair()
    stems_out = _with_stems(outgoing, bass={1, 2, 3, OUTRO})
    stems_in = _with_stems(incoming, bass={INTRO, 2, 3, 4, 5})

    menu = _menu(
        stems_out, stems_in, context(), replace(PLANNER_POLICY_V3, max_candidates=1_000)
    )

    handoff = [c for c in menu if c.bass_handoff == "balanced"]
    plain = [
        c
        for c in menu
        if c.bass_handoff == "none"
        and (c.outgoing_phrase, c.incoming_phrase, c.length_bars, c.curve)
        in {
            (h.outgoing_phrase, h.incoming_phrase, h.length_bars, h.curve)
            for h in handoff
        }
    ]
    assert handoff and plain
    by_geometry = {
        (c.outgoing_phrase, c.incoming_phrase, c.length_bars, c.curve): c
        for c in handoff
    }
    for candidate in plain:
        twin = by_geometry[
            (
                candidate.outgoing_phrase,
                candidate.incoming_phrase,
                candidate.length_bars,
                candidate.curve,
            )
        ]
        assert (
            twin.breakdown.stems is not None and candidate.breakdown.stems is not None
        )
        assert (
            twin.breakdown.stems.bass_overlap_ms
            <= candidate.breakdown.stems.bass_overlap_ms
        )


# --- entries and exits ----------------------------------------------------------------


def test_prefers_a_drums_only_entry() -> None:
    outgoing, incoming = _pair()
    every_in = set(range(len(IN_LAYOUT)))
    # Drums on every incoming phrase; the intro also has bass and voice, the build
    # only drums.
    stems_out = _with_stems(outgoing, drums=set(range(len(OUT_LAYOUT))))
    stems_in = _with_stems(incoming, drums=every_in, bass={INTRO, 2, 4}, vocals={INTRO})

    menu = _menu(stems_out, stems_in, context())

    assert _picked(menu) == (OUTRO, BUILD, 8)
    assert menu[0].breakdown.stems is not None
    assert menu[0].breakdown.stems.drums_only_entry == 1.0


def test_prefers_a_vocal_free_exit() -> None:
    # The same blend out of an outro with voice and out of one without: the incoming
    # has none, so only the exit bonus tells them apart.
    outgoing, incoming = _pair()
    stems_in = _with_stems(incoming)
    whole_menu = replace(PLANNER_POLICY_V3, max_candidates=1_000)

    def outro_into_intro(stems_out: TrackMixProfile) -> TransitionCandidate:
        return next(
            candidate
            for candidate in _menu(stems_out, stems_in, context(), whole_menu)
            if (candidate.outgoing_phrase, candidate.incoming_phrase) == (OUTRO, INTRO)
            and candidate.length_bars == 8
            and candidate.bass_handoff == "balanced"
        )

    voiced = outro_into_intro(_with_stems(outgoing, vocals={OUTRO}))
    free = outro_into_intro(_with_stems(outgoing))

    assert voiced.breakdown.stems is not None and free.breakdown.stems is not None
    assert free.breakdown.stems.vocal_free_exit == 1.0
    assert voiced.breakdown.stems.vocal_free_exit == 0.0
    assert free.breakdown.stems.vocal_overlap_ms == 0
    assert voiced.breakdown.stems.vocal_overlap_ms == 0
    assert free.score > voiced.score


def test_breakdown_reports_the_stem_terms_only_with_stems() -> None:
    outgoing, incoming = _pair()
    stems_out = _with_stems(outgoing, vocals={OUTRO}, bass={OUTRO}, drums={OUTRO})
    stems_in = _with_stems(incoming, drums={INTRO})

    plain = _menu(outgoing, incoming, context())[0].to_dict()
    scored = _menu(stems_out, stems_in, context())[0].to_dict()

    assert "stems" not in plain["breakdown"]
    assert "stemsUsed" not in plain
    assert scored["stemsUsed"] is True
    assert set(scored["breakdown"]["stems"]) == {
        "vocalOverlapMs",
        "bassOverlapMs",
        "drumsOnlyEntry",
        "vocalFreeExit",
    }


def test_stems_need_phrases_on_both_tracks() -> None:
    outgoing, incoming = _pair()
    stems_out = _with_stems(outgoing, vocals={OUTRO})
    plain_in = profile(INCOMING_UID)

    menu = _menu(stems_out, plain_in, context())

    assert not any(candidate.stems_used for candidate in menu)


def test_a_stems_layer_needs_one_entry_per_phrase() -> None:
    outgoing, _incoming = _pair()
    layer = _layer(outgoing)

    with pytest.raises(ValueError, match="one entry per phrase"):
        replace(outgoing, stems=replace(layer, phrases=layer.phrases[:-1]))
    with pytest.raises(ValueError, match="one entry per phrase"):
        replace(profile(OUTGOING_UID), stems=layer)
    assert phrases(OUT_LAYOUT)
