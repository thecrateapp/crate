"""Shared inputs and metrics of the structure evaluation (Smart Mix 3, SMB.PR3).

Pure functions over the JSON files the runners write, one per track and named after
the audio file's stem; nothing here decodes audio or loads a model.

- All-In-One (``run_allin1.py``): ``segments`` (``start``, ``end``, ``label``),
  ``beats``, ``beat_positions``, ``downbeats`` and ``bpm``, times in seconds.
- madmom (``madmom_downbeats.py``): ``beats``, ``[seconds, position]`` pairs with
  position 1 on a downbeat.
- Beat This! (``beat_this_beats.py``) and analyzer runs (``analyze_with_beats.py``,
  ``rerun_crate_cli.py``): ``tracker``, ``beats_ms`` and ``downbeats_ms``; analyzer runs
  add ``rust`` (and ``python``), the profile fields the evaluation reads, in camelCase.

The baseline is the analyzer being replaced, read from CSV exports of its phrases.
"""

from __future__ import annotations

import bisect
import csv
import json
import statistics
import warnings
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

# All-In-One's silence before and after the music: not sections.
EDGE_LABELS = frozenset({"start", "end"})
# Genres mixed by crossfade rather than by phrase (Diego, 2026-11-05: extreme metal).
CROSSFADE_GENRES = frozenset(
    {"black metal", "death metal", "metalcore", "industrial metal"}
)
# A downbeat matches one of the other source within 70 ms; a phrase boundary matches
# an All-In-One downbeat within 120 ms.
DOWNBEAT_TOLERANCE_S = 0.07
BOUNDARY_TOLERANCE_S = 0.12
# Share of matching downbeats for a track to count as right, and for All-In-One and
# madmom to agree (the arbiter).
AGREEMENT_SHARE = 0.9
# mir_eval boundary detection windows; None is one bar of the track.
SECTION_WINDOWS: tuple[tuple[str, float | None], ...] = (
    ("0.5 s", 0.5),
    ("3 s", 3.0),
    ("1 bar", None),
)
BEATS_PER_BAR = 4
DEFAULT_BAR_SECONDS = 2.0


def read_json_dir(folder: Path) -> dict[str, dict[str, Any]]:
    """Every ``<stem>.json`` of ``folder``, by stem."""
    return {
        path.stem: json.loads(path.read_text())
        for path in sorted(folder.glob("*.json"))
    }


def read_list(path: Path) -> list[str]:
    """The non-empty lines of a list file, stripped (paths may hold ``#``)."""
    return [line.strip() for line in path.read_text().splitlines() if line.strip()]


def shared(
    reference: Sequence[float],
    candidate: Sequence[float],
    tolerance: float = DOWNBEAT_TOLERANCE_S,
) -> float:
    """Share of ``reference`` times with a ``candidate`` time within ``tolerance``."""
    if not reference or not candidate:
        return 0.0
    ordered = sorted(candidate)
    hits = 0
    for time in reference:
        index = bisect.bisect_left(ordered, time)
        near = (ordered[j] for j in (index - 1, index) if 0 <= j < len(ordered))
        hits += any(abs(time - other) <= tolerance for other in near)
    return hits / len(reference)


def allin1_meter(result: Mapping[str, Any]) -> int:
    """All-In-One's beats per bar: the highest beat position it gives."""
    return max(result.get("beat_positions") or [0])


def section_intervals(result: Mapping[str, Any]) -> np.ndarray:
    """All-In-One's sections as ``(start, end)`` rows, edge silence left out."""
    rows = [
        (segment["start"], segment["end"])
        for segment in result["segments"]
        if segment["label"] not in EDGE_LABELS
    ]
    return np.array(rows, dtype=float).reshape(-1, 2)


def section_changes(
    result: Mapping[str, Any],
) -> tuple[list[float], list[float]]:
    """All-In-One's inner section boundaries, and those where the label changes."""
    segments = [(s["start"], s["end"], s["label"]) for s in result["segments"]]
    inner = [
        (left, right)
        for left, right in zip(segments, segments[1:])
        if left[2] not in EDGE_LABELS and right[2] not in EDGE_LABELS
    ]
    return (
        [right[0] for _left, right in inner],
        [right[0] for left, right in inner if left[2] != right[2]],
    )


def madmom_downbeat_times(record: Mapping[str, Any]) -> list[float]:
    return [float(time) for time, position in record["beats"] if position == 1]


def model_downbeat_times(record: Mapping[str, Any]) -> list[float]:
    return [ms / 1000 for ms in record.get("downbeats_ms") or []]


def beat_seconds(grid_ms: Sequence[int]) -> float:
    return statistics.median(b - a for a, b in zip(grid_ms, grid_ms[1:])) / 1000


def bar_seconds(profile: Mapping[str, Any]) -> float:
    """Four beats of the profile's grid (two seconds without a grid)."""
    grid = profile.get("beatGridMs") or []
    if len(grid) <= 2:
        return DEFAULT_BAR_SECONDS
    return BEATS_PER_BAR * beat_seconds(grid)


def phrase_intervals(profile: Mapping[str, Any]) -> np.ndarray:
    """A profile's phrases as ``(start, end)`` rows in seconds.

    The last phrase ends on the grid beat after its last bar, or at its start plus its
    bars at the median beat when the grid stops first.
    """
    grid, phrases = profile.get("beatGridMs") or [], profile.get("phrases") or []
    if not phrases or not grid:
        return np.zeros((0, 2))
    starts = [phrase["startMs"] / 1000 for phrase in phrases]
    last = phrases[-1]
    end_beat = last["startBeat"] + BEATS_PER_BAR * last["bars"]
    if end_beat < len(grid):
        end = grid[end_beat] / 1000
    else:
        end = starts[-1] + BEATS_PER_BAR * last["bars"] * beat_seconds(grid)
    edges = [*starts, end]
    return np.array(list(zip(edges, edges[1:])), dtype=float)


