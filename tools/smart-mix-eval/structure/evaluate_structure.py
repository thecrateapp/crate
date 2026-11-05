#!/usr/bin/env python3
"""Score Smart Mix phrases and downbeats against All-In-One, with madmom as arbiter.

For each analyzed track with an All-In-One result:

- **Downbeat.** The grid's bars (the anchor and every fourth grid beat) are right when
  they hit at least 90 % of All-In-One's downbeats inside the grid within 70 ms.
  Reported as coverage (tracks with a downbeat) and accuracy among them: abstaining is
  allowed, a wrong anchor is not. The model's own downbeats are scored the same way.
- **Phrase boundaries on downbeats.** At least 90 % of the phrase boundaries fall within
  120 ms of an All-In-One downbeat. The baseline is scored on this too.
- **Sections.** Phrase boundaries against All-In-One's section boundaries with
  ``mir_eval.segment.detection`` (one-to-one matching, first and last boundary trimmed)
  at 0.5 s, 3 s and one bar of the track; precision, recall and F1 averaged per track.
- **Arbiter subset.** Tracks where All-In-One and madmom share at least 90 % of their
  downbeats: there the reference is less likely to be wrong.
- **Meter.** Tracks the DBN reads in three, and what All-In-One says about them.

Needs ``numpy`` and ``mir_eval`` only. Writes a Markdown report and the rows as JSON.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from structure_eval import (
    AGREEMENT_SHARE,
    BOUNDARY_TOLERANCE_S,
    CROSSFADE_GENRES,
    SECTION_WINDOWS,
    BaselineTrack,
    allin1_meter,
    bar_seconds,
    baseline_intervals,
    detection,
    grid_hit,
    interval_boundaries,
    load_baseline,
    madmom_downbeat_times,
    mean_scores,
    meter_summary,
    model_downbeat_times,
    phrase_intervals,
    read_json_dir,
    section_intervals,
    shared,
)


def track_row(
    stem: str,
    record: Mapping[str, Any],
    allin1: Mapping[str, Any],
    madmom: Sequence[float] | None,
    baseline: BaselineTrack | None,
    crossfade_genres: frozenset[str],
) -> dict[str, Any]:
    """Every metric of one track; ``profile`` is the analyzer record's ``rust`` part."""
    profile = record.get("rust") or {}
    reference_downbeats = allin1["downbeats"]
    genre = baseline.genre if baseline else "?"
    model = model_downbeat_times(record)
    row: dict[str, Any] = {
        "stem": stem,
        "genre": genre,
        "group": "crossfade" if genre in crossfade_genres else "phrase",
        "quality": profile.get("quality"),
        "meter": profile.get("timeSignature"),
        "allin1_meter": allin1_meter(allin1),
        "has_madmom": madmom is not None,
        "arbiter": madmom is not None
        and shared(reference_downbeats, madmom) >= AGREEMENT_SHARE,
        "model_hit": shared(reference_downbeats, model) if model else None,
        "anchored": profile.get("downbeatAnchorMs") is not None,
        "grid_hit": grid_hit(profile, reference_downbeats),
        "phrases": len(profile.get("phrases") or []),
        "baseline_known": baseline is not None,
        "baseline_phrases": bool(baseline and baseline.phrases),
    }
    reference = section_intervals(allin1)
    estimate = phrase_intervals(profile)
    previous = (
        baseline_intervals(baseline.phrases)
        if baseline and baseline.phrases
        else np.zeros((0, 2))
    )
    bar = bar_seconds(profile)
    previous_bar = (baseline.bar_seconds() if baseline else None) or bar
    for key, intervals in (
        ("boundary_hit", estimate),
        ("baseline_boundary_hit", previous),
    ):
        if len(intervals):
            row[key] = shared(
                interval_boundaries(intervals),
                reference_downbeats,
                BOUNDARY_TOLERANCE_S,
            )
    for name, window in SECTION_WINDOWS:
        row[f"sections {name}"] = (
            detection(reference, estimate, window or bar) if len(estimate) else None
        )
        row[f"baseline sections {name}"] = (
            detection(reference, previous, window or previous_bar)
            if len(previous)
            else None
        )
    return row


def evaluation_rows(
    records: Mapping[str, Mapping[str, Any]],
    allin1: Mapping[str, Mapping[str, Any]],
    madmom: Mapping[str, Sequence[float]],
    baseline: Mapping[str, BaselineTrack],
    crossfade_genres: frozenset[str] = CROSSFADE_GENRES,
) -> list[dict[str, Any]]:
    return [
        track_row(
            stem,
            record,
            allin1[stem],
            madmom.get(stem),
            baseline.get(stem),
            crossfade_genres,
        )
        for stem, record in sorted(records.items())
        if stem in allin1
    ]


def _share(count: int, total: int) -> str:
    return f"{count} of {total}"


def _scores(rows: Sequence[Mapping[str, Any]], key: str) -> str:
    summary = mean_scores(row[key] for row in rows)
    if summary is None:
        return "—"
    precision, recall, f1, tracks = summary
    return f"{precision:.2f} / {recall:.2f} / {f1:.2f} ({tracks})"


