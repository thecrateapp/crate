from __future__ import annotations

import csv
import json
import os
import random
import subprocess
import sys
from pathlib import Path

import pytest

import compare_models
import export_phrases
from compare_models import (
    BACKENDS,
    CPU_FIELDS,
    WINDOW_FIELDS,
    Backend,
    Confusion,
    LabelledPhrase,
    PhraseWindows,
    always_voice,
    auc,
    backend_meta,
    cross_validate,
    phrase_byte,
    phrase_windows,
    read_windows,
    score_tracks,
    summarize_cpu,
    track_folds,
    voice_class_indices,
    write_windows,
)

REMOTE_DSN = "postgresql://crate:secret@95.216.3.27:5432/crate"


def _phrase(uid: str, vocal: bool, *scores: float) -> LabelledPhrase:
    return LabelledPhrase(
        entity_uid=uid,
        vocal=vocal,
        mean=sum(scores) / len(scores),
        scores=tuple(scores),
    )


def test_phrase_byte_is_fraction_of_voiced_windows() -> None:
    scores = (0.9, 0.2, 0.6, 0.05)

    assert phrase_byte(scores, 0.5) == 128  # 2 of 4 windows: 127.5 rounds to 128
    assert phrase_byte(scores, 0.1) == 191  # 3 of 4
    assert phrase_byte(scores, 0.05) == 255  # a window at the threshold counts
    assert phrase_byte(scores, 0.95) == 0
    assert phrase_byte((), 0.5) == 0


def test_tracks_go_to_folds_by_sorted_uid() -> None:
    folds = track_folds(["c", "a", "f", "b", "a", "e", "d"], folds=5)

    assert folds == {"a": 0, "b": 1, "c": 2, "d": 3, "e": 4, "f": 0}


def test_threshold_chosen_by_cross_validation() -> None:
    # Tracks a-d separate cleanly between 0.1 and 0.5. Track e sings softly (0.12):
    # thresholds fitted without it miss its voice, and its own fold is scored with
    # thresholds learnt on the other tracks only.
    phrases = []
    for uid in "abcd":
        phrases += [_phrase(uid, True, 0.5, 0.5), _phrase(uid, False, 0.1, 0.1)]
    phrases += [_phrase("e", True, 0.12, 0.12), _phrase("e", False, 0.0, 0.0)]
    grid = (0.05, 0.1, 0.15, 0.3)

    result = cross_validate(phrases, folds=5, window_thresholds=grid)

    assert result.confusion == Confusion(tp=4, fp=0, fn=1, tn=5)
    assert [(t.window, t.byte) for t in result.thresholds] == [(0.15, 1)] * 5
    shuffled = phrases[:]
    random.Random(3).shuffle(shuffled)
    assert cross_validate(shuffled, folds=5, window_thresholds=grid) == result


def test_cross_validation_skips_empty_folds() -> None:
    phrases = [_phrase("a", True, 0.5), _phrase("b", False, 0.0)]

    result = cross_validate(phrases, folds=5, window_thresholds=(0.1, 0.3))

    assert len(result.thresholds) == 2  # three folds are empty and are skipped
    assert result.confusion.tp + result.confusion.fn == 1


def test_auc_on_a_hand_computed_case() -> None:
    # Of the four (voice, no voice) pairs, voice ranks higher in three: 0.75.
    assert auc([0.1, 0.4, 0.35, 0.8], [False, False, True, True]) == 0.75
    # A tie counts half.
    assert auc([0.5, 0.5], [True, False]) == 0.5
    assert auc([0.2, 0.9], [True, True]) is None


def test_always_voice_baseline() -> None:
    phrases = [
        _phrase("a", True, 0.1),
        _phrase("a", True, 0.1),
        _phrase("b", True, 0.1),
        _phrase("b", False, 0.1),
    ]

    baseline = always_voice(phrases)

    assert baseline == Confusion(tp=3, fp=1, fn=0, tn=0)
    assert baseline.precision == 0.75
    assert baseline.recall == 1.0
    assert baseline.f1 == pytest.approx(6 / 7)
    assert baseline.specificity == 0.0
    assert baseline.npv is None


