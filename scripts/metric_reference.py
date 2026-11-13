#!/usr/bin/env python3
"""Render docs/technical/metrics-reference.md from the metric catalogue and monitoring files."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/technical/metrics-reference.md"
RULES = ROOT / "deploy/observability/recording-rules.yml"
DASHBOARDS = ROOT / "deploy/observability/grafana/dashboards"
IMPLICIT_LABELS = ("service", "target")

FAMILIES = (
    (
        "ai.capacity.",
        "AI capacity",
        "Tasks on the AI lanes that found no free provider slot, per lane: an ai task requeued before its first paid call, or an ai_bulk item waiting inside its task budget.",
    ),
    (
        "api.request.",
        "API requests",
        "Requests to the FastAPI application by route template, method, status class and latency class, and requests per client application.",
    ),
    (
        "api.route.",
        "API route latency",
        "Latency per route template for the route table in System Health. It stays in PostgreSQL and is not exported to Prometheus.",
    ),
    (
        "artwork.",
        "Artwork",
        "Artwork requests and queueing, materialisation time, size and errors, and the work left in the artwork backfill.",
    ),
    (
        "cast.spectrum.",
        "Cast spectrum",
        "Spectrum files generated for the Cast receiver and their size.",
    ),
    (
        "catalog.search.",
        "Catalog search",
        "Which serving mode answered a catalog search.",
    ),
    (
        "catalog.search_stream.",
        "Federated search stream",
        "Searches that asked for local and network results as one stream (FED1).",
    ),
    (
        "federation.playback.",
        "Federated playback",
        "Preparation of tracks from federated peers, from the request to ready, rate limited, unavailable or a fallback to the original file.",
    ),
    (
        "federation.risk.",
        "Federation risk",
        "Risk signals raised about federated peers.",
    ),
    (
        "home.",
        "Home",
        "Home feed cache hits, misses, coalesced and stale responses, and compute time per scope and for the whole endpoint.",
    ),
    (
        "mcp.",
        "Crate MCP",
        "Authorization failures, job outcomes, and the outcome, latency and response size of MCP tool calls.",
    ),
    (
        "media_worker.",
        "Media worker",
        "ZIP packages built by the Rust media worker: admission, completions, failures, duration, size and cache pruning.",
    ),
    (
        "opensubsonic.",
        "Open Subsonic",
        "Request and protocol errors on the Open Subsonic layer.",
    ),
    (
        "paths.plan.",
        "Music Paths",
        "Music Paths plans per engine: whether they completed, ran short or found nothing, how full they were, planning time and warning codes.",
    ),
    (
        "playback.continuation.",
        "Queue continuation",
        "What Listen saw when the queue ran out during radio or Infinite, and how long the listener waited.",
    ),
    (
        "playback.telemetry.",
        "Telemetry delivery",
        "Delivery of playback telemetry itself: accepted, duplicate, unverified and rate-limited events, losses declared by clients and the payload version.",
    ),
    (
        "playback.",
        "Playback quality",
        "Playback reported by Listen: play requests, results with their cause, active listening time, startup and stall time, and recoveries.",
    ),
    (
        "radio.batch.",
        "Radio batches",
        "Radio batches by source (generated, replayed or recovered), outcome, fill, generation time, vector coverage, median distance and relaxation step.",
    ),
    (
        "recommendations.",
        "Early skips",
        "Share of radio and path tracks skipped in their first 30 seconds over the last 24 hours, with its sample, per rules revision.",
    ),
    (
        "search.",
        "Search results",
        "Result counts for global, hybrid and federated searches.",
    ),
    (
        "shows.import.",
        "Show imports",
        "Show imports: candidates, created, linked, already present, conflicts, invalid and failed.",
    ),
    (
        "sse.",
        "SSE pub/sub",
        "Redis pub/sub subscriptions held by each API process for its SSE and Jam streams, and the subscriptions that could not be opened, either because the shared async pool was full or because Redis failed. The open count rises and falls with connected clients; a count that only climbs means a stream is not closing its subscription.",
    ),
    (
        "storage.",
        "Storage",
        "Used bytes on the music, data and cache volumes.",
    ),
    (
        "stream.",
        "Streams",
        "Streaming responses (audio and event streams): requests, latency, concurrent streams, bytes, the stream cache and transcodes per preset.",
    ),
    (
        "worker.",
        "Workers",
        "Queue depth and running tasks, wait and duration per queue and task type, and resource governor deferrals with the host readings behind them.",
    ),
)


def family_for(name: str) -> tuple[str, str, str] | None:
    matches = [family for family in FAMILIES if name.startswith(family[0])]
    return max(matches, key=lambda family: len(family[0])) if matches else None


def _per_tool(name: str, tools) -> bool:
    return any(name.startswith(f"mcp.tool.{tool}.") for tool in tools)


def _first(spec) -> str:
    return spec[0] if isinstance(spec, tuple) else spec


def surfaces() -> dict[str, set[str]]:
    from crate.api.admin_metrics import _DASHBOARD_TIMESERIES, _SUMMARY_METRICS
    from crate.observability.live_activity import _SPECS as LIVE_SPECS

    shown: dict[str, set[str]] = {}
    for name in (
        *_DASHBOARD_TIMESERIES.values(),
        *(_first(spec) for spec in _SUMMARY_METRICS.values()),
    ):
        shown.setdefault(name, set()).add("System Health")
    for name, _window in LIVE_SPECS.values():
        shown.setdefault(name, set()).add("Stack map")
    return shown


def recording_rules() -> list[dict]:
    groups = yaml.safe_load(RULES.read_text())["groups"]
    return [
        {"record": rule["record"], "group": group["name"], "expr": rule["expr"]}
        for group in groups
        for rule in group["rules"]
    ]


def dashboards() -> list[dict]:
    result = []
    for path in sorted(DASHBOARDS.glob("*.json")):
        board = json.loads(path.read_text())
        panels = [panel for panel in board.get("panels", []) if panel.get("title")]
        result.append(
            {
                "file": path.name,
                "title": board["title"],
                "panels": [panel["title"] for panel in panels],
                "text": json.dumps(board),
            }
        )
    return result


def _families_in(expression: str) -> list[str]:
    return sorted(set(re.findall(r"\bcrate_[a-z0-9_]+", expression)))


def _uses(text: str, prometheus_name: str) -> bool:
    return re.search(rf"\b{re.escape(prometheus_name)}(_total|_count|_sum|_bucket)?\b", text) is not None


def render() -> str:
    from crate.observability.metric_catalog import METRIC_CATALOG
    from crate.observability.metric_catalog_data import MCP_OUTCOMES, MCP_TOOLS
    from crate.observability.prometheus import EXPORTED_FAMILIES

    shown = surfaces()
    rules = recording_rules()
    boards = dashboards()
    rule_reads = {rule["record"]: _families_in(rule["expr"]) for rule in rules}

    def grafana(prometheus_name: str) -> list[str]:
        records = [
            record
            for record, families in rule_reads.items()
            if any(_uses(family, prometheus_name) for family in families)
        ]
        return [
            board["title"].split(" · ")[-1]
            for board in boards
            if _uses(board["text"], prometheus_name)
            or any(re.search(rf"\b{re.escape(record)}\b", board["text"]) for record in records)
        ]

    rows: dict[str, list[str]] = {}
    for name, definition in sorted(METRIC_CATALOG.items()):
        if _per_tool(name, MCP_TOOLS):
            continue
        family = family_for(name)
        if family is None:
            raise SystemExit(f"{name} has no family in scripts/metric_reference.py")
        labels = [key for key, _values in definition.labels if key not in IMPLICIT_LABELS]
        exported = EXPORTED_FAMILIES.get(name)
        places = sorted(shown.get(name, set()))
        if exported:
            places += [f"Grafana: {title}" for title in grafana(exported.name)]
        rows.setdefault(family[0], []).append(
            "| `{}` | {} | {} | {} | {} | {} |".format(
                name,
                definition.kind,
                definition.unit,
                ", ".join(f"`{label}`" for label in labels) or "none",
                f"`{exported.name}`" if exported else "not exported",
                ", ".join(places) or "PostgreSQL history only",
            )
        )

    lines = [
        "---",
        "title: Metrics reference",
        "summary: Every application metric with its type, unit, labels, Prometheus name and where it appears, plus the recording rules and Grafana dashboards. Generated from the code.",
        "section: reference",
        "audience: [operator, developer]",
        "status: canonical",
        "order: 60",
        "verified: 2026-11-02",
        "sources:",
        "  [",
        "    app/crate/observability/metric_catalog_data.py,",
        "    app/crate/observability/metric_catalog.py,",
        "    app/crate/observability/prometheus.py,",
        "    app/crate/observability/live_activity.py,",
        "    app/crate/api/admin_metrics.py,",
        "    deploy/observability/recording-rules.yml,",
        "    deploy/observability/grafana/dashboards/app-overview.json,",
        "    scripts/metric_reference.py,",
        "  ]",
        "---",
        "",
        "# Metrics reference",
        "",
        "This page is generated by `scripts/metric_reference.py` from the metric",
        "catalogue, the System Health and Stack map readers, the Prometheus exporter,",
        "the recording rules and the Grafana dashboards. A test fails when it is out of",
        "date; regenerate it with `python3 scripts/metric_reference.py` from the",
        "repository root, using the repository virtualenv.",
        "",
        "Every metric is stored per minute in PostgreSQL for eight days. Labels are",
        "bounded: each one accepts a fixed set of values, and anything else is recorded",
        "as `other`. Every metric also carries `service`, and API and stream metrics",
        "carry `target`; those are left out of the tables. Units are the stored units:",
        "values recorded in milliseconds, mebibytes or percent are converted to seconds,",
        "bytes and ratios. **Prometheus** is the exported family name, without the",
        "`_total`, `_count`, `_sum` or `_bucket` suffix Prometheus adds. A metric that is",
        "not exported is still in System Health or the PostgreSQL history. See",
        "[Observability](observability.md) for what each surface shows.",
        "",
        f"The catalogue defines {len(METRIC_CATALOG)} metrics; {len(EXPORTED_FAMILIES)} are exported to Prometheus.",
        "",
        "## Metrics by family",
        "",
    ]
    for prefix, title, description in sorted(FAMILIES, key=lambda family: family[1]):
        if prefix not in rows:
            raise SystemExit(f"family {prefix} matches no metric")
        lines += [
            f"### {title}",
            "",
            description,
            "",
            "| Metric | Type | Unit | Labels | Prometheus | Shown in |",
            "| --- | --- | --- | --- | --- | --- |",
            *rows[prefix],
            "",
        ]
        if prefix == "mcp.":
            outcomes = ", ".join(f"`{outcome}`" for outcome in MCP_OUTCOMES)
            lines += [
                f"Each of the {len(MCP_TOOLS)} tools also records `mcp.tool.<tool>.latency_ms`,",
                f"`mcp.tool.<tool>.response_bytes` and one counter per outcome ({outcomes}).",
                "",
            ]

    lines += [
        "## Recording rules",
        "",
        f"Prometheus evaluates {len(rules)} recording rules from",
        "`deploy/observability/recording-rules.yml`. Ratios and percentiles come with",
        "the sample they were computed from, and no rule turns missing data into zero.",
        "",
        "| Rule | Group | Reads |",
        "| --- | --- | --- |",
        *(
            "| `{}` | {} | {} |".format(
                rule["record"],
                rule["group"],
                ", ".join(f"`{family}`" for family in rule_reads[rule["record"]]) or "Prometheus scrape metadata",
            )
            for rule in rules
        ),
        "",
        "## Grafana dashboards",
        "",
        "Provisioned in the **Crate infrastructure** folder from",
        "`deploy/observability/grafana/dashboards`.",
        "",
        "| Dashboard | File | Panels |",
        "| --- | --- | --- |",
        *(
            "| {} | `{}` | {} |".format(board["title"], board["file"], ", ".join(board["panels"]))
            for board in boards
        ),
        "",
    ]
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the page is out of date")
    args = parser.parse_args(argv)
    sys.path.insert(0, str(ROOT / "app"))
    text = render()
    if args.check:
        if OUTPUT.read_text() != text:
            print("docs/technical/metrics-reference.md is out of date", file=sys.stderr)
            return 1
        return 0
    OUTPUT.write_text(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
