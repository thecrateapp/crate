"""The structure evaluation's pure helpers (SMB.PR3): no audio, no models."""

from __future__ import annotations

import json
import math
import stat
import sys
from pathlib import Path

import numpy as np
import pytest

import analyze_with_beats
import beat_this_beats
import evaluate_structure
import novelty_prototype
import rerun_crate_cli
from structure_eval import (
    BaselinePhrase,
    bar_seconds,
    detection,
    grid_downbeat_times,
    grid_hit,
    interval_boundaries,
    load_baseline,
    madmom_downbeat_times,
    mean_scores,
    meter_summary,
    phrase_intervals,
    read_list,
    require_unique_stems,
    section_changes,
    section_intervals,
    shared,
)

ALLIN1 = {
    "bpm": 120,
    "beats": [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
    "beat_positions": [1, 2, 3, 4, 1, 2, 3, 4],
    "downbeats": [0.5, 2.5],
    "segments": [
        {"start": 0.0, "end": 0.5, "label": "start"},
        {"start": 0.5, "end": 8.5, "label": "intro"},
        {"start": 8.5, "end": 24.5, "label": "verse"},
        {"start": 24.5, "end": 40.5, "label": "verse"},
        {"start": 40.5, "end": 56.5, "label": "chorus"},
        {"start": 56.5, "end": 60.0, "label": "end"},
    ],
}


def _grid(first_ms: int, beats: int, beat_ms: int = 500) -> list[int]:
    return [first_ms + index * beat_ms for index in range(beats)]


def _profile(
    phrases: list[tuple[int, int]], grid: list[int], anchor: int | None
) -> dict:
    """A crate-cli profile with phrases given as (start beat, bars)."""
    return {
        "beatGridMs": grid,
        "downbeatAnchorMs": anchor,
        "timeSignature": 4,
        "quality": "full",
        "phrases": [
            {"startBeat": beat, "startMs": grid[beat], "bars": bars, "kind": "body"}
            for beat, bars in phrases
        ],
    }


def test_shared_counts_reference_times_with_a_close_candidate() -> None:
    reference = [1.0, 2.0, 3.0, 4.0]

    # 3.07 is within 70 ms, 4.1 is not; order of the candidates does not matter.
    assert shared(reference, [4.1, 3.07, 2.0, 1.03]) == 0.75
    assert shared(reference, [1.0], tolerance=1.0) == 0.5
    assert shared([], [1.0]) == 0.0
    assert shared(reference, []) == 0.0


def test_sections_leave_out_the_edge_silence() -> None:
    intervals = section_intervals(ALLIN1)
    boundaries, label_changes = section_changes(ALLIN1)

    assert intervals.tolist() == [
        [0.5, 8.5],
        [8.5, 24.5],
        [24.5, 40.5],
        [40.5, 56.5],
    ]
    assert boundaries == [8.5, 24.5, 40.5]
    # Verse to verse is a boundary but not a change of label.
    assert label_changes == [8.5, 40.5]
    assert section_intervals({"segments": []}).shape == (0, 2)


def test_phrase_intervals_end_on_the_grid_or_extrapolate() -> None:
    grid = _grid(1_000, 80)
    inside = _profile([(0, 8), (32, 8)], grid, 1_000)
    past = _profile([(0, 8), (32, 16)], grid, 1_000)

    assert phrase_intervals(inside).tolist() == [[1.0, 17.0], [17.0, 33.0]]
    # The last phrase runs past the grid: its end comes from the median beat.
    assert phrase_intervals(past).tolist() == [[1.0, 17.0], [17.0, 49.0]]
    assert phrase_intervals({"beatGridMs": grid, "phrases": []}).shape == (0, 2)
    assert bar_seconds(inside) == 2.0
    assert bar_seconds({"beatGridMs": [0, 500]}) == 2.0


def test_interval_boundaries_are_unique_and_sorted() -> None:
    intervals = np.array([[17.0004, 33.0], [1.0, 17.0]])

    assert interval_boundaries(intervals) == [1.0, 17.0, 33.0]


def test_grid_downbeats_start_at_the_anchor_phase() -> None:
    grid = _grid(1_000, 16)
    profile = _profile([], grid, 2_000)

    assert grid_downbeat_times(profile) == [2.0, 4.0, 6.0, 8.0]
    assert grid_downbeat_times(_profile([], grid, None)) is None
    assert grid_downbeat_times(_profile([], grid, 1_250)) is None
    # Reference downbeats outside the grid are not counted; 5.0 is a miss.
    assert grid_hit(profile, [0.1, 2.0, 4.05, 5.0, 9.9]) == pytest.approx(2 / 3)
    assert grid_hit(_profile([], grid, None), [2.0]) is None


def test_madmom_downbeats_are_the_first_beats_of_the_bar() -> None:
    record = {"beats": [[0.5, 1], [1.0, 2], [1.5, 3], [2.0, 1]]}

    assert madmom_downbeat_times(record) == [0.5, 2.0]


def test_detection_trims_the_edges_and_needs_two_sections() -> None:
    pytest.importorskip("mir_eval")
    reference = np.array([[0.0, 10.0], [10.0, 20.0], [20.0, 30.0]])
    estimate = np.array([[0.0, 10.5], [10.5, 25.0], [25.0, 30.0]])

    # Inner boundaries 10, 20 against 10.5, 25: one match at 3 s, none at 0.25 s.
    assert detection(reference, estimate, 3.0) == (0.5, 0.5, 0.5)
    assert detection(reference, estimate, 0.25) == (0.0, 0.0, 0.0)
    assert detection(reference, estimate[:1], 3.0) == (0.0, 0.0, 0.0)


def test_mean_scores_average_tracks_with_a_score() -> None:
    assert mean_scores([(1.0, 0.5, 0.6), None, (0.0, 0.5, 0.2)]) == (
        0.5,
        0.5,
        pytest.approx(0.4),
        2,
    )
    assert mean_scores([None]) is None


def test_meter_counts_tracks_in_three() -> None:
    rows = [
        {"meter": 3, "allin1_meter": 3, "genre": "grunge"},
        {"meter": 3, "allin1_meter": 4, "genre": "pop"},
        {"meter": 4, "allin1_meter": 3, "genre": "pop"},
        {"meter": None, "allin1_meter": 4, "genre": "rock"},
    ]

    summary = meter_summary(rows)

    assert (summary.tracks, summary.three, summary.allin1_agrees) == (4, 2, 1)
    assert summary.allin1_three == 2
    assert summary.genres == {"grunge": 1, "pop": 1}


def test_baseline_reads_both_export_formats(tmp_path: Path) -> None:
    tracks = tmp_path / "candidates.tsv"
    tracks.write_text("pop\tuid-a\t/music/a/uid-a.flac\tArtist\tTitle\n\n")
    windows = tmp_path / "phrase_windows.csv"
    windows.write_text(
        "genre,entity_uid,phrase_index,start_ms,end_ms,bars,kind,structure_confidence\n"
        "pop,uid-a,1,17000,33000,8,body,0.4\n"
        "pop,uid-a,0,1000,17000,8,intro,0.4\n"
        "rock,uid-unknown,0,0,16000,8,intro,0.1\n"
    )
    spike = tmp_path / "spike_phrases.csv"
    spike.write_text(
        "genre,entity_uid,path,phrase_index,start_ms,end_ms,bars,kind,"
        "structure_confidence\n"
        "spike,uid-b,/music/Spike/02. Night Goat.flac,-1,,,,,0.0\n"
    )

    baseline = load_baseline([windows, spike], [tracks])

    assert set(baseline) == {"uid-a", "02. Night Goat"}
    first = baseline["uid-a"]
    assert first.genre == "pop"
    assert first.confidence == 0.4
    assert first.phrases == [
        BaselinePhrase(1.0, 17.0, 8, "intro"),
        BaselinePhrase(17.0, 33.0, 8, "body"),
    ]
    assert first.bar_seconds() == 2.0
    assert baseline["02. Night Goat"].phrases == []
    assert baseline["02. Night Goat"].bar_seconds() is None


def test_runner_lists_refuse_two_files_with_the_same_stem(tmp_path: Path) -> None:
    listed = tmp_path / "tracks.txt"
    listed.write_text(
        "/music/a/01. Intro.flac\n/music/b/01. Intro.mp3\n/music/c.flac\n"
    )

    # Results are written per stem: the second intro would be skipped as done.
    with pytest.raises(ValueError, match="01. Intro"):
        read_list(listed)
    with pytest.raises(ValueError, match="01. Intro"):
        require_unique_stems(["/x/01. Intro.flac", Path("/y/01. Intro.flac")])
    assert require_unique_stems(["/x/a.flac", "/x/b.flac"]) is None


def test_baseline_leaves_out_tracks_that_share_a_stem(tmp_path: Path) -> None:
    phrases = tmp_path / "phrases.csv"
    phrases.write_text(
        "genre,entity_uid,path,phrase_index,start_ms,end_ms,bars,kind\n"
        "pop,uid-a,/music/a/01. Intro.flac,0,0,16000,8,intro\n"
        "rock,uid-b,/music/b/01. Intro.flac,0,0,16000,8,intro\n"
        "rock,uid-c,/music/c/02. Song.flac,0,0,16000,8,intro\n"
    )

    # Matched by stem, either track could be scored against the other's reference.
    with pytest.warns(UserWarning, match="01. Intro"):
        baseline = load_baseline([phrases])

    assert set(baseline) == {"02. Song"}


def test_read_list_skips_blank_lines(tmp_path: Path) -> None:
    listed = tmp_path / "tracks.txt"
    listed.write_text("/audio/a.flac\n\n  /audio/Track #2.flac  \n")

    assert read_list(listed) == ["/audio/a.flac", "/audio/Track #2.flac"]


def test_report_scores_a_track_against_all_in_one() -> None:
    pytest.importorskip("mir_eval")
    grid = _grid(500, 120)
    record = {
        "downbeats_ms": [500, 2500, 4500],
        "rust": _profile([(0, 4), (16, 8), (48, 8), (80, 8)], grid, 500),
    }
    madmom = [0.5, 2.5]

    rows = evaluate_structure.evaluation_rows(
        {"track": record, "no-reference": record},
        {"track": ALLIN1},
        {"track": madmom},
        {},
    )
    text = evaluate_structure.report(rows)

    assert len(rows) == 1
    row = rows[0]
    assert (row["group"], row["arbiter"], row["anchored"]) == ("phrase", True, True)
    assert row["grid_hit"] == 1.0
    assert row["model_hit"] == 1.0
    # The phrases are All-In-One's sections, but only 0.5 of the five boundaries
    # (0.5 to 56.5 s) is one of the two downbeats this reference lists.
    assert row["boundary_hit"] == 0.2
    assert row["sections 3 s"] == (1.0, 1.0, 1.0)
    assert row["baseline sections 3 s"] is None
    assert "| Tracks with phrases | 0 of 0 | 1 of 1 |" in text
    assert "1 of 1 · 1 of 1 (100%)" in text


def test_beat_this_records_use_the_analyzer_conventions() -> None:
    assert beat_this_beats.milliseconds([0.0004, 0.5, 0.5002, 1.25]) == [1, 500, 1250]
    assert beat_this_beats.tracker_name("small0", True) == "beat-this-small0-dbn"
    assert (
        beat_this_beats.tracker_name("/ckpt/final0.ckpt", False) == "beat-this-final0"
    )


def test_rerun_payload_adds_the_meter_only_when_asked() -> None:
    record = {
        "tracker": "beat-this-small0-dbn",
        "beats_ms": [500, 1000, 1500, 2000, 2500, 3000, 3500],
        "downbeats_ms": [500, 2000, 3500],
    }

    assert rerun_crate_cli.beats_payload(record, meter=False)["beats_per_bar"] is None
    assert rerun_crate_cli.beats_payload(record, meter=True) == {
        "tracker": "beat-this-small0-dbn",
        "beats_ms": record["beats_ms"],
        "downbeats_ms": record["downbeats_ms"],
        "beats_per_bar": 3,
    }
    # A record that has the model's meter keeps it.
    assert (
        rerun_crate_cli.beats_payload({**record, "beats_per_bar": 4}, meter=True)[
            "beats_per_bar"
        ]
        == 4
    )


def test_crate_cli_gets_the_beats_and_answers_the_profile(tmp_path: Path) -> None:
    calls = tmp_path / "calls.json"
    binary = tmp_path / "crate-cli"
    binary.write_text(
        f"#!{sys.executable}\n"
        "import json, sys\n"
        "args = sys.argv[1:]\n"
        "beats = json.load(open(args[args.index('--beats') + 1]))\n"
        f"json.dump({{'args': args[:3], 'beats': beats}}, open({str(calls)!r}, 'w'))\n"
        "print(json.dumps({'mixProfile': {'quality': 'full', 'downbeatAnchorMs': 500,"
        " 'analyzerVersion': 'ignored'}}))\n"
    )
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR)
    payload = {"tracker": "t", "beats_ms": [500], "downbeats_ms": [500]}

    result = analyze_with_beats.run_crate_cli(binary, "/audio/a.flac", payload)

    assert json.loads(calls.read_text()) == {
        "args": ["analyze", "--file", "/audio/a.flac"],
        "beats": payload,
    }
    assert result["quality"] == "full"
    assert result["downbeatAnchorMs"] == 500
    assert result["phrases"] is None
    assert "analyzerVersion" not in result
    assert result["cpu_seconds"] >= 0.0


