"""Calibration of the stems layer's presence cuts (Smart Mix Stems ST3.PR3)."""

from __future__ import annotations

from dataclasses import replace

import pytest

from calibrate_stems import (
    PhraseRow,
    bootstrap_by_track,
    confusion,
    cross_validate,
    fit_cut,
    fold_of,
    histogram,
    label_rows,
    mixture_cut,
    present,
    profile_rows,
    relative_db,
    valley,
    vocal_floor_check,
    yamnet_byte,
)
from crate.smart_mix.stems import STEM_SOURCES, StemAnalysis

UIDS = [f"{index:08x}-0000-4000-8000-000000000000" for index in range(10)]


def _row(uid: str, level: int, loudest: int, label: int | None) -> PhraseRow:
    return PhraseRow(
        entity_uid=uid,
        genre="rock",
        means={"vocals": level, "bass": level, "drums": level},
        loudest={"vocals": loudest, "bass": loudest, "drums": loudest},
        label=label,
    )


def test_present_needs_the_floor_and_the_drop() -> None:
    assert present(100, 120, 90, 30)
    assert not present(89, 89, 90, 30)
    assert not present(100, 140, 90, 30)


def test_confusion_counts() -> None:
    scores = confusion([(True, 1), (True, 0), (False, 1), (False, 0), (False, 0)])

    assert scores["n"] == 5 and scores["positives"] == 2
    assert scores["precision"] == 0.5
    assert scores["recall"] == 0.5
    assert scores["specificity"] == pytest.approx(0.6667, abs=1e-4)
    assert scores["balancedAccuracy"] == pytest.approx(0.5833, abs=1e-4)


def test_fit_cut_finds_the_floor_that_separates_the_labels() -> None:
    # Voiced phrases at 150, silent ones at 60 (leakage): any floor in between works;
    # the widest drop, then the lowest floor, wins the tie.
    rows = [
        _row(uid, level, 150, label)
        for uid in UIDS
        for level, label in ((150, 1), (60, 0))
    ]

    floor, drop = fit_cut(rows, "vocals", floors=range(40, 200), drops=(20, 255))

    assert (floor, drop) == (61, 255)
    result = cross_validate(rows, "vocals")
    assert result["cv"]["balancedAccuracy"] == 1.0
    assert result["all"]["balancedAccuracy"] == 1.0


def test_fit_cut_uses_the_drop_for_tracks_mixed_at_another_level() -> None:
    # A loud track whose quiet phrases (bleed) sit above a quiet track's voice: only
    # the drop below each track's loudest phrase tells them apart.
    rows = [
        _row(UIDS[0], 200, 200, 1),
        _row(UIDS[0], 130, 200, 0),
        _row(UIDS[1], 110, 110, 1),
        _row(UIDS[1], 40, 110, 0),
    ]

    floor, drop = fit_cut(rows, "vocals", floors=range(40, 200), drops=(20, 255))

    assert drop == 20
    assert all(
        present(row.means["vocals"], row.loudest["vocals"], floor, drop)
        == bool(row.label)
        for row in rows
    )


def test_folds_follow_the_uid() -> None:
    assert fold_of("00000003-0000-4000-8000-000000000000") == 3
    assert fold_of("0000000a-0000-4000-8000-000000000000") == 0


def test_valley_between_two_modes() -> None:
    values = [-30.0] * 40 + [-29.0] * 30 + [-5.0] * 50 + [-4.0] * 40 + [-17.0] * 2

    found = valley(values, width=1.5)

    assert found is not None and -28 < found < -6
    assert valley([1.0] * 20, width=1.0) is None
    assert histogram([-1.0, -2.5, 0.0], width=3) == {"-3": 2, "0": 1}


def test_yamnet_byte_matches_the_stored_scale() -> None:
    assert yamnet_byte([1.0, 1.0]) == 255
    assert yamnet_byte([1e-5]) == 0
    assert yamnet_byte([1e-2]) == 128
    assert yamnet_byte([]) == 0


def test_label_rows_measure_each_labelled_phrase() -> None:
    windows = 80  # 20 s
    vocals = bytes([200]) * 40 + bytes([10]) * 40
    analysis = StemAnalysis(
        schema_version="stem-analysis/1",
        producer="crate-server/eval",
        separator={
            "model": "htdemucs",
            "version": "htdemucs-onnx-1",
            "sources": STEM_SOURCES,
        },
        source_revision="a" * 64,
        hop_ms=250,
        levels={
            "drums": bytes([150]) * windows,
            "bass": bytes([120]) * windows,
            "other": bytes([90]) * windows,
            "vocals": vocals,
        },
        duration_ms=20_000,
    )
    labels = [
        {
            "genre": "pop",
            "entity_uid": UIDS[0],
            "phrase_index": "0",
            "start_ms": "0",
            "end_ms": "10000",
            "label": "1",
        },
        {
            "genre": "pop",
            "entity_uid": UIDS[0],
            "phrase_index": "1",
            "start_ms": "10000",
            "end_ms": "20000",
            "label": "",
        },
        {
            "genre": "pop",
            "entity_uid": UIDS[1],
            "phrase_index": "0",
            "start_ms": "0",
            "end_ms": "1000",
            "label": "0",
        },
    ]

    rows = label_rows(labels, {UIDS[0]: analysis}, {(UIDS[0], 0): 99})

    assert [(row.means["vocals"], row.label, row.yamnet) for row in rows] == [
        (200, 1, 99),
        (10, None, None),
    ]
    assert rows[1].loudest == {"vocals": 200, "bass": 120, "drums": 150}


