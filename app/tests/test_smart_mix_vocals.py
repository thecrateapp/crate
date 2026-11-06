"""Per-phrase voice of Smart Mix profiles (SM3-D13).

YAMNet scores 0.975 s patches (``crate.smart_mix.voice_model``, with its own parity
tests); these tests feed hand-made patch scores and a fake model, never the network.
"""

from __future__ import annotations

import csv
import logging
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from crate.smart_mix import vocals
from crate.smart_mix.models import MixProfileQuality, Phrase, TrackMixProfileDraft
from crate.smart_mix.voice_model import VoiceWindows

REPO_ROOT = Path(__file__).resolve().parents[2]
LABELS_CSV = REPO_ROOT / "tools/smart-mix-eval/vocals_labels.csv"
SCORES_CSV = REPO_ROOT / "tools/smart-mix-eval/vocals_scores.csv"
# The byte's log scale runs from LOG_FLOOR (0) to a score of 1 (255).
VOICED = 1.0
UNVOICED = vocals.LOG_FLOOR
# Windows are centred every 480 ms from 488 ms: each span holds four of them.
SPANS = [(400 + 1_920 * k, 2_320 + 1_920 * k) for k in range(3)]


def _windows(scores: list[float]) -> VoiceWindows:
    values = np.asarray(scores, dtype=np.float32)
    return VoiceWindows(centres_ms=np.arange(len(values)) * 480 + 488, scores=values)


def _phrases(count: int) -> tuple[Phrase, ...]:
    return tuple(
        Phrase(
            start_beat=32 * index,
            start_ms=500 + 16_000 * index,
            bars=8,
            energy=0.5,
            delta_energy=None if index == 0 else 0.0,
            kind="body",
        )
        for index in range(count)
    )


def _draft(phrases: tuple[Phrase, ...] | None) -> TrackMixProfileDraft:
    return TrackMixProfileDraft(
        analyzer="crate-rust",
        analyzer_version="smart-mix-audio-v7",
        duration_ms=60_000,
        quality=MixProfileQuality.FULL,
        bpm=120.0,
        bpm_confidence=0.95,
        tempo_stability=0.97,
        beat_anchor_ms=500,
        downbeat_anchor_ms=500,
        time_signature=4,
        beat_grid_ms=tuple(500 + 500 * beat for beat in range(110)),
        phrases=phrases,
        energy_curve=None if phrases is None else bytes(8 * len(phrases)),
        structure_confidence=None if phrases is None else 0.6,
    )


class _FakeModel:
    def __init__(self, windows: VoiceWindows | Exception) -> None:
        self.windows = windows
        self.audio: list[np.ndarray] = []

    def voice_windows(self, audio: np.ndarray) -> VoiceWindows:
        self.audio.append(audio)
        if isinstance(self.windows, Exception):
            raise self.windows
        return self.windows


def test_phrase_byte_is_the_geometric_mean_on_a_log_scale() -> None:
    windows = _windows([VOICED] * 4 + [UNVOICED] * 4 + [VOICED, UNVOICED] * 2)

    # Half way between the floor and 1 in logs is the middle byte.
    assert vocals.phrase_vocal_presence(windows, SPANS) == bytes([255, 0, 128])


def test_scores_under_the_floor_count_as_the_floor() -> None:
    windows = _windows([0.0] * 4 + [0.001] * 4)

    # A quarter of the way from the floor (10^-4) to 1 in logs.
    assert vocals.phrase_vocal_presence(windows, SPANS[:2]) == bytes([0, 64])


def test_the_calibrated_threshold_is_a_mean_voice_score_of_about_0_26_percent() -> None:
    # SG1b: calibrated on 2,721 phrases of 275 production tracks against synced lyrics.
    at_threshold = 10 ** (
        np.log10(vocals.LOG_FLOOR) * (1 - vocals.VOCAL_THRESHOLD / 255)
    )

    assert at_threshold == pytest.approx(0.0026, rel=0.01)


def test_spans_without_windows_score_zero() -> None:
    windows = _windows([VOICED] * 4)

    assert vocals.phrase_vocal_presence(windows, SPANS[:2]) == bytes([255, 0])


def test_no_voice_without_phrases() -> None:
    assert vocals.phrase_vocal_presence(_windows([VOICED]), []) == b""
    model = _FakeModel(_windows([VOICED]))

    draft = vocals.add_vocal_presence(_draft(None), "/music/track.flac", model=model)

    assert draft.vocal_presence is None
    assert model.audio == []


def test_missing_model_leaves_voice_null(monkeypatch) -> None:
    monkeypatch.setattr(vocals, "load_voice_model", lambda: None)
    draft = _draft(_phrases(3))

    assert vocals.add_vocal_presence(draft, "/music/track.flac") is draft


def test_voice_is_added_with_its_detector(monkeypatch) -> None:
    monkeypatch.setattr(
        vocals, "load_audio", lambda _path: np.zeros(16_000, dtype=np.float32)
    )
    windows = _windows([VOICED] * 34 + [UNVOICED] * 34 + [VOICED] * 34)
    draft = _draft(_phrases(3))

    voiced = vocals.add_vocal_presence(
        draft, "/music/track.flac", model=_FakeModel(windows)
    )

    assert voiced.vocal_detector == vocals.VOCAL_DETECTOR
    assert voiced.vocal_presence == vocals.phrase_vocal_presence(
        windows, vocals.phrase_spans_ms(draft.phrases, draft.beat_grid_ms)
    )
    assert replace(voiced, vocal_presence=None, vocal_detector=None) == draft


def test_a_failing_model_keeps_the_profile_without_voice(monkeypatch, caplog) -> None:
    monkeypatch.setattr(
        vocals, "load_audio", lambda _path: np.zeros(16_000, dtype=np.float32)
    )
    draft = _draft(_phrases(3))
    model = _FakeModel(RuntimeError("out of memory"))

    with caplog.at_level(logging.WARNING):
        result = vocals.add_vocal_presence(draft, "/music/track.flac", model=model)

    assert result is draft
    assert "voice" in caplog.text


def test_audio_loads_with_essentia_at_the_model_rate(monkeypatch) -> None:
    calls = []

    def mono_loader(**kwargs):
        calls.append(kwargs)
        return lambda: [0.0, 0.5]

    def import_module(name):
        assert name == "essentia.standard"
        return SimpleNamespace(MonoLoader=mono_loader)

    monkeypatch.setattr(vocals.importlib, "import_module", import_module)

    audio = vocals.load_audio(Path("/music/track.flac"))

    assert calls == [
        {"filename": "/music/track.flac", "sampleRate": 16_000, "resampleQuality": 4}
    ]
    assert audio.dtype == np.float32 and audio.tolist() == [0.0, 0.5]


def test_audio_falls_back_to_librosa_without_essentia(monkeypatch) -> None:
    import importlib

    import librosa

    real_import = importlib.import_module

    def import_module(name, *args):
        if name == "essentia.standard":
            raise ImportError(name)
        return real_import(name, *args)

    loaded = []

    def load(path, sr, mono):
        loaded.append((path, sr, mono))
        return np.zeros(4, dtype=np.float64), sr

    monkeypatch.setattr(vocals.importlib, "import_module", import_module)
    monkeypatch.setattr(librosa, "load", load)

    audio = vocals.load_audio("/music/track.flac")

    assert loaded == [("/music/track.flac", 16_000, True)]
    assert audio.dtype == np.float32 and len(audio) == 4


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
    # Voice is added by the profile task after the analysis (Rust or Python), so both
    # analyzers stay identical and the parity tests keep holding.
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
