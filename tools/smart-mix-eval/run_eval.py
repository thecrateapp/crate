"""Plan the evaluation edge set with a planner and score every plan.

Loads the current profiles of the dataset's tracks (read-only), plans each
edge with the chosen planner and context, computes the SM0 metrics from
``crate.smart_mix.evaluation`` and writes:

    report.json   per-edge plans and metrics, summaries, optional comparison
    report.md     means, p50/p95, per band/genre/stratum, deltas vs --compare

usage:
    run_eval.py --dsn postgresql://crate:crate@localhost:5433/crate \
        --dataset tools/smart-mix-eval/out/dev/dataset.jsonl \
        --planner smart-mix-v2 --output tools/smart-mix-eval/out/dev/smart-mix-v2 \
        [--context dj] [--compare <other report.json>]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common import (
    ensure_app_on_path,
    git_commit,
    open_read_only_database,
    read_jsonl,
    resolve_dsn,
    write_json,
)

ensure_app_on_path()

from crate.smart_mix.evaluation import evaluate_transition  # noqa: E402
from crate.smart_mix.models import (  # noqa: E402
    TrackMixProfile,
    TransitionContext,
    TransitionPlan,
)
from crate.smart_mix.planner import plan_transition  # noqa: E402
from crate.smart_mix.policy import PLANNER_POLICY  # noqa: E402

Planner = Callable[
    [TrackMixProfile | None, TrackMixProfile | None, TransitionContext, str, str],
    TransitionPlan,
]


def _plan_smart_mix_v2(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    context: TransitionContext,
    outgoing_uid: str,
    incoming_uid: str,
) -> TransitionPlan:
    # The pure planner: no API, no plan cache, no database.
    return plan_transition(
        outgoing,
        incoming,
        context,
        outgoing_track_entity_uid=outgoing_uid,
        incoming_track_entity_uid=incoming_uid,
        policy=PLANNER_POLICY,
    )


PLANNERS: dict[str, Planner] = {"smart-mix-v2": _plan_smart_mix_v2}
PLANNER_RULES = {"smart-mix-v2": PLANNER_POLICY.rules_revision}

CONTEXTS = {
    # What a DJ client allows: beatmatch with tempo adjustment, the longest
    # blends and the bass handoff. The default, because Smart Mix 3 serves
    # Crate Decks first.
    "dj": TransitionContext(
        source="playlist",
        automatic=True,
        offline=False,
        preferred_duration_ms=12_000,
        user_cue_profile="auto",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
        allow_bass_handoff=True,
        allow_long_beatmatch=True,
    ),
    # Listen's defaults: 6 s crossfade, beatmatch, no bass handoff or long blend.
    "listen": TransitionContext(
        source="playlist",
        automatic=True,
        offline=False,
        preferred_duration_ms=6_000,
        user_cue_profile="auto",
        allow_beatmatch=True,
        allow_tempo_adjustment=True,
    ),
}

GROUP_FIELDS = (
    ("n", "Edges"),
    ("beatmatchRate", "Beatmatch"),
    ("violationRate", "Violations"),
    ("phraseFullyAlignedRate", "Start+end on phrase"),
    ("phraseAlignedFraction", "Boundaries aligned"),
    ("bassOverlapMsMean", "Bass overlap ms"),
    ("harmonicClashRate", "Key clash"),
    ("harmonicClashMsMean", "Key clash ms"),
    ("energyStepMean", "Energy step"),
    ("durationMsMean", "Duration ms"),
)
_RATE_FIELDS = {
    "beatmatchRate",
    "violationRate",
    "phraseFullyAlignedRate",
    "phraseAlignedFraction",
    "harmonicClashRate",
}


def percentile(values: Sequence[float], quantile: float) -> float | None:
    """Linear interpolation between closest ranks (NumPy's default)."""
    if not values:
        return None
    ordered = sorted(values)
    position = quantile * (len(ordered) - 1)
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def evaluate_dataset(
    rows: Iterable[Mapping[str, Any]],
    profiles: Mapping[str, TrackMixProfile | None],
    *,
    planner: str,
    context: TransitionContext,
) -> list[dict[str, Any]]:
    plan_edge = PLANNERS[planner]
    records = []
    for row in rows:
        outgoing_uid = str(row["outgoingTrackEntityUid"])
        incoming_uid = str(row["incomingTrackEntityUid"])
        outgoing = profiles.get(outgoing_uid)
        incoming = profiles.get(incoming_uid)
        plan = plan_edge(outgoing, incoming, context, outgoing_uid, incoming_uid)
        evaluation = evaluate_transition(plan, outgoing, incoming, context=context)
        records.append(
            {
                "edgeId": row["edgeId"],
                "stratum": row["stratum"],
                "rootGenre": row["rootGenre"],
                "tempoBand": row["tempoBand"],
                "profiles": {
                    "outgoing": _profile_state(
                        outgoing, row.get("outgoingProfileRevision")
                    ),
                    "incoming": _profile_state(
                        incoming, row.get("incomingProfileRevision")
                    ),
                },
                "analyzerVersions": [
                    profile.analyzer_version if profile else None
                    for profile in (outgoing, incoming)
                ],
                "plan": plan.to_dict(),
                "metrics": evaluation.to_dict(),
            }
        )
    return records


def summarize(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    metrics = [record["metrics"] for record in records]
    alignments = [item["phraseAlignment"] for item in metrics]
    by_basis: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for alignment in alignments:
        if alignment is not None:
            by_basis[alignment["basis"]].append(alignment)
    energy_by_basis: dict[str, list[float]] = defaultdict(list)
    for item in metrics:
        if item["energyStep"] is not None:
            energy_by_basis[item["energyStep"]["basis"]].append(
                item["energyStep"]["value"]
            )
    clashes = [
        item["harmonicClashMs"]
        for item in metrics
        if item["harmonicClashMs"] is not None
    ]
    vocals = [
        item["vocalClashMs"] for item in metrics if item["vocalClashMs"] is not None
    ]
    violating = [item for item in metrics if item["policyViolations"]]
    return {
        "edges": len(records),
        "modes": _counts(item["mode"] for item in metrics),
        "fallbackReasons": _counts(
            item["fallbackReason"] or "none" for item in metrics
        ),
        "curves": _counts(item["curve"] for item in metrics),
        "bassHandoffs": sum(1 for item in metrics if item["bassHandoff"]),
        "profiles": _counts(
            state for record in records for state in record["profiles"].values()
        ),
        "analyzerVersions": _counts(
            version or "missing"
            for record in records
            for version in record.get("analyzerVersions", ())
        ),
        "durationMs": _stats(item["durationMs"] for item in metrics),
        "policyViolations": {
            "plans": len(violating),
            "rate": _rate(len(violating), len(metrics)),
            "codes": _counts(
                code for item in violating for code in item["policyViolations"]
            ),
        },
        "phraseAlignment": {
            "unavailable": sum(1 for alignment in alignments if alignment is None),
            "byBasis": {
                basis: {
                    "n": len(items),
                    "fullyAlignedRate": _rate(
                        sum(1 for a in items if a["aligned"] == a["checked"]),
                        len(items),
                    ),
                    "startAlignedRate": _rate(
                        sum(1 for a in items if a["startAligned"]), len(items)
                    ),
                    "endAlignedRate": _rate(
                        sum(1 for a in items if a["endAligned"]), len(items)
                    ),
                    "alignedFraction": _stats(
                        a["aligned"] / a["checked"] for a in items
                    ),
                }
                for basis, items in sorted(by_basis.items())
            },
        },
        "bassOverlapMs": _stats(item["bassOverlapMs"] for item in metrics),
        "harmonicClashMs": {
            **_stats(clashes),
            "unknown": len(metrics) - len(clashes),
            "clashRate": _rate(sum(1 for value in clashes if value > 0), len(clashes)),
        },
        "energyStep": {
            "unavailable": sum(1 for item in metrics if item["energyStep"] is None),
            "byBasis": {
                basis: _stats(values)
                for basis, values in sorted(energy_by_basis.items())
            },
        },
        "vocalClashMs": {
            **_stats(vocals),
            "unavailable": len(metrics) - len(vocals),
        },
    }


def summarize_group(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    metrics = [record["metrics"] for record in records]
    alignments = [
        item["phraseAlignment"] for item in metrics if item["phraseAlignment"]
    ]
    clashes = [
        item["harmonicClashMs"]
        for item in metrics
        if item["harmonicClashMs"] is not None
    ]
    energies = [item["energyStep"]["value"] for item in metrics if item["energyStep"]]
    return {
        "n": len(metrics),
        "beatmatchRate": _rate(
            sum(1 for item in metrics if item["mode"] == "beatmatch"), len(metrics)
        ),
        "violationRate": _rate(
            sum(1 for item in metrics if item["policyViolations"]), len(metrics)
        ),
        "phraseFullyAlignedRate": _rate(
            sum(1 for a in alignments if a["aligned"] == a["checked"]),
            len(alignments),
        ),
        "phraseAlignedFraction": _mean(a["aligned"] / a["checked"] for a in alignments),
        "bassOverlapMsMean": _mean(item["bassOverlapMs"] for item in metrics),
        "harmonicClashRate": _rate(
            sum(1 for value in clashes if value > 0), len(clashes)
        ),
        "harmonicClashMsMean": _mean(clashes),
        "energyStepMean": _mean(energies),
        "durationMsMean": _mean(item["durationMs"] for item in metrics),
    }


def build_report(
    records: Sequence[Mapping[str, Any]],
    *,
    meta: Mapping[str, Any],
    baseline: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "meta": dict(meta),
        "summary": summarize(records),
        "overall": summarize_group(records),
        "byTempoBand": _grouped(records, "tempoBand"),
        "byRootGenre": _grouped(records, "rootGenre"),
        "byStratum": _grouped(records, "stratum"),
        "edges": list(records),
        "comparison": None,
    }
    if baseline is not None:
        report["comparison"] = compare_reports(report, baseline)
    return report


def compare_reports(
    current: Mapping[str, Any],
    baseline: Mapping[str, Any],
) -> dict[str, Any]:
    """Current minus baseline, overall and per group present in both."""
    current_edges = {edge["edgeId"] for edge in current.get("edges", ())}
    baseline_edges = {edge["edgeId"] for edge in baseline.get("edges", ())}
    return {
        "baseline": {
            key: baseline.get("meta", {}).get(key)
            for key in ("planner", "context", "createdAt", "gitCommit")
        },
        "pairedEdges": len(current_edges & baseline_edges),
        "overall": _delta(current["overall"], baseline["overall"]),
        **{
            group: {
                key: _delta(current[group][key], baseline[group][key])
                for key in sorted(set(current[group]) & set(baseline[group]))
            }
            for group in ("byTempoBand", "byRootGenre", "byStratum")
        },
    }


def render_markdown(report: Mapping[str, Any]) -> str:
    meta = report["meta"]
    summary = report["summary"]
    dataset = meta.get("dataset") or {}
    lines = [
        f"# Smart Mix evaluation: {meta.get('planner', '?')}",
        "",
        f"- Planner: `{meta.get('planner', '?')}`"
        + (
            f" (rules revision {meta['plannerRulesRevision']})"
            if meta.get("plannerRulesRevision") is not None
            else ""
        )
        + f", context `{meta.get('context', '?')}`",
        f"- Dataset: `{dataset.get('path', '?')}`, {dataset.get('edges', '?')} edges,"
        f" sha256 `{str(dataset.get('sha256', '?'))[:12]}`",
    ]
    if meta.get("database"):
        database = meta["database"]
        lines.append(
            f"- Profiles read from `{database.get('host')}:{database.get('port')}/"
            f"{database.get('database')}` in read-only transactions"
        )
    lines += [
        f"- Profiles: {_format_counts(summary['profiles'])};"
        f" analyzers: {_format_counts(summary['analyzerVersions'])}",
        f"- Modes: {_format_counts(summary['modes'])};"
        f" fallbacks: {_format_counts(summary['fallbackReasons'])};"
        f" curves: {_format_counts(summary['curves'])};"
        f" bass handoffs: {summary['bassHandoffs']}",
    ]
    if meta.get("createdAt") or meta.get("gitCommit"):
        lines.append(
            f"- Run {meta.get('createdAt', '?')} at commit"
            f" `{str(meta.get('gitCommit') or '?')[:12]}`"
        )
    lines += ["", "## Overall", "", *_overall_table(summary), ""]
    lines += [
        "Phrase metrics use stored phrases when a profile has them and an 8-bar grid",
        "from the downbeat otherwise (basis `grid`). Overlaps count time with both",
        "decks at half amplitude or more; bass counts the handoff shelf cut too.",
        "",
    ]
    for title, group in (
        ("By tempo band", "byTempoBand"),
        ("By root genre", "byRootGenre"),
        ("By stratum", "byStratum"),
    ):
        lines += [f"## {title}", "", *_group_table(report[group]), ""]
    comparison = report.get("comparison")
    if comparison:
        baseline = comparison["baseline"]
        lines += [
            "## Comparison",
            "",
            f"Current minus `{baseline.get('planner')}` (context"
            f" `{baseline.get('context')}`), {comparison['pairedEdges']} paired edges.",
            "",
            *_group_table({"overall": comparison["overall"]}, signed=True),
            "",
            *_group_table(comparison["byStratum"], signed=True),
            "",
        ]
    else:
        lines += ["## Comparison", "", "None: this report is a baseline.", ""]
    return "\n".join(lines)


def load_profiles(uids: Sequence[str]) -> dict[str, TrackMixProfile | None]:
    from crate.db.repositories.smart_mix import get_track_mix_profiles_by_entity_uids

    profiles: dict[str, TrackMixProfile | None] = {}
    for start in range(0, len(uids), 500):
        batch = list(uids[start : start + 500])
        loaded = get_track_mix_profiles_by_entity_uids(batch, include_beat_grid=True)
        profiles.update(zip(batch, loaded, strict=True))
    return profiles


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dsn", help="postgresql:// URL (or SMART_MIX_EVAL_DSN)")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--planner", choices=sorted(PLANNERS), default="smart-mix-v2")
    parser.add_argument("--context", choices=sorted(CONTEXTS), default="dj")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--compare", type=Path, help="baseline report.json")
    parser.add_argument("--allow-remote-database", action="store_true")
    args = parser.parse_args(argv)
    args.dsn = resolve_dsn(args.dsn)
    if not args.dsn:
        parser.error("--dsn or SMART_MIX_EVAL_DSN is required")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: the database wiring is exercised by running the tool against
    # the dev library (see README); planning, metrics and reports are tested.
    args = parse_args(argv)
    database = open_read_only_database(
        args.dsn, allow_remote=args.allow_remote_database
    )
    rows = read_jsonl(args.dataset)
    uids = sorted(
        {
            str(row[key])
            for row in rows
            for key in ("outgoingTrackEntityUid", "incomingTrackEntityUid")
        }
    )
    profiles = load_profiles(uids)
    context = CONTEXTS[args.context]
    records = evaluate_dataset(rows, profiles, planner=args.planner, context=context)
    baseline = json.loads(args.compare.read_text()) if args.compare else None
    report = build_report(
        records,
        meta={
            "planner": args.planner,
            "plannerRulesRevision": PLANNER_RULES.get(args.planner),
            "context": args.context,
            "contextValues": context.to_dict(),
            "dataset": {
                "path": str(args.dataset),
                "edges": len(rows),
                "sha256": hashlib.sha256(args.dataset.read_bytes()).hexdigest(),
            },
            "database": database,
            "readOnly": True,
            "createdAt": datetime.now(UTC).isoformat(),
            "gitCommit": git_commit(),
        },
        baseline=baseline,
    )
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output / "report.json", report)
    (args.output / "report.md").write_text(render_markdown(report))
    print(f"{len(records)} edges -> {args.output}", file=sys.stderr)
    return 0


def _profile_state(profile: TrackMixProfile | None, revision: Any) -> str:
    if profile is None:
        return "missing"
    if revision is not None and profile.profile_revision != revision:
        return "drifted"
    return "current"


def _grouped(
    records: Sequence[Mapping[str, Any]], key: str
) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for record in records:
        groups[str(record[key])].append(record)
    return {name: summarize_group(items) for name, items in sorted(groups.items())}


def _stats(values: Iterable[float]) -> dict[str, Any]:
    collected = [float(value) for value in values]
    return {
        "n": len(collected),
        "mean": _mean(collected),
        "p50": _round(percentile(collected, 0.5)),
        "p95": _round(percentile(collected, 0.95)),
    }


def _mean(values: Iterable[float]) -> float | None:
    collected = [float(value) for value in values]
    if not collected:
        return None
    return _round(sum(collected) / len(collected))


def _rate(count: int, total: int) -> float | None:
    return _round(count / total) if total else None


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 4)


def _counts(values: Iterable[str]) -> dict[str, int]:
    return dict(sorted(Counter(values).items()))


def _delta(current: Any, baseline: Any) -> Any:
    if isinstance(current, Mapping) and isinstance(baseline, Mapping):
        return {
            key: _delta(current.get(key), baseline.get(key))
            for key in current
            if key in baseline
        }
    if isinstance(current, (int, float)) and isinstance(baseline, (int, float)):
        return _round(current - baseline)
    return None


def _overall_table(summary: Mapping[str, Any]) -> list[str]:
    rows = [
        "| Metric | n | mean | p50 | p95 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    violations = summary["policyViolations"]
    rows.append(
        f"| Policy violations (plans) | {summary['edges']} |"
        f" {violations['plans']} ({_percent(violations['rate'])}) | | |"
    )
    if violations["codes"]:
        rows.append(
            f"| Violation codes | | {_format_counts(violations['codes'])} | | |"
        )
    alignment = summary["phraseAlignment"]
    for basis, values in alignment["byBasis"].items():
        rows.append(
            f"| Phrase alignment, start and end on a boundary ({basis}) |"
            f" {values['n']} | {_percent(values['fullyAlignedRate'])} | | |"
        )
        rows.append(
            f"| Phrase alignment, mix start on a boundary ({basis}) | {values['n']} |"
            f" {_percent(values['startAlignedRate'])} | | |"
        )
        rows.append(
            _stats_row(
                f"Phrase alignment, boundaries aligned of 4 ({basis})",
                values["alignedFraction"],
                scale=4,
                digits=2,
            )
        )
    if alignment["unavailable"]:
        rows.append(
            f"| Phrase alignment unavailable (no grid) | {alignment['unavailable']}"
            " | n/a | | |"
        )
    rows.append(_stats_row("Bass overlap (ms)", summary["bassOverlapMs"]))
    clash = summary["harmonicClashMs"]
    rows.append(_stats_row("Harmonic clash (ms)", clash))
    rows.append(
        f"| Harmonic clash, plans with a clash | {clash['n']} |"
        f" {_percent(clash['clashRate'])} | | |"
    )
    if clash["unknown"]:
        rows.append(
            f"| Harmonic clash unknown (no key) | {clash['unknown']} | n/a | | |"
        )
    energy = summary["energyStep"]
    for basis, values in energy["byBasis"].items():
        rows.append(_stats_row(f"Energy step, 0-1 ({basis})", values, digits=3))
    if energy["unavailable"]:
        rows.append(f"| Energy step unavailable | {energy['unavailable']} | n/a | | |")
    vocal = summary["vocalClashMs"]
    if vocal["n"]:
        rows.append(_stats_row("Vocal clash (ms)", vocal))
    else:
        rows.append(
            f"| Vocal clash (ms) | 0 | n/a: no vocal presence in"
            f" {vocal['unavailable']} edges | | |"
        )
    rows.append(_stats_row("Transition duration (ms)", summary["durationMs"]))
    return rows


def _stats_row(
    label: str,
    values: Mapping[str, Any],
    *,
    scale: float = 1.0,
    digits: int = 0,
) -> str:
    def cell(value: float | None) -> str:
        if value is None:
            return "n/a"
        scaled = value * scale
        return f"{scaled:.{digits}f}" if digits else f"{scaled:,.0f}"

    return (
        f"| {label} | {values['n']} | {cell(values['mean'])} |"
        f" {cell(values['p50'])} | {cell(values['p95'])} |"
    )


def _group_table(
    groups: Mapping[str, Mapping[str, Any]], *, signed: bool = False
) -> list[str]:
    header = "| Group | " + " | ".join(label for _key, label in GROUP_FIELDS) + " |"
    divider = "| --- |" + " ---: |" * len(GROUP_FIELDS)
    rows = [header, divider]
    for name, values in groups.items():
        cells = [
            _group_cell(key, values.get(key), signed) for key, _label in GROUP_FIELDS
        ]
        rows.append(f"| {name} | " + " | ".join(cells) + " |")
    return rows


def _group_cell(key: str, value: Any, signed: bool) -> str:
    if value is None:
        return "n/a"
    sign = "+" if signed and value > 0 else ""
    if key in _RATE_FIELDS:
        return f"{sign}{value * 100:.1f} %"
    if key == "energyStepMean":
        return f"{sign}{value:.3f}"
    return f"{sign}{value:,.0f}"


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f} %"


def _format_counts(counts: Mapping[str, int]) -> str:
    return ", ".join(f"{key} {value}" for key, value in counts.items()) or "none"


if __name__ == "__main__":
    raise SystemExit(main())