# --- robust cuts: mixture, bootstrap, the vocal floor against YAMNet -----------------


def _spread(low: float, high: float, count: int) -> list[float]:
    return [low + (high - low) * index / (count - 1) for index in range(count)]


def test_mixture_cut_lies_between_the_two_clusters() -> None:
    # Phrases with the stem a few dB below the loudest one, phrases without it spread
    # over the leakage range: the cut is where both are equally likely.
    values = _spread(-6.0, 0.0, 300) + _spread(-50.0, -20.0, 200)

    cut = mixture_cut(values)

    assert cut is not None and -20.0 < cut < -6.0
    assert mixture_cut([-3.0] * 50) is None
    assert mixture_cut([-3.0, -40.0]) is None


def test_relative_db_skips_tracks_without_the_stem() -> None:
    rows = [
        _row(UIDS[0], 200, 200, None),
        _row(UIDS[0], 149, 200, None),
        # The loudest phrase is under the floor: leakage, not a stem.
        _row(UIDS[1], 30, 40, None),
    ]

    assert relative_db(rows, "bass", floor=85) == pytest.approx([0.0, -12.0])


def test_bootstrap_by_track_is_reproducible_and_brackets_the_estimate() -> None:
    rows = [
        _row(uid, level, 250, None)
        for uid in UIDS
        for level in (250, 245, 240, 120, 100, 90)
    ]

    first = bootstrap_by_track(rows, "drums", mixture_cut, floor=85, samples=40)
    again = bootstrap_by_track(rows, "drums", mixture_cut, floor=85, samples=40)

    assert first == again
    assert first is not None
    assert first["p5"] <= first["p50"] <= first["p95"]
    assert -30.0 < first["p50"] < -2.0


def test_vocal_floor_check_counts_instrumental_tracks_marked_voiced() -> None:
    # Track 0 sings (YAMNet agrees); track 1 is instrumental for YAMNet, and its vocal
    # stem holds only leakage at 60 (-46 dBFS).
    rows = [
        _row(UIDS[0], 200, 200, None),
        _row(UIDS[0], 40, 200, None),
        _row(UIDS[1], 60, 60, None),
        _row(UIDS[1], 55, 60, None),
        # A labelled lyrics phrase, outside the YAMNet check.
        _row(UIDS[2], 180, 180, 1),
    ]
    rows = [
        replace(row, yamnet=yamnet, source="dataset" if row.label is None else "lyrics")
        for row, yamnet in zip(rows, (200, 10, 20, 20, None), strict=True)
    ]

    check = vocal_floor_check(rows, drop=76, floors_db=(-50, -40))

    low, high = check["-50"], check["-40"]
    assert low["yamnetInstrumentalTracks"] == 1
    assert low["instrumentalMarkedVoiced"] == 1
    assert high["instrumentalMarkedVoiced"] == 0
    assert high["againstYamnet"]["balancedAccuracy"] == 1.0
    assert high["lyrics"]["n"] == 1


def test_profile_rows_carry_the_stored_yamnet_byte() -> None:
    from tests.smart_mix_candidate_cases import OUTGOING_LAYOUT, profile

    from crate.smart_mix.stems import STEM_SOURCES, StemAnalysis

    voices = [200 if index % 2 else 0 for index in range(len(OUTGOING_LAYOUT))]
    track = profile(UIDS[3], layout=OUTGOING_LAYOUT, vocals=voices)
    windows = -(-track.duration_ms // 250)
    analysis = StemAnalysis(
        schema_version="stem-analysis/1",
        producer="crate-server/eval",
        separator={
            "model": "htdemucs",
            "version": "htdemucs-onnx-1",
            "sources": STEM_SOURCES,
        },
        source_revision="e" * 64,
        hop_ms=250,
        levels={stem: bytes([150]) * windows for stem in STEM_SOURCES},
        duration_ms=track.duration_ms,
    )

    rows = profile_rows({UIDS[3]: track}, {UIDS[3]: analysis}, {}, source="set")

    assert [row.yamnet for row in rows] == voices
    assert {row.source for row in rows} == {"set"}