def group_table(
    title: str, rows: Sequence[Mapping[str, Any]], labels: tuple[str, str]
) -> list[str]:
    count = len(rows)
    if not count:
        return []
    anchored = [row for row in rows if row["anchored"]]
    right = sum(1 for row in anchored if (row["grid_hit"] or 0.0) >= AGREEMENT_SHARE)
    known = [row for row in rows if row["baseline_known"]]
    with_baseline = [row for row in known if row["baseline_phrases"]]
    with_phrases = [row for row in rows if "boundary_hit" in row]
    modelled = [row for row in rows if row["model_hit"] is not None]
    agreed = sum(row["model_hit"] >= AGREEMENT_SHARE for row in modelled)
    on_downbeats = sum(row["boundary_hit"] >= AGREEMENT_SHARE for row in with_phrases)
    baseline_on_downbeats = sum(
        row.get("baseline_boundary_hit", 0.0) >= AGREEMENT_SHARE
        for row in with_baseline
    )
    accuracy = f"{right / len(anchored):.0%}" if anchored else "—"
    lines = [
        f"## {title} ({count} tracks)",
        "",
        f"| | {labels[0]} | {labels[1]} |",
        "|---|---:|---:|",
        f"| Tracks with phrases | {_share(len(with_baseline), len(known))} | "
        f"{_share(sum(row['phrases'] > 0 for row in rows), count)} |",
        f"| Model downbeats on All-In-One's (≥90 %) | — | {_share(agreed, len(modelled))} |",
        f"| Downbeat: coverage · right among anchored | — | "
        f"{_share(len(anchored), count)} · {_share(right, len(anchored))} ({accuracy}) |",
        "| Phrase boundaries on All-In-One downbeats (≥90 %) | "
        f"{_share(baseline_on_downbeats, len(with_baseline))} | "
        f"{_share(on_downbeats, len(with_phrases))} |",
    ]
    for name, _window in SECTION_WINDOWS:
        lines.append(
            f"| Sections ±{name}: P / R / F1, mean per track (tracks) | "
            f"{_scores(rows, f'baseline sections {name}')} | "
            f"{_scores(rows, f'sections {name}')} |"
        )
    qualities = dict(Counter(row["quality"] for row in rows))
    lines.append(f"| Quality | | {qualities} |")
    return [*lines, ""]


def report(
    rows: Sequence[Mapping[str, Any]],
    labels: tuple[str, str] = ("Baseline", "Analysis"),
) -> str:
    phrase = [row for row in rows if row["group"] == "phrase"]
    groups: list[tuple[str, Callable[[Mapping[str, Any]], bool]]] = [
        ("Phrase-mixed genres", lambda row: row["group"] == "phrase"),
        ("Phrase-mixed genres, with arbiter", lambda row: row["arbiter"]),
    ]
    lines = [
        "# Smart Mix structure against All-In-One",
        "",
        f"Tracks with an All-In-One result: {len(rows)}. With madmom: "
        f"{sum(row['has_madmom'] for row in rows)}. With arbiter (All-In-One and madmom "
        f"share ≥90 % of their downbeats): {sum(row['arbiter'] for row in rows)}.",
        "All-In-One is an automatic reference: these numbers measure agreement with it, "
        "not absolute accuracy, and the arbiter subset is selected by agreement.",
        "",
    ]
    for title, keep in groups:
        lines += group_table(title, [row for row in phrase if keep(row)], labels)
    lines += group_table(
        "Crossfade genres", [row for row in rows if row["group"] == "crossfade"], labels
    )
    meter = meter_summary(rows)
    lines += [
        f"## Bars of three beats according to the DBN: {meter.three} of {meter.tracks} "
        "tracks",
        "",
    ]
    if meter.three:
        lines += [
            f"- Genres: {dict(meter.genres)}",
            f"- All-In-One also hears three beats in {meter.allin1_agrees} of them.",
        ]
    lines += [
        f"- All-In-One hears three beats in {meter.allin1_three} tracks in all.",
        "",
    ]
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--analysis", type=Path, required=True, help="analyzer records, <stem>.json"
    )
    parser.add_argument(
        "--allin1", type=Path, required=True, help="All-In-One results, <stem>.json"
    )
    parser.add_argument(
        "--madmom",
        type=Path,
        action="append",
        default=[],
        help="madmom results, <stem>.json (repeat for several folders)",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        action="append",
        default=[],
        help="CSV of the baseline analyzer's phrases (repeatable)",
    )
    parser.add_argument(
        "--tracks",
        type=Path,
        action="append",
        default=[],
        help="TSV of genre, entity UID and path for the baseline CSVs (repeatable)",
    )
    parser.add_argument(
        "--crossfade-genres",
        default=",".join(sorted(CROSSFADE_GENRES)),
        help="comma-separated genres mixed by crossfade, reported apart",
    )
    parser.add_argument("--baseline-label", default="Baseline")
    parser.add_argument("--label", default="Analysis")
    parser.add_argument("--report", type=Path, required=True, help="Markdown report")
    parser.add_argument("--rows", type=Path, help="per-track rows as JSON")
    args = parser.parse_args(argv)

    madmom: dict[str, list[float]] = {}
    for folder in args.madmom:
        for stem, record in read_json_dir(folder).items():
            madmom[stem] = madmom_downbeat_times(record)
    rows = evaluation_rows(
        read_json_dir(args.analysis),
        read_json_dir(args.allin1),
        madmom,
        load_baseline(args.baseline, args.tracks),
        frozenset(g.strip() for g in args.crossfade_genres.split(",") if g.strip()),
    )
    text = report(rows, (args.baseline_label, args.label))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(text)
    if args.rows:
        args.rows.write_text(json.dumps(rows, indent=1, default=str))
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
