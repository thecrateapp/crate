"""Calibration of the stems layer's presence cuts (Smart Mix Stems ST3.PR3)."""

from __future__ import annotations

import pytest

from calibrate_stems import (
    PhraseRow,
    confusion,
    cross_validate,
    fit_cut,
    fold_of,
    histogram,
    label_rows,
    present,
    valley,
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
