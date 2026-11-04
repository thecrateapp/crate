"""Optional per-phrase voice detector (SM3-D2, SM1.PR4).

The detector stays off until it reaches the design's precision and recall on phrases
labelled by hand (design §10, gate SG1). These tests use synthetic audio built here,
never the segmentation output.
"""

from __future__ import annotations

import csv
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from crate.smart_mix import vocals
from crate.smart_mix.models import Phrase

REPO_ROOT = Path(__file__).resolve().parents[2]
LABELS_CSV = REPO_ROOT / "tools/smart-mix-eval/vocals_labels.csv"
SCORES_CSV = REPO_ROOT / "tools/smart-mix-eval/vocals_scores.csv"
RATE = 22_050
SPAN_MS = 4_000


def _seconds(ms: int) -> np.ndarray:
    return np.arange(int(RATE * ms / 1_000)) / RATE


def _sung(ms: int) -> np.ndarray:
    """A sustained vowel: 220 Hz with vibrato and formant-shaped harmonics."""
    t = _seconds(ms)
    f0 = 220.0 * (1.0 + 0.01 * np.sin(2 * np.pi * 5.5 * t))
    phase = 2 * np.pi * np.cumsum(f0) / RATE
    voice = np.zeros_like(t)
    for harmonic in range(1, 16):
        frequency = 220.0 * harmonic
        formants = np.exp(-(((frequency - 700.0) / 300.0) ** 2)) + 0.6 * np.exp(
            -(((frequency - 1_200.0) / 400.0) ** 2)
        )
        voice += (0.05 + formants) * np.sin(harmonic * phase) / harmonic
    return 0.3 * voice / np.max(np.abs(voice))


def _kick(ms: int) -> np.ndarray:
    t = _seconds(ms)
    beat = (t % 0.5) < 0.12
    return 0.6 * beat * np.sin(2 * np.pi * 55.0 * t) * np.exp(-(t % 0.5) * 20)


def _noise(ms: int) -> np.ndarray:
    return 0.2 * np.random.default_rng(7).standard_normal(_seconds(ms).size)


def _spans(count: int) -> list[tuple[int, int]]:
    return [(index * SPAN_MS, (index + 1) * SPAN_MS) for index in range(count)]


def test_one_byte_per_phrase() -> None:
    audio = np.concatenate([_sung(SPAN_MS), _kick(SPAN_MS)])

    presence = vocals.phrase_vocal_presence(audio, RATE, _spans(2))

    assert isinstance(presence, bytes)
    assert len(presence) == 2
    assert vocals.phrase_vocal_presence(audio, RATE, []) == b""


def test_scores_a_sung_phrase_above_drums_noise_and_silence() -> None:
    audio = np.concatenate(
        [
            _sung(SPAN_MS),
            _kick(SPAN_MS),
            _noise(SPAN_MS),
            np.zeros(_seconds(SPAN_MS).size),
        ]
    )

    sung, kick, noise, silence = vocals.phrase_vocal_presence(audio, RATE, _spans(4))

    assert sung >= vocals.VOCAL_THRESHOLD
    assert max(kick, noise) < vocals.VOCAL_THRESHOLD
    assert silence == 0


def test_a_voice_over_a_kick_still_scores_as_voice() -> None:
    audio = _sung(SPAN_MS) + 0.5 * _kick(SPAN_MS)

    [score] = vocals.phrase_vocal_presence(audio, RATE, _spans(1))

    assert score >= vocals.VOCAL_THRESHOLD


def test_spans_outside_the_audio_score_zero() -> None:
    audio = _sung(SPAN_MS)

    presence = vocals.phrase_vocal_presence(
        audio, RATE, [(0, SPAN_MS), (SPAN_MS, 2 * SPAN_MS)]
    )

    assert presence[1] == 0


