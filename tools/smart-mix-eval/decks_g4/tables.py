"""Markdown tables of the Decks G4 and G4b report from the measurements.

Reads ``metrics.json`` (``metrics.py``), the Decks runs (``report.json`` and
``deviation.csv`` of ``decksg4render_test.cpp``), ``limit-agreement.json``,
``survey.json`` and ``pairs.json``, and prints the report's tables. Tracks are
named by the first characters of their uid, never by title.

usage:
    tables.py --g4 <decks-g4 directory> [--runs runs] > tables.md
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter
from pathlib import Path
from statistics import mean, median
from typing import Any

# listen_metrics.SAME_WITHIN, LOWER_IS_BETTER
SAME_WITHIN = {
    "beatClashMs": 100.0,
    "phaseErrorMsMedian": 5.0,
    "lockedShare": 0.05,
    "mixIbiCv": 0.02,
    "voiceOnVoiceMs": 480.0,
    "bassOnBassMs": 480.0,
    "levelStepLuAbs": 0.5,
    "bumpLu": 0.5,
    "dipLu": 0.5,
    "maxShortTermSlopeLuPerS": 0.5,
}
HIGHER_IS_BETTER = {"lockedShare"}
LABELS = {
    "beatClashMs": "Beat clash (ms)",
    "phaseErrorMsMedian": "Phase error, median (ms)",
    "lockedShare": "Beats within 25 ms",
    "mixIbiCv": "Mix beat interval CV",
    "voiceOnVoiceMs": "Voice on voice (ms)",
    "bassOnBassMs": "Bass on bass (ms)",
    "levelStepLuAbs": "Loudness step, abs (LU)",
    "bumpLu": "Loudness bump (LU)",
    "dipLu": "Loudness dip (LU)",
    "maxShortTermSlopeLuPerS": "Steepest change (LU/s)",
}
SM5_FOUR = ("beatClashMs", "voiceOnVoiceMs", "levelStepLuAbs", "dipLu")


def sign_test(better: int, worse: int) -> float:
    """Two-sided binomial sign test."""
    n = better + worse
    if n == 0:
        return 1.0
    k = min(better, worse)
    tail = sum(math.comb(n, i) for i in range(0, k + 1)) / 2**n
    return min(1.0, 2 * tail)


def cell(value: Any, digits: int = 1) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float) and abs(value) >= 100:
        return f"{value:,.0f}"
    return f"{value:.{digits}f}" if isinstance(value, float) else str(value)


def short(uid: str) -> str:
    return uid[:8]


def compare(current: dict, baseline: dict, metrics=tuple(SAME_WITHIN)) -> dict[str, int]:
    """+1 better, -1 worse, 0 same for each metric of one pair."""
    out = {}
    for metric in metrics:
        a, b = current.get(metric), baseline.get(metric)
        if a is None or b is None:
            continue
        delta = (a - b) * (1 if metric in HIGHER_IS_BETTER else -1)
        out[metric] = 1 if delta > SAME_WITHIN[metric] else (-1 if delta < -SAME_WITHIN[metric] else 0)
    return out


def net(signs: dict[str, int]) -> int:
    total = sum(signs.get(metric, 0) for metric in SM5_FOUR)
    return 1 if total > 0 else (-1 if total < 0 else 0)


def comparison_table(measures: dict, pairs: list, current: str, baseline: str) -> list[str]:
    lines = [
        f"| Metric | {current} mean | {baseline} mean | better / same / worse | sign test p |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    nets = Counter()
    for metric in SAME_WITHIN:
        a = [measures[p["id"]][current].get(metric) for p in pairs]
        b = [measures[p["id"]][baseline].get(metric) for p in pairs]
        counts = Counter()
        for pair in pairs:
            sign = compare(measures[pair["id"]][current], measures[pair["id"]][baseline], (metric,))
            if metric in sign:
                counts[sign[metric]] += 1
        a_values = [value for value in a if value is not None]
        b_values = [value for value in b if value is not None]
        lines.append(
            f"| {LABELS[metric]} | {cell(mean(a_values), 2) if a_values else 'n/a'} |"
            f" {cell(mean(b_values), 2) if b_values else 'n/a'} |"
            f" {counts[1]} / {counts[0]} / {counts[-1]} |"
            f" {sign_test(counts[1], counts[-1]):.2f} |"
        )
    for pair in pairs:
        nets[net(compare(measures[pair["id"]][current], measures[pair["id"]][baseline]))] += 1
    lines.append(
        f"| **Net, SM5's four** | | | {nets[1]} / {nets[0]} / {nets[-1]} |"
        f" {sign_test(nets[1], nets[-1]):.2f} |"
    )
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--g4", type=Path, required=True)
    parser.add_argument("--runs", default="renders")
    parser.add_argument("--metrics", default="metrics/metrics.json")
    args = parser.parse_args(argv)
    root = args.g4
    runs = root / args.runs
    pairs = json.loads((root / "pairs.json").read_text())["pairs"]
    measures = json.loads((root / args.metrics).read_text())
    survey = json.loads((root / "survey.json").read_text())["edges"]
    reports = {
        (pair["id"], variant): json.loads((runs / pair["id"] / variant / "report.json").read_text())
        for pair in pairs
        for variant in ("v3", "v2", "v3-norg")
        if (runs / pair["id"] / variant / "report.json").is_file()
    }
    out: list[str] = []

    out += ["## Pairs", ""]
    out += [
        "| Pair | Why | Outgoing → incoming (uid) | BPM (profile) | Voiced end / start | v3 plan | v2 plan |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for pair in pairs:
        plans = []
        for planner in ("smart-mix-v3", "smart-mix-v2"):
            plan = pair["plans"][planner]
            plans.append(
                f"{plan['mode']} {plan['durationMs'] / 1000:.1f} s {plan['curve']}"
                + (", bass swap" if plan["bassHandoff"] == "balanced" else "")
                + (f", `{plan['fallbackReason']}`" if plan["fallbackReason"] else "")
            )
        out.append(
            f"| {pair['id']} | {pair['category']} | `{short(pair['outgoing'])}` → "
            f"`{short(pair['incoming'])}` | {pair['outgoingBpm']:.1f} → {pair['incomingBpm']:.1f} |"
            f" {cell(pair['outgoingVoicedEnd'])} / {cell(pair['incomingVoicedStart'])} |"
            f" {plans[0]} | {plans[1]} |"
        )
    out.append("")

    out += ["## Handover and start (Decks, mix pass)", ""]
    out += [
        "| Pair | Variant | Handover at (s) | Est. handover (s) | Plan start (s) | Lead short by (s) |"
        " Reason | Mixed | Candidate | Beat clock | Late (ms) | Start vs plan (ms) |"
        " Offset at start (ms) | Offset median (ms) | Played (s) |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for pair in pairs:
        for variant in ("v3", "v2", "v3-norg"):
            report = reports.get((pair["id"], variant))
            if not report:
                continue
            armed = next((e for e in report["events"] if e["state"] == "Armed"), None)
            align = measures[pair["id"]].get(f"decks-{variant}", {}).get("alignment", {}) or {}
            handover = armed["outgoingMs"] / 1000 if armed else None
            planned = report["plannedStartOutgoingMs"] / 1000 if report.get("playedPlan") else None
            short_by = None if handover is None or planned is None else max(0.0, handover - planned)
            out.append(
                f"| {pair['id']} | {variant} | {cell(handover)} | {cell(pair['autoDj']['handoverS'])} |"
                f" {cell(planned)} | {cell(short_by)} | `{report['reason']}` |"
                f" {'yes' if report['mixed'] else 'no'} | {report['candidateIndex']} |"
                f" {'yes' if report['usedBeatClock'] else 'no'} | {cell(report['lateMs'], 0)} |"
                f" {cell(align.get('startVsPlanOutgoingMs'))} | {cell(align.get('offsetAtStartMs'))} |"
                f" {cell(align.get('offsetMedianMs'))} |"
                f" {cell(measures[pair['id']].get(f'decks-{variant}', {}).get('durationMs', 0) / 1000)} |"
            )
    out.append("")

    def per_pair(metric_names, columns, title):
        lines = [f"### {title}", ""]
        header = "| Pair | " + " | ".join(f"{LABELS[m]}: {' / '.join(c for c, _ in columns)}" for m in metric_names) + " |"
        lines += [header, "| --- |" + " ---: |" * len(metric_names)]
        for pair in pairs:
            cells = []
            for metric in metric_names:
                values = [measures[pair["id"]].get(source, {}).get(metric) for _, source in columns]
                cells.append(" / ".join(cell(v, 2 if metric in ("mixIbiCv", "lockedShare") else 1) for v in values))
            lines.append(f"| {pair['id']} | " + " | ".join(cells) + " |")
        return lines + [""]

    out += ["## Per pair", ""]
    g4_columns = [("A", "android-v3"), ("D", "decks-v3"), ("D-rg off", "decks-v3-norg")]
    out += per_pair(("beatClashMs", "phaseErrorMsMedian", "voiceOnVoiceMs", "bassOnBassMs"), g4_columns, "G4 rhythm, voice and bass: Android (A) and Decks (D), same v3 plan")
    out += per_pair(("levelStepLuAbs", "dipLu", "bumpLu", "maxShortTermSlopeLuPerS"), g4_columns, "G4 loudness (EBU R128): Android and Decks, same v3 plan")
    g4b_columns = [("v2", "decks-v2"), ("v3", "decks-v3")]
    out += per_pair(("beatClashMs", "phaseErrorMsMedian", "voiceOnVoiceMs", "bassOnBassMs"), g4b_columns, "G4b rhythm, voice and bass: Decks with v2 and v3")
    out += per_pair(("levelStepLuAbs", "dipLu", "bumpLu", "maxShortTermSlopeLuPerS"), g4b_columns, "G4b loudness: Decks with v2 and v3")
    listen_columns = [("Listen", "android-listen"), ("D", "decks-v3")]
    out += per_pair(("beatClashMs", "voiceOnVoiceMs", "levelStepLuAbs", "dipLu"), listen_columns, "Android's own Listen plan against Decks Auto DJ")

    out += ["## Aggregates", ""]
    for current, baseline, title in (
        ("decks-v3", "android-v3", "G4: Decks against Android, same v3 plan"),
        ("decks-v3-norg", "android-v3", "G4: Decks without ReplayGain against Android, same v3 plan"),
        ("decks-v3", "decks-v3-norg", "Decks: ReplayGain on against off"),
        ("decks-v3", "android-listen", "Decks Auto DJ against Android's own Listen plan"),
        ("decks-v3", "decks-v2", "G4b: Decks with v3 against v2"),
        ("android-v3", "android-v2", "G4b reference: the same plans on the Android renderer, v3 against v2"),
    ):
        out += [f"### {title}", ""]
        out += comparison_table(measures, pairs, current, baseline)
        out.append("")

    out += ["## Deviation CSV summary", ""]
    with (runs / "deviation.csv").open() as handle:
        rows = [row for row in csv.DictReader(handle) if row["pass"] == "mix"]
    for variant in ("v3", "v2", "v3-norg"):
        chosen = [row for row in rows if row["variant"] == variant]
        late = [float(row["lateMs"]) for row in chosen if row["mixed"] == "1"]
        start_dev = [
            float(row["startOutgoingMs"]) - float(row["plannedStartOutgoingMs"])
            for row in chosen
            if row["mixed"] == "1" and float(row["lateMs"]) == 0.0
        ]
        out.append(
            f"- **{variant}:** {len(chosen)} runs; reasons "
            + ", ".join(f"`{k}` {v}" for k, v in Counter(row["reason"] for row in chosen).items())
            + f"; mixed {sum(row['mixed'] == '1' for row in chosen)}; beat clock"
            f" {sum(row['usedBeatClock'] == '1' for row in chosen)}; late starts"
            f" {sum(v > 5 for v in late)} (late {', '.join(f'{v / 1000:.1f} s' for v in late if v > 5) or 'none'});"
            f" on-time start against the plan's cue: median {median(start_dev) if start_dev else 0:.1f} ms,"
            f" range {min(start_dev, default=0):.1f} to {max(start_dev, default=0):.1f} ms;"
            f" candidate other than the pick {sum(row['candidateIndex'] != '0' for row in chosen)};"
            f" overridden controls {sum(bool(row['overridden']) for row in chosen)}"
        )
    out.append("")

    out += ["## The 30 s handover lead over the survey", ""]
    for planner in ("smart-mix-v3", "smart-mix-v2"):
        late = sorted(edge["plans"][planner]["lateByMs"] / 1000 for edge in survey)
        early = [v for v in late if v > 0]
        out.append(
            f"- **{planner}:** {len(early)} of {len(late)} edges ({100 * len(early) / len(late):.0f} %)"
            f" start before the handover; of those, median {median(early) if early else 0:.1f} s"
            f" early, p90 {early[int(0.9 * (len(early) - 1))] if early else 0:.1f} s, max {max(early, default=0):.1f} s;"
            f" over 10 s: {sum(v > 10 for v in late)}, over 30 s: {sum(v > 30 for v in late)}."
        )
        lead = sorted(
            edge["autoDj"]["fadeBeginS"] - edge["plans"][planner]["directorStartMs"] / 1000 for edge in survey
        )
        out.append(
            f"  Lead the plan needs (Auto DJ's fade start minus the plan's start): p50 {lead[len(lead) // 2]:.1f} s,"
            f" p90 {lead[int(0.9 * (len(lead) - 1))]:.1f} s, p95 {lead[int(0.95 * (len(lead) - 1))]:.1f} s,"
            f" max {lead[-1]:.1f} s."
        )
    out.append("")

    out += ["## Bass handoff over the survey", ""]
    for planner in ("smart-mix-v3", "smart-mix-v2"):
        counter = Counter(
            (edge["plans"][planner]["mode"], edge["plans"][planner]["bassHandoff"], edge["plans"][planner]["fallbackReason"])
            for edge in survey
        )
        out.append(
            f"- **{planner}:** "
            + "; ".join(f"{mode}, bass {bass}, `{reason}`: {count}" for (mode, bass, reason), count in counter.most_common())
        )
    industrial = [edge for edge in survey if any("industrial" in name for name in edge["playlists"])]
    out.append(
        f"- **G3 · Auto DJ (industrial EBM):** {len(industrial)} edges; v3 beatmatch"
        f" {sum(e['plans']['smart-mix-v3']['mode'] == 'beatmatch' for e in industrial)}, with bass swap"
        f" {sum(e['plans']['smart-mix-v3']['bassHandoff'] == 'balanced' for e in industrial)}; fallback reasons "
        + ", ".join(
            f"`{k}` {v}"
            for k, v in Counter(e["plans"]["smart-mix-v3"]["fallbackReason"] for e in industrial).items()
        )
    )
    out.append("")

    agreement = root / args.runs / "limit-agreement.json"
    if agreement.is_file():
        results = json.loads(agreement.read_text())["results"]
        agree = sum(r.get("agrees", False) for r in results)
        mixes = sum(r.get("mixesAgrees", False) for r in results)
        coded = sum(bool(r.get("serverCodes")) for r in results)
        candidates = [r for r in results if "-candidate-" in r["name"]]
        out += [
            "## Limit check agreement",
            "",
            f"- {agree} of {len(results)} cases give Decks exactly the server's codes in its order"
            f" ({coded} cases with codes); `mixes()` agrees on {mixes}.",
            f"- Real candidates: {sum(r.get('agrees', False) for r in candidates)} of {len(candidates)}.",
            "",
        ]
        disagreements = [r for r in results if not r.get("agrees", False)]
        for result in disagreements:
            out.append(f"  - `{result['name']}`: Decks {result.get('decksCodes')}, server {result.get('serverCodes')}")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