def test_foote_terms_are_zero_where_the_production_novelty_is() -> None:
    bars = 16
    chroma = np.zeros((bars, 12))
    chroma[:8, 0] = 1.0
    chroma[8:, 6] = 1.0
    mfcc = np.ones((bars, 13))
    gaps = [False] * bars
    gaps[12] = True

    harmony, timbre = novelty_prototype.foote_terms(chroma, mfcc, gaps)

    assert len(harmony) == len(timbre) == bars + 1
    assert harmony[8] == pytest.approx(1.0)
    # Edges closer than four bars and gap bars get nothing; a constant MFCC is flat.
    for boundary in (0, 1, 2, 3, 13, 14, 15, 16, 12):
        assert harmony[boundary] == 0.0
    assert all(value == 0.0 for value in timbre)
    silent, _ = novelty_prototype.foote_terms(
        np.zeros((bars, 12)), mfcc, [False] * bars
    )
    assert all(math.isfinite(value) and value == 0.0 for value in silent)


def test_foote_timbre_keeps_a_static_loop_flat() -> None:
    # Variant B standardises the MFCC under the production MFCC_STD_FLOOR, so the
    # bar-to-bar noise of a static loop does not grow into timbre novelty.
    rng = np.random.default_rng(7)
    bars = 16
    mfcc = np.linspace(-20.0, 5.0, 13) + rng.normal(0.0, 0.05, (bars, 13))

    _, timbre = novelty_prototype.foote_terms(np.ones((bars, 12)), mfcc, [False] * bars)

    assert max(timbre) < 0.01


