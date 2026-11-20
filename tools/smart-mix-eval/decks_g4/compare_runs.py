"""Before and after the G4 fixes: the Decks runs of two harness runs, side by side.

For each pair and variant it reads both runs' ``report.json`` and the metrics of
``metrics.py``, and prints the report's before/after tables for G4's findings:

1. the handover lead: where Auto DJ handed over, the plan's start, and how short
   the lead was (the director's lateness);
2. the start: the incoming deck's offset from the plan at the start (the
   trace's alignment), at the buffer sizes rendered after;
3. ReplayGain and staging: the incoming deck's staging and the loudness step and
   dip with ReplayGain on, against Android's renderer.

usage:
    compare_runs.py --g4 <decks-g4 directory> --before renders --after renders-after \\
        --before-metrics metrics/metrics.json --after-metrics metrics-after/metrics.json \\
        [--buffers 256=renders-after-256:metrics-after-256/metrics.json ...]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean, median
from typing import Any

import tables

VARIANTS = ("v3", "v2", "v3-norg")


def load_reports(runs: Path, pairs: list[str]) -> dict[tuple[str, str], dict[str, Any]]:
    reports = {}
    for pair in pairs:
        for variant in VARIANTS:
            path = runs / pair / variant / "report.json"
            if path.is_file():
                reports[(pair, variant)] = json.loads(path.read_text())
    return reports


def short_by(report: dict[str, Any]) -> float:
    armed = next((e for e in report["events"] if e["state"] == "Armed"), None)
    if armed is None:
        return 0.0
    return max(0.0, armed["outgoingMs"] - report["plannedStartOutgoingMs"]) / 1000.0


def offsets(measures: dict, pairs: list[str], variants=("v3", "v2")) -> list[float]:
    values = []
    for pair in pairs:
        for variant in variants:
            alignment = (
                measures.get(pair, {}).get(f"decks-{variant}", {}).get("alignment")
                or {}
            )
            if "offsetAtStartMs" in alignment:
                values.append(alignment["offsetAtStartMs"])
    return values


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--g4", type=Path, required=True)
    parser.add_argument("--before", default="renders")
    parser.add_argument("--after", default="renders-after")
    parser.add_argument("--before-metrics", default="metrics/metrics.json")
    parser.add_argument("--after-metrics", default="metrics-after/metrics.json")
    parser.add_argument(
        "--buffers", nargs="*", default=[], metavar="FRAMES=RUNS:METRICS"
    )
    args = parser.parse_args(argv)
    root = args.g4
    pairs = [
        pair["id"] for pair in json.loads((root / "pairs.json").read_text())["pairs"]
    ]
    before = load_reports(root / args.before, pairs)
    after = load_reports(root / args.after, pairs)
    measures_before = json.loads((root / args.before_metrics).read_text())
    measures_after = json.loads((root / args.after_metrics).read_text())
    out: list[str] = []

    out += [
        "### Finding 1: the handover lead",
        "",
        "| Pair | Variant | Handover before → after (s) | Plan start (s) | Lead short by, before → after (s) |"
        " Late start, before → after (ms) |",
        "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for pair in pairs:
        for variant in ("v3", "v2"):
            b, a = before.get((pair, variant)), after.get((pair, variant))
            if not b or not a:
                continue
            handover = [
                next(
                    (
                        e["outgoingMs"] / 1000
                        for e in r["events"]
                        if e["state"] == "Armed"
                    ),
                    None,
                )
                for r in (b, a)
            ]
            out.append(
                f"| {pair} | {variant} | {tables.cell(handover[0])} → {tables.cell(handover[1])} |"
                f" {tables.cell(a['plannedStartOutgoingMs'] / 1000)} |"
                f" {tables.cell(short_by(b))} → {tables.cell(short_by(a))} |"
                f" {tables.cell(b['lateMs'], 0)} → {tables.cell(a['lateMs'], 0)} |"
            )
    out.append("")

    out += ["### Finding 2: the incoming deck's offset from the plan at the start", ""]
    out += [
        "| Run | Buffer (frames) | Starts | Offset at start, ms: median / min / max | Within 1 ms |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    rows = [
        ("before", 1024, offsets(measures_before, pairs)),
        ("after", 1024, offsets(measures_after, pairs)),
    ]
    for spec in args.buffers:
        frames, _, rest = spec.partition("=")
        _, _, metrics_path = rest.partition(":")
        rows.append(
            (
                "after",
                int(frames),
                offsets(json.loads((root / metrics_path).read_text()), pairs),
            )
        )
    for name, frames, values in rows:
        if not values:
            continue
        out.append(
            f"| {name} | {frames} | {len(values)} | {median(values):.1f} / {min(values):.1f} /"
            f" {max(values):.1f} | {sum(abs(v) <= 1.0 for v in values)} |"
        )
    out.append("")

    out += [
        "### Finding 3: ReplayGain and staging (v3, ReplayGain on)",
        "",
        "| Pair | ReplayGain difference (dB) | Incoming staging: plan → residual (dB) | Step, A / D before / D after (LU) |"
        " Dip, A / D before / D after (LU) |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for pair in pairs:
        a = after.get((pair, "v3"))
        if not a:
            continue
        plan_db = min(0.0, (a.get("playedPlan") or a["askedPlan"])["incomingGainDb"])
        android = measures_after[pair]["android-v3"]
        d_before = measures_before[pair]["decks-v3"]
        d_after = measures_after[pair]["decks-v3"]
        out.append(
            f"| {pair} | {tables.cell(a.get('replayGainDifferenceDb'))} |"
            f" {plan_db:.1f} → {a['incomingStagingDb']:.1f} |"
            f" {tables.cell(android.get('levelStepLuAbs'))} / {tables.cell(d_before.get('levelStepLuAbs'))} /"
            f" {tables.cell(d_after.get('levelStepLuAbs'))} |"
            f" {tables.cell(android.get('dipLu'))} / {tables.cell(d_before.get('dipLu'))} /"
            f" {tables.cell(d_after.get('dipLu'))} |"
        )
    for metric in ("levelStepLuAbs", "dipLu"):
        values = {
            name: [m[p][key].get(metric) for p in pairs]
            for name, m, key in (
                ("android", measures_after, "android-v3"),
                ("before", measures_before, "decks-v3"),
                ("after", measures_after, "decks-v3"),
            )
        }
        out.append(
            f"- {tables.LABELS[metric]} mean: Android {mean(values['android']):.2f},"
            f" Decks before {mean(values['before']):.2f}, after {mean(values['after']):.2f}"
        )
    out.append("")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