def test_phrase_spans_end_at_the_next_phrase_or_after_the_last_bars() -> None:
    beat_grid = tuple(500 + 500 * beat for beat in range(80))
    phrases = (
        Phrase(
            start_beat=0,
            start_ms=500,
            bars=8,
            energy=0.5,
            delta_energy=None,
            kind="intro",
        ),
        Phrase(
            start_beat=32,
            start_ms=16_500,
            bars=8,
            energy=0.7,
            delta_energy=0.2,
            kind="body",
        ),
        Phrase(
            start_beat=64,
            start_ms=32_500,
            bars=8,
            energy=0.4,
            delta_energy=-0.3,
            kind="outro",
        ),
    )

    # The last phrase runs past the grid: its end continues at the grid's beat length.
    assert vocals.phrase_spans_ms(phrases, beat_grid) == [
        (500, 16_500),
        (16_500, 32_500),
        (32_500, 48_500),
    ]
    assert vocals.phrase_spans_ms((), beat_grid) == []
    # Without a grid the last phrase cannot be measured and gets no length.
    assert vocals.phrase_spans_ms(phrases[-1:], ()) == [(32_500, 32_500)]


def test_the_analyzer_does_not_run_the_detector() -> None:
    # SG1 decides whether it is switched on; until then profiles keep no voice bytes.
    source = (REPO_ROOT / "app/crate/smart_mix/analyzer.py").read_text()

    assert "vocals" not in source


def test_precision_recall_on_labelled_set() -> None:
    if not LABELS_CSV.exists():
        pytest.skip("tools/smart-mix-eval/vocals_labels.csv has not been labelled yet")
    labels = {
        (row["entity_uid"], int(row["phrase_index"])): row["vocal"].strip()
        for row in csv.DictReader(LABELS_CSV.open())
    }
    unlabelled = sum(1 for value in labels.values() if value not in {"0", "1"})
    if unlabelled:
        pytest.skip(f"{unlabelled} phrases in vocals_labels.csv are not labelled yet")
    if not SCORES_CSV.exists():
        pytest.skip("Run tools/smart-mix-eval/vocals/export_phrases.py --score")
    scores = {}
    for row in csv.DictReader(SCORES_CSV.open()):
        assert int(row["detector_version"]) == vocals.VOCAL_DETECTOR_VERSION, (
            "vocals_scores.csv was scored by another detector version; score again"
        )
        scores[(row["entity_uid"], int(row["phrase_index"]))] = int(row["vocal_score"])
    assert set(labels) <= set(scores), "score every labelled phrase"

    predicted = {key: scores[key] >= vocals.VOCAL_THRESHOLD for key in labels}
    actual = {key: value == "1" for key, value in labels.items()}
    true_positives = sum(predicted[key] and actual[key] for key in labels)
    precision = true_positives / max(1, sum(predicted.values()))
    recall = true_positives / max(1, sum(actual.values()))

    assert len(labels) >= 100
    assert precision >= vocals.MIN_PRECISION
    assert recall >= vocals.MIN_RECALL