def baseline_intervals(phrases: Sequence[BaselinePhrase]) -> np.ndarray:
    return np.array(
        [(phrase.start, phrase.end) for phrase in phrases], dtype=float
    ).reshape(-1, 2)


def interval_boundaries(intervals: np.ndarray) -> list[float]:
    """Every start and end, the first start and last end included, to the ms."""
    return sorted({round(float(time), 3) for time in intervals.ravel()})


def grid_downbeat_times(profile: Mapping[str, Any]) -> list[float] | None:
    """The anchor and every fourth grid beat from it, or None without a downbeat."""
    grid, anchor = profile.get("beatGridMs") or [], profile.get("downbeatAnchorMs")
    if anchor is None or anchor not in grid:
        return None
    first = grid.index(anchor) % BEATS_PER_BAR
    return [grid[i] / 1000 for i in range(first, len(grid), BEATS_PER_BAR)]


def grid_hit(profile: Mapping[str, Any], downbeats: Sequence[float]) -> float | None:
    """Share of the reference downbeats inside the grid that the grid's bars hit."""
    ours = grid_downbeat_times(profile)
    if ours is None:
        return None
    grid = profile["beatGridMs"]
    low = grid[0] / 1000 - DOWNBEAT_TOLERANCE_S
    high = grid[-1] / 1000 + DOWNBEAT_TOLERANCE_S
    return shared([d for d in downbeats if low <= d <= high], ours)


def detection(
    reference: np.ndarray, estimate: np.ndarray, window: float
) -> tuple[float, float, float]:
    """mir_eval boundary precision, recall and F1 (first and last boundary trimmed)."""
    if len(reference) < 2 or len(estimate) < 2:
        return 0.0, 0.0, 0.0
    import mir_eval

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return mir_eval.segment.detection(reference, estimate, window=window, trim=True)


def mean_scores(
    scores: Iterable[tuple[float, float, float] | None],
) -> tuple[float, float, float, int] | None:
    """Per-track mean precision, recall and F1, and how many tracks had a score."""
    present = [score for score in scores if score is not None]
    if not present:
        return None
    precision, recall, f1 = (statistics.mean(s[i] for s in present) for i in range(3))
    return precision, recall, f1, len(present)


@dataclass(frozen=True)
class MeterSummary:
    tracks: int
    three: int
    allin1_agrees: int
    allin1_three: int
    genres: Counter[str] = field(default_factory=Counter)


def meter_summary(rows: Sequence[Mapping[str, Any]]) -> MeterSummary:
    """Tracks the DBN reads in three, how many All-In-One also reads so, and its own."""
    three = [row for row in rows if row["meter"] == 3]
    return MeterSummary(
        tracks=len(rows),
        three=len(three),
        allin1_agrees=sum(row["allin1_meter"] == 3 for row in three),
        allin1_three=sum(row["allin1_meter"] == 3 for row in rows),
        genres=Counter(row["genre"] for row in three),
    )


@dataclass(frozen=True)
class BaselinePhrase:
    start: float
    end: float
    bars: int
    kind: str


@dataclass
class BaselineTrack:
    entity_uid: str
    genre: str
    path: str
    phrases: list[BaselinePhrase] = field(default_factory=list)
    confidence: float | None = None

    @property
    def stem(self) -> str:
        return Path(self.path).stem

    def bar_seconds(self) -> float | None:
        if not self.phrases:
            return None
        return statistics.median((p.end - p.start) / p.bars for p in self.phrases)


def load_baseline(
    phrase_files: Sequence[Path], track_files: Sequence[Path] = ()
) -> dict[str, BaselineTrack]:
    """The baseline analyzer's phrases, by audio file stem.

    ``track_files`` are tab-separated, without header: genre, entity UID and path,
    then anything. ``phrase_files`` are CSV exports with ``entity_uid``, ``start_ms``,
    ``end_ms``, ``bars`` and ``kind``, and optionally ``genre``, ``path``,
    ``phrase_index`` and ``structure_confidence``. A row with phrase index -1 or no
    ``start_ms`` is a track the baseline gave no phrases. Rows of a track with no path
    in either file are skipped.
    """
    tracks: dict[str, BaselineTrack] = {}
    for track_file in track_files:
        for line in track_file.read_text().splitlines():
            if not line.strip():
                continue
            genre, uid, path = line.split("\t")[:3]
            tracks[uid] = BaselineTrack(entity_uid=uid, genre=genre, path=path)
    for phrase_file in phrase_files:
        with phrase_file.open(newline="") as handle:
            for row in csv.DictReader(handle):
                uid = row["entity_uid"]
                track = tracks.get(uid)
                if track is None:
                    if not row.get("path"):
                        continue
                    track = tracks[uid] = BaselineTrack(
                        entity_uid=uid, genre=row.get("genre") or "", path=row["path"]
                    )
                if row.get("structure_confidence"):
                    track.confidence = float(row["structure_confidence"])
                if row.get("phrase_index") == "-1" or not row.get("start_ms"):
                    continue
                track.phrases.append(
                    BaselinePhrase(
                        start=int(row["start_ms"]) / 1000,
                        end=int(row["end_ms"]) / 1000,
                        bars=int(row["bars"]),
                        kind=row["kind"],
                    )
                )
    for track in tracks.values():
        track.phrases.sort(key=lambda phrase: (phrase.start, phrase.end))
    return {track.stem: track for track in tracks.values()}