def test_scores_csv_matches_export_format(tmp_path: Path) -> None:
    rows = [
        {"phrase_index": 0, "start_ms": 0, "end_ms": 1_000},
        {"phrase_index": 1, "start_ms": 1_000, "end_ms": 2_500},
        {"phrase_index": 2, "start_ms": 2_500, "end_ms": 2_500},
    ]
    centres = [0.48, 0.96, 1.44, 1.92, 2.4]
    # YAMNet's voice scores sit around 1e-4 in music: six decimals keep them apart.
    scores = [0.000234, 0.5, 0.25, 1.0, 0.0]

    phrases = phrase_windows("track", rows, centres, scores)
    path = tmp_path / "vocals_windows_test.csv"
    write_windows(path, phrases)

    with path.open(newline="") as handle:
        written = list(csv.DictReader(handle))
    # Same keys as the label export, so the files join on them.
    assert tuple(written[0])[:4] == export_phrases.LABEL_FIELDS[:4]
    assert tuple(written[0]) == WINDOW_FIELDS
    assert written[0] == {
        "entity_uid": "track",
        "phrase_index": "0",
        "start_ms": "0",
        "end_ms": "1000",
        "n_windows": "2",
        "mean": "0.250117",
        "windows": "0.000234 0.5",
    }
    # A window belongs to the phrase its centre falls in; an empty phrase has none.
    assert [phrase.scores for phrase in phrases] == [
        (0.000234, 0.5),
        (0.25, 1.0, 0.0),
        (),
    ]
    assert written[2]["n_windows"] == "0"
    assert written[2]["mean"] == ""
    assert read_windows(path) == phrases


def test_voice_classes_are_picked_by_audioset_name() -> None:
    labels = ["Music", "Speech", "Singing", "Guitar", "Rapping", "Male singing"]

    assert voice_class_indices(labels) == [1, 2, 4, 5]


def test_registry_holds_the_three_candidates_without_loading_them() -> None:
    assert {name: backend.sample_rate for name, backend in BACKENDS.items()} == {
        "yamnet-essentia": 16_000,
        "effnet": 16_000,
        "panns": 32_000,
    }
    loaded = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys, compare_models; "
            "print(sorted({'essentia', 'torch', 'panns_inference'} & set(sys.modules)))",
        ],
        cwd=Path(compare_models.__file__).parent,
        check=True,
        capture_output=True,
        text=True,
    )
    assert loaded.stdout.strip() == "[]"


def test_score_decodes_once_per_rate_and_writes_each_backend(tmp_path: Path) -> None:
    decoded = []

    def decode(path: Path, rate: int) -> list[float]:
        decoded.append((path.name, rate))
        return [0.0] * (rate * 3)  # three seconds

    def constant(value: float):
        return lambda audio: ([0.5, 1.5, 2.5], [value] * 3)

    backends = {
        "low": Backend("Low", 16_000, (), lambda _models: constant(0.1)),
        "also-low": Backend("Also low", 16_000, (), lambda _models: constant(0.2)),
        "high": Backend("High", 32_000, (), lambda _models: constant(0.3)),
    }
    tracks = [
        (
            "uid-1",
            Path("one.flac"),
            [
                {"phrase_index": 0, "start_ms": 0, "end_ms": 2_000},
                {"phrase_index": 1, "start_ms": 2_000, "end_ms": 3_000},
            ],
        )
    ]
    scorers = {name: backend.load(None) for name, backend in backends.items()}

    score_tracks(tracks, backends, scorers, decode, tmp_path)

    assert decoded == [("one.flac", 16_000), ("one.flac", 32_000)]
    assert [p.scores for p in read_windows(tmp_path / "vocals_windows_high.csv")] == [
        (0.3, 0.3),
        (0.3,),
    ]
    with (tmp_path / "vocals_cpu_also-low.csv").open(newline="") as handle:
        [cpu] = list(csv.DictReader(handle))
    assert tuple(cpu) == CPU_FIELDS
    assert cpu["entity_uid"] == "uid-1"
    assert cpu["seconds"] == "3.0"


def test_backend_meta_reports_model_files_and_run(tmp_path: Path) -> None:
    (tmp_path / "graph.pb").write_bytes(b"x" * 1_500_000)
    image_file = tmp_path / "image" / "labels.csv"
    image_file.parent.mkdir()
    image_file.write_bytes(b"y" * 500_000)
    backend = Backend("Test", 16_000, ("graph.pb", image_file), lambda _models: None)

    meta = backend_meta(
        "test", backend, tmp_path, run_backends=["test", "other"], peak_rss_mb=812.34
    )

    assert meta == {
        "backend": "test",
        "title": "Test",
        "sample_rate": 16_000,
        "model_files": {"graph.pb": 1_500_000, "labels.csv": 500_000},
        "model_mb": 2.0,
        "peak_rss_mb": 812.3,
        "run_backends": ["test", "other"],
    }
    with pytest.raises(ValueError, match="--models-dir"):
        backend.model_paths(None)


def test_cpu_summary_per_track_and_per_audio_minute() -> None:
    rows = [
        {"seconds": "60", "decode_cpu": "0.5", "model_cpu": str(cpu)}
        for cpu in (1, 2, 3, 10)
    ]

    summary = summarize_cpu(rows)

    assert summary == {
        "tracks": 4,
        "audio_minutes": 4.0,
        "decode_mean": 0.5,
        "model_mean": 4.0,
        "model_p50": 2.5,
        "model_p95": 10.0,
        "model_per_audio_minute": 4.0,
    }