def _export_tool():
    import importlib.util

    path = REPO_ROOT / "tools/smart-mix-eval/vocals/export_phrases.py"
    spec = importlib.util.spec_from_file_location("export_phrases", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_export_rows_carry_ids_and_spans_but_no_titles() -> None:
    tool = _export_tool()
    beat_grid = tuple(500 * beat for beat in range(70))
    phrases = (
        Phrase(
            start_beat=0,
            start_ms=0,
            bars=16,
            energy=0.5,
            delta_energy=None,
            kind="intro",
        ),
        Phrase(
            start_beat=64,
            start_ms=32_000,
            bars=8,
            energy=0.8,
            delta_energy=0.3,
            kind="peak",
        ),
    )

    rows = tool.phrase_rows("track-uid", phrases, beat_grid)

    assert rows == [
        {
            "entity_uid": "track-uid",
            "phrase_index": 0,
            "start_ms": 0,
            "end_ms": 32_000,
            "bars": 16,
            "kind": "intro",
            "vocal": "",
        },
        {
            "entity_uid": "track-uid",
            "phrase_index": 1,
            "start_ms": 32_000,
            "end_ms": 48_000,
            "bars": 8,
            "kind": "peak",
            "vocal": "",
        },
    ]
    assert tuple(rows[0]) == tool.LABEL_FIELDS


def test_export_keeps_labels_already_given() -> None:
    tool = _export_tool()
    existing = [
        {"entity_uid": "a", "phrase_index": "0", "start_ms": "0", "vocal": "1"},
        {"entity_uid": "a", "phrase_index": "1", "start_ms": "8000", "vocal": "0"},
        {"entity_uid": "other", "phrase_index": "0", "start_ms": "0", "vocal": "1"},
    ]
    fresh = [
        {"entity_uid": "a", "phrase_index": 0, "start_ms": 0, "vocal": ""},
        # Re-segmented: the phrase moved, so its old label no longer applies.
        {"entity_uid": "a", "phrase_index": 1, "start_ms": 16_000, "vocal": ""},
    ]

    merged = tool.merge_rows(existing, fresh, replaced={"a"})

    assert [(row["entity_uid"], row["vocal"]) for row in merged] == [
        ("other", "1"),
        ("a", "1"),
        ("a", ""),
    ]


def test_export_reads_a_local_database_only_and_read_only() -> None:
    tool = _export_tool()

    environment = tool.database_environment(
        "postgresql://crate:secret@localhost:5433/crate", allow_remote=False
    )

    assert environment["CRATE_POSTGRES_HOST"] == "localhost"
    assert environment["CRATE_POSTGRES_PORT"] == "5433"
    assert environment["CRATE_POSTGRES_DB"] == "crate"
    assert "default_transaction_read_only=on" in environment["PGOPTIONS"]
    with pytest.raises(tool.UnsafeDatabaseError):
        tool.database_environment(
            "postgresql://crate:secret@95.216.3.27:5432/crate", allow_remote=False
        )


def test_export_loads_stored_phrases_of_v7_tracks_only(monkeypatch) -> None:
    from crate.db.jobs import analysis_storage
    from crate.db.repositories import smart_mix as smart_mix_repository

    tool = _export_tool()
    phrase = Phrase(
        start_beat=0, start_ms=0, bars=8, energy=0.5, delta_energy=None, kind="intro"
    )
    tracks = {
        "v7": {"path": "/music/a.flac", "title": "A"},
        "v6": {"path": "/music/b.flac", "title": "B"},
    }
    profiles = {
        "v7": SimpleNamespace(phrases=(phrase,), beat_grid_ms=(0, 500, 16_500)),
        "v6": SimpleNamespace(phrases=(), beat_grid_ms=(0, 500)),
    }
    requests = []

    def profile(uid, **flags):
        requests.append(flags)
        return profiles.get(uid)

    monkeypatch.setattr(
        analysis_storage,
        "resolve_smart_mix_track",
        lambda *, track_entity_uid: tracks.get(track_entity_uid),
    )
    monkeypatch.setattr(
        smart_mix_repository, "get_track_mix_profile_by_entity_uid", profile
    )

    track, rows = tool.stored_phrase_rows("v7")

    assert track == tracks["v7"]
    assert rows == tool.phrase_rows("v7", profiles["v7"].phrases, (0, 500, 16_500))
    assert tool.stored_phrase_rows("v6") is None
    assert tool.stored_phrase_rows("missing") is None
    assert requests[0] == {"include_beat_grid": True, "include_structure": True}


def test_export_reads_track_ids_once_in_order(tmp_path: Path) -> None:
    tool = _export_tool()
    tracks = tmp_path / "tracks.txt"
    tracks.write_text("# SG1 review\nb\n\na\nb\n")

    assert tool.read_track_uids(["c", "a"], tracks) == ["c", "a", "b"]
