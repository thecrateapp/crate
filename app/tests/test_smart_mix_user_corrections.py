"""A Crate Decks user's correction on top of a Smart Mix profile (F8.SM).

The profiles come from the candidate cases: 125 BPM, a beat every 480 ms and the
first downbeat at 480 ms, with phrases at bars 0, 16, 24, 56, 72 and 104.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from crate.smart_mix.models import StemPhraseLevels, StemsLayer
from crate.smart_mix.user_corrections import (
    PHRASE_SNAP_BPM_TOLERANCE,
    UserCorrection,
    apply_user_correction,
)
from tests.smart_mix_candidate_cases import (
    ANCHOR_MS,
    BEAT_MS,
    BPM,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
    profile,
)


def _correction(**values) -> UserCorrection:
    return UserCorrection(entity_uid=OUTGOING_UID, revision=1, **values)


def _grid(first_ms: int, beat_ms: float, count: int = 500) -> tuple[int, ...]:
    return tuple(round(first_ms + index * beat_ms) for index in range(count))


def _structured(**overrides):
    return profile(
        OUTGOING_UID,
        layout=OUTGOING_LAYOUT,
        vocals=[100] * len(OUTGOING_LAYOUT),
        bpm_confidence=0.4,
        intro_bpm=124.0,
        intro_beat_ms=ANCHOR_MS,
        outro_bpm=126.0,
        outro_beat_ms=200_160,
        intro_downbeat_ms=ANCHOR_MS,
        **overrides,
    )


def _with_stems(base):
    levels = tuple(
        StemPhraseLevels(
            start_ms=phrase.start_ms,
            end_ms=phrase.start_ms + 1,
            drums=1,
            bass=1,
            other=1,
            vocals=1,
        )
        for phrase in base.phrases
    )
    return replace(
        base,
        stems=StemsLayer(
            producer="crate-stems",
            separator_model="htdemucs",
            separator_version="4",
            phrases=levels,
        ),
    )


# --- nothing to apply -------------------------------------------------------------


@pytest.mark.parametrize(
    "correction", [None, _correction(), _correction(bpm=None, key=None)]
)
def test_a_missing_or_cleared_correction_applies_nothing(correction) -> None:
    base = _structured()

    assert apply_user_correction(base, correction) is base


# --- key ---------------------------------------------------------------------------


def test_a_key_correction_sets_the_camelot_key_with_full_confidence() -> None:
    base = _structured(key_confidence=0.3)

    corrected = apply_user_correction(base, _correction(key="5B"))

    assert corrected.camelot == "5B"
    assert corrected.key_confidence == 1.0
    # Nothing about the tempo changes.
    assert replace(corrected, camelot=base.camelot, key_confidence=0.3) == base


# --- BPM only -------------------------------------------------------------------------


def test_a_bpm_only_correction_keeps_the_anchors_and_the_phrases() -> None:
    base = _structured()

    corrected = apply_user_correction(base, _correction(bpm=126.0))

    assert (corrected.bpm, corrected.intro_bpm, corrected.outro_bpm) == (
        126.0,
        126.0,
        126.0,
    )
    assert corrected.bpm_confidence == 1.0
    for field_name in (
        "beat_anchor_ms",
        "downbeat_anchor_ms",
        "intro_beat_ms",
        "outro_beat_ms",
        "intro_downbeat_ms",
        "outro_downbeat_ms",
    ):
        assert getattr(corrected, field_name) == getattr(base, field_name)
    # Within 2 % and no grid to snap to: the analysed phrases stay.
    assert corrected.phrases == base.phrases
    assert corrected.vocal_presence == base.vocal_presence


def test_the_phrases_survive_up_to_the_tolerance_and_drop_beyond_it() -> None:
    base = _with_stems(_structured())
    limit = BPM * (1 + PHRASE_SNAP_BPM_TOLERANCE)

    kept = apply_user_correction(base, _correction(bpm=limit))
    dropped = apply_user_correction(base, _correction(bpm=limit + 0.1))
    slower = apply_user_correction(base, _correction(bpm=BPM * 0.97))

    assert kept.phrases == base.phrases
    assert kept.stems == base.stems
    for corrected in (dropped, slower):
        # The planner then plans the track on its bar heuristic.
        assert corrected.phrases is None
        assert corrected.vocal_presence is None
        assert corrected.vocal_detector is None
        assert corrected.stems is None
        # Per bar, not per phrase: the energy curve stays.
        assert corrected.energy_curve == base.energy_curve


# --- grid -------------------------------------------------------------------------------


def test_a_grid_correction_resnaps_the_anchors_and_the_phrases() -> None:
    base = _structured()
    # The same tempo, every beat 20 ms later.
    grid = _grid(ANCHOR_MS + 20, BEAT_MS)

    corrected = apply_user_correction(base, _correction(bpm=BPM, beat_grid_ms=grid))

    assert corrected.beat_anchor_ms == grid[0]
    assert corrected.downbeat_anchor_ms == ANCHOR_MS + 20
    assert corrected.intro_beat_ms == ANCHOR_MS + 20
    assert corrected.outro_beat_ms == 200_160 + 20
    assert corrected.intro_downbeat_ms == ANCHOR_MS + 20
    # The profile had no outro downbeat: none appears.
    assert corrected.outro_downbeat_ms is None
    assert (corrected.intro_bpm, corrected.outro_bpm) == (BPM, BPM)
    assert corrected.bpm_confidence == 1.0
    assert [phrase.start_ms for phrase in corrected.phrases] == [
        phrase.start_ms + 20 for phrase in base.phrases
    ]
    assert [phrase.start_beat for phrase in corrected.phrases] == [
        phrase.start_beat for phrase in base.phrases
    ]
    assert corrected.vocal_presence == base.vocal_presence
    # The reader did not load the beat grid, so none is set.
    assert corrected.beat_grid_ms == ()


def test_the_grid_keeps_the_profile_bar_phase() -> None:
    # The analysis put the first downbeat on the second beat (960 ms).
    base = _structured(downbeat_anchor_ms=ANCHOR_MS + BEAT_MS)
    grid = _grid(ANCHOR_MS + 10, BEAT_MS)

    corrected = apply_user_correction(base, _correction(bpm=BPM, beat_grid_ms=grid))

    assert corrected.beat_anchor_ms == grid[0]
    assert corrected.downbeat_anchor_ms == grid[1]
    assert all(phrase.start_beat % 4 == 1 for phrase in corrected.phrases)
    assert all(grid[p.start_beat] == p.start_ms for p in corrected.phrases)


def test_a_grid_within_the_tolerance_snaps_phrases_to_its_downbeats() -> None:
    base = _structured()
    beat_ms = 60_000.0 / 126.0
    grid = _grid(ANCHOR_MS, beat_ms)

    corrected = apply_user_correction(base, _correction(bpm=126.0, beat_grid_ms=grid))

    assert corrected.phrases is not None
    assert len(corrected.phrases) == len(base.phrases)
    for snapped, analysed in zip(corrected.phrases, base.phrases, strict=True):
        assert snapped.start_beat % 4 == 0
        assert snapped.start_ms == grid[snapped.start_beat]
        assert abs(snapped.start_ms - analysed.start_ms) <= 2 * beat_ms
        assert (snapped.bars, snapped.kind) == (analysed.bars, analysed.kind)


def test_phrases_that_no_longer_fit_the_grid_drop() -> None:
    base = _structured()
    # A grid that ends after 100 beats: the later phrases would all land on its
    # last downbeat.
    grid = _grid(ANCHOR_MS, BEAT_MS, count=100)

    corrected = apply_user_correction(base, _correction(bpm=BPM, beat_grid_ms=grid))

    assert corrected.phrases is None
    assert corrected.vocal_presence is None


def test_a_grid_beyond_the_tolerance_drops_the_phrases() -> None:
    base = _structured()
    grid = _grid(ANCHOR_MS, 60_000.0 / 130.0)

    corrected = apply_user_correction(base, _correction(bpm=130.0, beat_grid_ms=grid))

    assert corrected.phrases is None
    assert corrected.downbeat_anchor_ms in grid


def test_a_grid_only_correction_takes_its_bpm_from_the_grid() -> None:
    base = _structured()
    grid = _grid(ANCHOR_MS, BEAT_MS)

    corrected = apply_user_correction(base, _correction(beat_grid_ms=grid))

    assert corrected.bpm == pytest.approx(BPM)
    assert corrected.bpm_confidence == 1.0
    assert corrected.phrases == base.phrases


def test_a_loaded_beat_grid_becomes_the_corrected_one() -> None:
    base = _structured(
        beat_grid_ms=_grid(ANCHOR_MS, BEAT_MS), beat_grid_format="delta-ms-v1"
    )
    grid = _grid(ANCHOR_MS + 20, BEAT_MS)

    corrected = apply_user_correction(base, _correction(bpm=BPM, beat_grid_ms=grid))

    assert corrected.beat_grid_ms == grid
    assert corrected.beat_grid_format == "delta-ms-v1"


def test_a_profile_without_anchors_or_tempo_only_gains_the_beat_anchor() -> None:
    base = profile(
        OUTGOING_UID,
        bpm=None,
        bpm_confidence=None,
        beat_anchor_ms=None,
        downbeat_anchor_ms=None,
        time_signature=None,
    )
    grid = _grid(500, BEAT_MS)

    corrected = apply_user_correction(base, _correction(beat_grid_ms=grid, key="1A"))

    assert corrected.beat_anchor_ms == 500
    assert corrected.downbeat_anchor_ms is None
    assert corrected.intro_beat_ms is None
    assert corrected.outro_downbeat_ms is None
    assert corrected.bpm == pytest.approx(BPM)
    assert corrected.bpm_confidence == 1.0
    assert corrected.phrases is None
    assert corrected.camelot == "1A"


def test_the_structureless_profile_takes_the_same_tempo_corrections() -> None:
    """The cache key reads profiles without structure; the plan reads them with it.
    Both take the same correction of everything but the phrases."""
    structured = _structured()
    bare = replace(
        structured,
        phrases=None,
        energy_curve=None,
        vocal_presence=None,
        vocal_detector=None,
        structure_confidence=None,
    )
    correction = _correction(bpm=126.0, beat_grid_ms=_grid(ANCHOR_MS, 60_000 / 126))

    full = apply_user_correction(structured, correction)
    light = apply_user_correction(bare, correction)

    assert (
        replace(
            full,
            phrases=None,
            energy_curve=None,
            vocal_presence=None,
            vocal_detector=None,
            structure_confidence=None,
        )
        == light
    )


# --- identity ---------------------------------------------------------------------------


def test_the_identity_follows_the_content_only() -> None:
    grid = _grid(ANCHOR_MS, BEAT_MS, count=8)
    first = _correction(bpm=125.0, beat_grid_ms=grid, key="8A")

    same = UserCorrection(
        entity_uid=OUTGOING_UID, revision=7, bpm=125.0, beat_grid_ms=grid, key="8A"
    )
    assert first.identity() == same.identity()
    for other in (
        replace(first, bpm=125.5),
        replace(first, beat_grid_ms=grid[1:]),
        replace(first, key="8B"),
        replace(first, key=None),
    ):
        assert other.identity() != first.identity()


def test_a_correction_reads_from_its_stored_row() -> None:
    row = {
        "entity_uid": OUTGOING_UID,
        "revision": 3,
        "bpm": 127,
        "beat_grid_format": "delta-ms-v1",
        "beat_grid_ms": [512, 981],
        "key": "8A",
    }

    correction = UserCorrection.from_row(row)

    assert correction == UserCorrection(
        entity_uid=OUTGOING_UID,
        revision=3,
        bpm=127.0,
        beat_grid_ms=(512, 981),
        key="8A",
    )
    assert UserCorrection.from_row(
        {**row, "bpm": None, "beat_grid_ms": None, "key": None}
    ).cleared