def test_variant_a_is_the_production_novelty() -> None:
    from crate.smart_mix import structure

    rng = np.random.default_rng(3)
    chroma, mfcc = rng.random((20, 12)), rng.normal(size=(20, 13))
    gaps = [False] * 20

    assert novelty_prototype.extra_terms(
        "A", chroma, mfcc, gaps
    ) == structure._harmony_timbre(chroma, mfcc, gaps)
    with pytest.raises(ValueError, match="variant"):
        novelty_prototype.extra_terms("C", chroma, mfcc, gaps)
    assert novelty_prototype.combined_novelty(
        [1.0, 0.0], [0.5, 0.0], [0.25, 0.0], 2.0, 8.0
    ) == [4.0, 0.0]


def test_best_variants_keep_the_base_precision() -> None:
    def scores(precision: float, f1: float) -> dict:
        return {"tune": {"3s": [precision, 0.0, f1]}}

    results = {
        "base:0.0:0.0:1.0": scores(0.5, 0.40),
        "A:2.0:8.0:4.0": scores(0.55, 0.53),
        "A:0.0:12.0:1.0": scores(0.45, 0.60),
        "B:2.0:8.0:4.0": scores(0.50, 0.45),
    }

    assert novelty_prototype.best_variants(results, "base:0.0:0.0:1.0") == [
        "A:2.0:8.0:4.0",
        "B:2.0:8.0:4.0",
    ]
