"""The stems layer in the smart-mix-v3 candidate score (Smart Mix Stems, ST3.PR1).

The stem terms apply only when both profiles carry a stems layer (STEM-D5), since
STEM-G1 (rules revision 3) only on edges of the beatmatch family (both tracks' gate
priors known and at least ``stems_layer_min_genre_prior``), and since rules revision 5
only for Crate Decks (``context.source == "decks"``). Elsewhere the menu is the menu of
revision 1, recorded in
``fixtures/smart_mix/candidates_v3_rules1.json`` before the stems layer existed. A
phrase has voice when the vocal stem or YAMNet's stored byte says so.

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

from crate.smart_mix.candidates import (
    plan_transition_candidates,
    stems_gate_prior,
    stems_layer_applies,
)
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

FIXTURES = Path(__file__).resolve().parent / "fixtures/smart_mix"
GOLDEN = json.loads((FIXTURES / "candidates_v3_rules1.json").read_text())
GOLDEN_RULES5 = FIXTURES / "candidates_v3_rules5.json"
# Rules revision 6 (LV-G1): every source but Crate Decks gets revision 1's menu
# reordered within Listen's caps, recorded once from the tested code.
GOLDEN_LISTEN_CAPS = FIXTURES / "candidates_v3_listen_caps.json"
# Revision 1's ranking, before Listen's caps reorder it: what the stems tests compare.
UNCAPPED = replace(
    PLANNER_POLICY_V3,
    listen_max_skipped_intro_ms=None,
    listen_max_unplayed_outro_ms=None,
)
# Genre beatmatch priors (crate.smart_mix.transition_fit): house and techno are 0.95,
# rock 0.15. The layer needs both tracks in the beatmatch family.
IN_FAMILY = (0.95, 0.95)
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


def decks(**overrides) -> TransitionContext:
    """The DJ context as Crate Decks sends it: the only source the stems layer serves."""
    return context(source="decks", **overrides)


def _as_decks(ctx: TransitionContext) -> TransitionContext:
    # Decks plans like a playlist (until S5); the album and manual cases keep theirs.
    return replace(ctx, source="decks") if ctx.source == "playlist" else ctx


def _menu(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    ctx: TransitionContext,
    policy=PLANNER_POLICY_V3,
    priors: tuple[float | None, float | None] = IN_FAMILY,
) -> list[TransitionCandidate]:
    return plan_transition_candidates(
        outgoing,
        incoming,
        ctx,
        policy,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
        outgoing_genre_prior=priors[0],
        incoming_genre_prior=priors[1],
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


def _patterned(track: TrackMixProfile) -> TrackMixProfile:
    """A fixed layer for any track with phrases: vocals on odd phrases, bass from the
    second phrase on, drums everywhere but the first."""
    assert track.phrases is not None
    count = len(track.phrases)
    return _with_stems(
        track,
        vocals={index for index in range(count) if index % 2},
        bass=set(range(1, count)),
        drums=set(range(1, count)),
    )


def _phrased_golden_cases():
    return [
        case
        for case in _golden_cases()
        if case[1] is not None
        and case[1].phrases
        and case[2] is not None
        and case[2].phrases
    ]


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


def test_rules_revision_5_gates_the_stems_layer_by_client_and_mix_type() -> None:
    # Revision 3 gated the layer by genre and took voice from either detector;
    # revision 4 let the machine-drum industrial family in; revision 5 serves it to
    # Crate Decks only (STEM-G1); revision 6 adds Listen's caps for every other source.
    assert PLANNER_POLICY_V3.rules_revision == 6
    assert PLANNER_POLICY_V3.stems_layer_sources == ("decks",)
    assert PLANNER_POLICY_V3.stems_layer is True
    assert PLANNER_POLICY_V3.stems_layer_min_genre_prior == 0.5
    assert GOLDEN["rulesRevision"] == 1


@pytest.mark.parametrize(
    "case", _golden_cases(), ids=[case[0] for case in _golden_cases()]
)
def test_identical_candidates_and_scores_without_stems(case) -> None:
    name, outgoing, incoming, ctx = case

    menu = _menu(outgoing, incoming, ctx, UNCAPPED)

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

    menu = _menu(with_outgoing_stems, incoming, ctx, UNCAPPED)

    assert [candidate.to_dict() for candidate in menu] == GOLDEN["cases"][name]


def test_no_stem_terms_when_the_policy_turns_the_layer_off() -> None:
    outgoing, incoming = _pair()
    voiced_out = _with_stems(outgoing, vocals={OUTRO}, bass={OUTRO})
    voiced_in = _with_stems(incoming, vocals={INTRO}, bass={INTRO})
    off = replace(PLANNER_POLICY_V3, stems_layer=False)

    assert _menu(voiced_out, voiced_in, decks(), off) == _menu(
        outgoing, incoming, decks(), off
    )


# --- vocals -----------------------------------------------------------------------


def test_prefers_an_overlap_where_the_stem_vocals_do_not_collide() -> None:
    # YAMNet hears no voice on the incoming intro or build; the vocal stem hears it on
    # the intro, as in genres where YAMNet misses voice (SG1b).
    yamnet_out = (20, 160, 20, 160, 170)
    yamnet_in = (20, 20, 160, 20, 160, 10)
    outgoing, incoming = _pair(out_vocals=yamnet_out, in_vocals=yamnet_in)
    ctx = decks()

    without = _menu(outgoing, incoming, ctx)
    stems_out = _with_stems(outgoing, vocals={1, 3, OUTRO})
    stems_in = _with_stems(incoming, vocals={INTRO, 2, 4})
    planned = plan_transition_v3(
        stems_out,
        stems_in,
        ctx,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
        outgoing_genre_prior=IN_FAMILY[0],
        incoming_genre_prior=IN_FAMILY[1],
    )
    with_stems = list(planned.candidates)
    # The same edge from Listen or Android: no stems layer.
    listen = plan_transition_v3(
        stems_out,
        stems_in,
        context(),
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
        outgoing_genre_prior=IN_FAMILY[0],
        incoming_genre_prior=IN_FAMILY[1],
    )
    assert listen.stems_used is False
    assert list(listen.candidates) == _menu(outgoing, incoming, context())

    assert _picked(without) == (OUTRO, INTRO, 8)
    assert _picked(with_stems) == (OUTRO, BUILD, 8)
    assert planned.stems_used is True
    assert all(candidate.stems_used for candidate in with_stems)
    best = with_stems[0]
    assert best.breakdown.stems is not None
    assert best.breakdown.stems.vocal_overlap_ms == 0
    assert stem_vocal_clash_ms(best.to_plan(), stems_out, stems_in) == 0
    assert stem_vocal_clash_ms(without[0].to_plan(), stems_out, stems_in) > 0


def test_yamnet_voice_still_counts_where_the_stem_misses_it() -> None:
    # Rules revision 3 (STEM-G1): a phrase has voice when either detector says so.
    # The vocal stem hears none on the incoming intro, YAMNet does: the intro still
    # collides with the voiced outro, so the build wins.
    yamnet_out = (20, 20, 20, 20, 170)
    yamnet_in = (170, 20, 20, 20, 20, 10)
    outgoing, incoming = _pair(out_vocals=yamnet_out, in_vocals=yamnet_in)
    stems_out = _with_stems(outgoing, vocals={OUTRO})
    stems_in = _with_stems(incoming)

    menu = _menu(
        stems_out, stems_in, decks(), replace(PLANNER_POLICY_V3, max_candidates=1_000)
    )

    assert _picked(menu) == (OUTRO, BUILD, 8)
    into_intro = next(
        candidate
        for candidate in menu
        if (candidate.outgoing_phrase, candidate.incoming_phrase, candidate.length_bars)
        == (OUTRO, INTRO, 8)
    )
    assert into_intro.breakdown.stems is not None
    assert into_intro.breakdown.stems.vocal_overlap_ms > 0
    assert into_intro.breakdown.stems.vocal_free_exit == 0.0


def test_without_yamnet_bytes_the_stem_alone_says_where_voice_is() -> None:
    outgoing, incoming = _pair()
    stems_out = _with_stems(outgoing, vocals={OUTRO})
    stems_in = _with_stems(incoming)

    best = _menu(stems_out, stems_in, decks())[0]

    assert _picked([best]) == (OUTRO, INTRO, 8)
    assert best.breakdown.stems is not None
    assert best.breakdown.stems.vocal_overlap_ms == 0


# --- the mix-type gate (STEM-G1) -----------------------------------------------------


@pytest.mark.parametrize(
    ("outgoing", "incoming", "applies"),
    [
        (0.95, 0.95, True),
        (0.5, 0.95, True),
        (0.95, 0.4999, False),
        (0.15, 0.95, False),
        (0.95, None, False),
        (None, None, False),
    ],
)
def test_the_layer_applies_only_to_the_beatmatch_family(
    outgoing, incoming, applies
) -> None:
    assert (
        stems_layer_applies(PLANNER_POLICY_V3, outgoing, incoming, source="decks")
        is applies
    )
    off = replace(PLANNER_POLICY_V3, stems_layer=False)
    assert stems_layer_applies(off, outgoing, incoming, source="decks") is False


@pytest.mark.parametrize(
    "source", ["playlist", "radio", "shuffle", "infinite", "album", "manual"]
)
def test_the_layer_applies_only_to_crate_decks(source) -> None:
    # Rules revision 5 (STEM-G1): Listen, Android and VirtualDJ never get stems.
    assert not stems_layer_applies(PLANNER_POLICY_V3, 0.95, 0.95, source=source)
    assert stems_layer_applies(PLANNER_POLICY_V3, 0.95, 0.95, source="decks")


@pytest.mark.parametrize(
    "priors", [(0.95, 0.15), (0.15, 0.15), (None, 0.95), (None, None)]
)
@pytest.mark.parametrize(
    "case", _phrased_golden_cases(), ids=[case[0] for case in _phrased_golden_cases()]
)
def test_outside_the_family_the_menu_is_revision_1s(case, priors) -> None:
    name, outgoing, incoming, ctx = case

    menu = _menu(
        _patterned(outgoing), _patterned(incoming), _as_decks(ctx), priors=priors
    )

    assert [candidate.to_dict() for candidate in menu] == GOLDEN["cases"][name]
    assert not any(candidate.stems_used for candidate in menu)


@pytest.mark.parametrize("source", ["playlist", "radio", "infinite"])
@pytest.mark.parametrize(
    "case", _phrased_golden_cases(), ids=[case[0] for case in _phrased_golden_cases()]
)
def test_other_clients_get_revision_1s_menu_in_the_family(case, source) -> None:
    # Revision 1's menu, within Listen's caps since revision 6.
    name, outgoing, incoming, ctx = case
    other = replace(ctx, source=source) if ctx.source == "playlist" else ctx
    golden = json.loads(GOLDEN_LISTEN_CAPS.read_text())

    menu = _menu(_patterned(outgoing), _patterned(incoming), other)

    assert [candidate.to_dict() for candidate in menu] == golden["cases"][name]
    uncapped = _menu(_patterned(outgoing), _patterned(incoming), other, UNCAPPED)
    assert [candidate.to_dict() for candidate in uncapped] == GOLDEN["cases"][name]
    assert not any(candidate.stems_used for candidate in menu)


def _rules5_menus() -> dict[str, list[dict]]:
    return {
        name: [
            candidate.to_dict()
            for candidate in _menu(
                _patterned(outgoing), _patterned(incoming), _as_decks(ctx)
            )
        ]
        for name, outgoing, incoming, ctx in _phrased_golden_cases()
    }


def test_rules_revision_5_menus_with_stems_match_their_golden() -> None:
    golden = json.loads(GOLDEN_RULES5.read_text())

    # Revision 6 changed no Crate Decks menu: its golden is still revision 5's.
    assert golden["rulesRevision"] == 5
    assert golden["priors"] == list(IN_FAMILY)
    assert golden["source"] == "decks"
    assert _rules5_menus() == golden["cases"]
    # Gapless albums and manual skips keep v2's single plan; every menu uses stems.
    menus = [menu for menu in golden["cases"].values() if len(menu) > 1]
    assert len(menus) == 8
    assert all(candidate.get("stemsUsed") for menu in menus for candidate in menu)


# --- bass ---------------------------------------------------------------------------


def test_avoids_two_basslines_when_another_candidate_exists() -> None:
    # No bass handoff (Listen, or a crossfade): both basses play through the blend
    # unless one of the phrases has none.
    outgoing, incoming = _pair()
    ctx = decks(allow_bass_handoff=False)
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
        stems_out, stems_in, decks(), replace(PLANNER_POLICY_V3, max_candidates=1_000)
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

    menu = _menu(stems_out, stems_in, decks())

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
            for candidate in _menu(stems_out, stems_in, decks(), whole_menu)
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

    plain = _menu(outgoing, incoming, decks())[0].to_dict()
    scored = _menu(stems_out, stems_in, decks())[0].to_dict()

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

    menu = _menu(stems_out, plain_in, decks())

    assert not any(candidate.stems_used for candidate in menu)


def test_a_stems_layer_needs_one_entry_per_phrase() -> None:
    outgoing, _incoming = _pair()
    layer = _layer(outgoing)

    with pytest.raises(ValueError, match="one entry per phrase"):
        replace(outgoing, stems=replace(layer, phrases=layer.phrases[:-1]))
    with pytest.raises(ValueError, match="one entry per phrase"):
        replace(profile(OUTGOING_UID), stems=layer)
    assert phrases(OUT_LAYOUT)


# --- the machine-drum industrial family (STEM-G1, rules revision 4) -------------------

# Artist and album genres as the development library has them (weights as stored).
GENRES = {
    "Godflesh": (
        "industrial metal=1;industrial=0.88;experimental=0.76;doom metal=0.64;metal=0.52",
        "industrial metal=0.2632;industrial=0.2316;experimental=0.2;doom metal=0.1684;"
        "metal=0.1368",
    ),
    "Fear Factory": (
        "industrial metal=1;death metal=0.88;metal=0.76;industrial=0.64;thrash metal=0.52",
        "death metal=0.5;industrial metal=0.5",
    ),
    "Ministry": (
        "industrial metal=1;industrial=0.88;industrial rock=0.76;metal=0.64;"
        "electronic=0.52",
        "industrial metal=0.2632;industrial=0.2316;industrial rock=0.2;metal=0.1684;"
        "electronic=0.1368",
    ),
    "Author & Punisher": (
        "industrial=1;drone=0.88;noise=0.76;experimental=0.64;doom metal=0.52",
        "",
    ),
    "Front 242": (
        "ebm=1;industrial=0.88;electronic=0.76;electro=0.64;electronica=0.52",
        "",
    ),
    "Nitzer Ebb": (
        "ebm=1;industrial=0.88;electronic=0.76;old school ebm=0.64;electro=0.52",
        "ebm=0.2632;industrial=0.2316;electronic=0.2;old school ebm=0.1684;electro=0.1368",
    ),
    "Darkthrone": (
        "black metal=1;norwegian black metal=0.88;death metal=0.76;norwegian=0.64;"
        "metal=0.52",
        "black metal=0.2632;norwegian black metal=0.2316;death metal=0.2;metal=0.1368",
    ),
    "Cannibal Corpse": (
        "death metal=1;brutal death metal=0.88;grindcore=0.76;metal=0.64;american=0.52",
        "brutal death metal=0.5;death metal=0.5",
    ),
    "Slayer": (
        "thrash metal=1;metal=0.88;speed metal=0.76;heavy metal=0.64;thrash=0.52",
        "metal=0.5;thrash metal=0.5",
    ),
    "Pig Destroyer": (
        "grindcore=1;death metal=0.88;grind=0.76;hardcore=0.64;metal=0.52",
        "death metal=1;grindcore=1",
    ),
    "Electric Wizard": (
        "doom metal=1;stoner metal=0.88;sludge=0.76;stoner doom=0.64;stoner rock=0.52",
        "",
    ),
    "Black Flag": (
        "hardcore punk=1;punk=0.88;hardcore=0.76;punk rock=0.64;rock=0.52",
        "hardcore punk=0.5;post-hardcore=0.5",
    ),
    "Minor Threat": (
        "hardcore punk=1;hardcore=0.88;straight edge=0.76;punk=0.64;punk rock=0.52",
        "hardcore punk=0.5;straight edge=0.5",
    ),
    "Discharge": ("d-beat=1;hardcore punk=0.88;punk=0.76;crust=0.64;hardcore=0.52", ""),
    "Converge": (
        "hardcore=1;mathcore=0.88;metalcore=0.76;chaotic hardcore=0.64;noisecore=0.52",
        "mathcore=0.5;metalcore=0.5",
    ),
    "The Clash": (
        "punk=1;punk rock=0.88;british=0.76;rock=0.64;classic rock=0.52",
        "new wave=1;post-punk=1",
    ),
}
MACHINE_DRUMS = (
    "Godflesh",
    "Fear Factory",
    "Ministry",
    "Author & Punisher",
    "Front 242",
    "Nitzer Ebb",
)
LIVE_DRUMS = tuple(name for name in GENRES if name not in MACHINE_DRUMS)


def _genres(text: str) -> dict[str, float]:
    result = {}
    for item in filter(None, text.split(";")):
        name, _, weight = item.rpartition("=")
        result[name] = float(weight)
    return result


def _gate_prior(name: str) -> float | None:
    artist, album = GENRES[name]
    return stems_gate_prior(_genres(album), _genres(artist))


@pytest.mark.parametrize("name", MACHINE_DRUMS)
def test_machine_drum_industrial_is_in_the_beatmatch_family(name) -> None:
    prior = _gate_prior(name)

    assert prior is not None
    assert prior >= PLANNER_POLICY_V3.stems_layer_min_genre_prior


@pytest.mark.parametrize("name", LIVE_DRUMS)
def test_live_drum_metal_punk_and_rock_stay_out(name) -> None:
    prior = _gate_prior(name)

    assert prior is None or prior < PLANNER_POLICY_V3.stems_layer_min_genre_prior


def test_other_tracks_keep_their_album_genres_prior() -> None:
    assert stems_gate_prior({"techno": 1.0}, {}) == 0.95
    assert stems_gate_prior({"house": 0.5, "rock": 0.5}, {"house": 1.0}) == 0.55
    # Without album genres a track outside the family stays unknown.
    assert stems_gate_prior({}, {"techno": 1.0}) is None
    assert stems_gate_prior({}, {}) is None
    # Only the top genre counts: an industrial side tag does not let a track in.
    assert stems_gate_prior({"metal": 0.8, "industrial metal": 0.2}, {}) == 0.1
    assert stems_gate_prior({"industrial": 1.0}, {}) == 1.0
    assert stems_gate_prior({"electro-industrial": 1.0}, {}) == 1.0


def test_a_pair_needs_both_tracks_in_the_family() -> None:
    def applies(left: str, right: str) -> bool:
        return stems_layer_applies(
            PLANNER_POLICY_V3, _gate_prior(left), _gate_prior(right), source="decks"
        )

    assert applies("Godflesh", "Ministry")
    assert applies("Author & Punisher", "Fear Factory")
    assert applies("Front 242", "Godflesh")
    assert not applies("Godflesh", "Darkthrone")
    assert not applies("Black Flag", "Ministry")


def test_decks_menus_ignore_the_listen_caps() -> None:
    # Rules revision 6 caps the music v3 leaves out for every source but Crate
    # Decks (LV-D9); Decks' menus stay revision 5's, byte for byte.
    golden = json.loads(GOLDEN_RULES5.read_text())

    assert PLANNER_POLICY_V3.listen_max_skipped_intro_ms == 10_000
    assert PLANNER_POLICY_V3.listen_max_unplayed_outro_ms == 20_000
    assert "decks" in PLANNER_POLICY_V3.listen_cap_exempt_sources
    assert golden["rulesRevision"] == 5
    assert _rules5_menus() == golden["cases"]


def _listen_caps_menus() -> dict[str, list[dict]]:
    return {
        name: [candidate.to_dict() for candidate in _menu(outgoing, incoming, ctx)]
        for name, outgoing, incoming, ctx in _golden_cases()
    }


def test_listen_caps_golden() -> None:
    # Generated once from the tested code (rules revision 6); never regenerated after
    # a change.
    golden = json.loads(GOLDEN_LISTEN_CAPS.read_text())

    assert golden["rulesRevision"] == PLANNER_POLICY_V3.rules_revision
    assert golden["caps"] == {
        "maxSkippedIntroMs": PLANNER_POLICY_V3.listen_max_skipped_intro_ms,
        "maxUnplayedOutroMs": PLANNER_POLICY_V3.listen_max_unplayed_outro_ms,
    }
    assert _listen_caps_menus() == golden["cases"]
    # The caps changed some of revision 1's Listen menus; album and manual kept v2's.
    changed = [
        name
        for name in golden["cases"]
        if golden["cases"][name] != GOLDEN["cases"][name]
    ]
    assert changed
    assert golden["cases"]["album_gapless"] == GOLDEN["cases"]["album_gapless"]