def test_score_refuses_a_remote_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    monkeypatch.delenv("CRATE_POSTGRES_HOST", raising=False)

    def never(_uid: str):
        raise AssertionError("read the database")

    monkeypatch.setattr(compare_models, "stored_phrase_rows", never)

    code = compare_models.main(
        ["score", "uid", "--dsn", REMOTE_DSN, "--output", str(tmp_path)]
    )

    assert code == 2
    assert "not on this machine" in capsys.readouterr().err
    assert "CRATE_POSTGRES_HOST" not in os.environ


def test_score_rejects_an_unknown_backend(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    code = compare_models.main(
        [
            "score",
            "uid",
            "--backends",
            "yamnet-essentia,nope",
            "--output",
            str(tmp_path),
        ]
    )

    assert code == 2
    assert "nope" in capsys.readouterr().err


def _write_csv(path: Path, fields: tuple[str, ...], rows: list[dict]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def test_evaluate_writes_the_report_with_recommended_thresholds(
    tmp_path: Path,
) -> None:
    windows = tmp_path / "windows"
    windows.mkdir()
    labels, good, flat = [], [], []
    for track in range(10):
        uid = f"track-{track}"
        for index, vocal in enumerate((1, 0)):
            start_ms = index * 10_000
            labels.append(
                {
                    "entity_uid": uid,
                    "phrase_index": index,
                    "start_ms": start_ms,
                    "end_ms": start_ms + 10_000,
                    "bars": 8,
                    "kind": "body",
                    "vocal": vocal,
                }
            )
            key = (uid, index, start_ms, start_ms + 10_000)
            good.append((*key, (0.8, 0.6) if vocal else (0.01, 0.02)))
            flat.append((*key, (0.5, 0.5)))
    # One unlabelled phrase, one that moved since labelling, one without windows.
    labels.append({**labels[0], "phrase_index": 2, "start_ms": 30_000, "vocal": ""})
    labels.append(
        {
            **labels[0],
            "phrase_index": 3,
            "start_ms": 40_000,
            "end_ms": 50_000,
            "vocal": 1,
        }
    )
    good.append(("track-0", 3, 41_000, 50_000, (0.9,)))
    flat.append(("track-0", 3, 41_000, 50_000, (0.9,)))
    labels.append(
        {
            **labels[0],
            "phrase_index": 4,
            "start_ms": 50_000,
            "end_ms": 50_100,
            "vocal": 0,
        }
    )
    good.append(("track-0", 4, 50_000, 50_100, ()))
    flat.append(("track-0", 4, 50_000, 50_100, (0.1,)))
    labels_path = tmp_path / "vocals_labels.csv"
    _write_csv(labels_path, export_phrases.LABEL_FIELDS, labels)
    for name, rows in (("good", good), ("flat", flat)):
        write_windows(
            windows / f"vocals_windows_{name}.csv",
            [
                PhraseWindows(uid, index, start, end, scores)
                for uid, index, start, end, scores in rows
            ],
        )
    _write_csv(
        windows / "vocals_cpu_good.csv",
        CPU_FIELDS,
        [
            {
                "entity_uid": f"track-{track}",
                "seconds": "120.0",
                "decode_cpu": "0.40",
                "model_cpu": "3.00",
            }
            for track in range(10)
        ],
    )
    output = tmp_path / "report"

    code = compare_models.main(
        [
            "evaluate",
            "--labels",
            str(labels_path),
            "--windows",
            str(windows),
            "--output",
            str(output),
        ]
    )

    assert code == 0
    report = json.loads((output / "report.json").read_text())
    assert report["phrases"] == {
        "labelled": 22,
        "evaluated": 20,
        "tracks": 10,
        "voice": 10,
        "no_voice": 10,
        "left_out": {"not_scored": 0, "moved": 1, "no_windows": 1},
    }
    assert report["baseline"]["precision"] == 0.5
    assert list(report["backends"]) == ["flat", "good"]
    good_report = report["backends"]["good"]
    assert good_report["auc"] == 1.0
    assert (good_report["precision"], good_report["recall"]) == (1.0, 1.0)
    assert len(good_report["fold_thresholds"]) == 5
    recommended = good_report["recommended"]
    window, byte = recommended["window_threshold"], recommended["byte_threshold"]
    assert phrase_byte((0.8, 0.6), window) >= byte > phrase_byte((0.01, 0.02), window)
    assert good_report["cpu"]["model_per_audio_minute"] == 1.5
    assert report["backends"]["flat"]["auc"] == 0.5
    assert report["backends"]["flat"]["cpu"] is None
    markdown = (output / "report.md").read_text()
    assert "| Always voice (baseline) |" in markdown
    assert "| good |" in markdown


def test_evaluate_needs_a_windows_file_per_backend(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    write_windows(tmp_path / "vocals_windows_yamnet-essentia.csv", [])

    code = compare_models.main(
        [
            "evaluate",
            "--windows",
            str(tmp_path),
            "--output",
            str(tmp_path / "report"),
            "--backends",
            "yamnet-essentia,panns",
        ]
    )

    assert code == 2
    assert "vocals_windows_panns.csv" in capsys.readouterr().err


def _labelled(uid: str, index: int, vocal: int, end_ms: int = 10_000) -> dict:
    start_ms = index * 10_000
    return {
        "entity_uid": uid,
        "phrase_index": index,
        "start_ms": start_ms,
        "end_ms": start_ms + end_ms,
        "bars": 8,
        "kind": "body",
        "vocal": str(vocal),
    }


def test_recommended_thresholds_are_one_pair_fitted_on_every_label() -> None:
    # Per-fold medians of window and byte could pair values no fold chose together.
    rng = random.Random(3)
    labels, windows = [], []
    for track in range(12):
        uid = f"track-{track:02d}"
        for index, vocal in enumerate((1, 0, 1)):
            labels.append(_labelled(uid, index, vocal))
            scores = tuple(
                rng.uniform(0.002, 0.02) if vocal else rng.uniform(0.0, 0.004)
                for _ in range(20)
            )
            windows.append(
                PhraseWindows(
                    uid, index, index * 10_000, index * 10_000 + 10_000, scores
                )
            )

    report = compare_models.evaluate(labels, {"model": windows})

    phrases = [
        LabelledPhrase(p.entity_uid, labels[i]["vocal"] == "1", p.mean or 0.0, p.scores)
        for i, p in enumerate(windows)
    ]
    fitted = compare_models.choose_thresholds(phrases)
    assert report["backends"]["model"]["recommended"] == {
        "window_threshold": fitted.window,
        "byte_threshold": fitted.byte,
        "fitted_on": "all labels, not held out",
    }


def test_window_scores_keep_six_significant_digits(tmp_path: Path) -> None:
    phrase = PhraseWindows("uid", 0, 0, 1_000, (0.0000996, 0.000123456, 0.5))
    path = tmp_path / "windows.csv"

    write_windows(path, [phrase])
    [read] = read_windows(path)

    assert read.scores == pytest.approx(phrase.scores, rel=1e-5)
    assert read.scores[0] < 0.0001
    assert read.mean == pytest.approx(phrase.mean, rel=1e-5)


def test_non_finite_window_scores_fail_loudly(tmp_path: Path) -> None:
    path = tmp_path / "windows.csv"
    _write_csv(
        path,
        WINDOW_FIELDS,
        [
            {
                "entity_uid": "uid",
                "phrase_index": 0,
                "start_ms": 0,
                "end_ms": 1_000,
                "n_windows": 2,
                "mean": "",
                "windows": "0.1 nan",
            }
        ],
    )

    with pytest.raises(ValueError, match="finite"):
        read_windows(path)


def test_a_phrase_whose_end_moved_is_left_out() -> None:
    labels = [_labelled("uid", 0, 1), _labelled("uid", 1, 0, end_ms=8_000)]
    windows = [
        PhraseWindows("uid", 0, 0, 10_000, (0.5,)),
        PhraseWindows("uid", 1, 10_000, 20_000, (0.0,)),
    ]

    report = compare_models.evaluate(labels, {"model": windows})

    assert report["phrases"]["left_out"]["moved"] == 1
    assert report["phrases"]["evaluated"] == 1


def test_a_track_that_fails_to_decode_is_skipped(tmp_path: Path, capsys) -> None:
    def decode(path: Path, rate: int) -> list[float]:
        if path.name == "broken.flac":
            raise RuntimeError("corrupt file")
        return [0.0] * (rate * 3)

    backend = Backend("Low", 16_000, (), lambda _models: lambda a: ([0.5], [0.2]))
    rows = [{"phrase_index": 0, "start_ms": 0, "end_ms": 2_000}]
    tracks = [
        ("uid-1", Path("broken.flac"), rows),
        ("uid-2", Path("ok.flac"), rows),
    ]

    skipped = score_tracks(
        tracks, {"low": backend}, {"low": backend.load(None)}, decode, tmp_path
    )

    assert skipped == ["uid-1"]
    assert [
        p.entity_uid for p in read_windows(tmp_path / "vocals_windows_low.csv")
    ] == ["uid-2"]
    assert "uid-1" in capsys.readouterr().err
