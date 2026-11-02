"""Persisted presentation summary for Admin, MCP and Crate Agent. Never feeds alerts."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

from crate.db.jobs.product_kpis import KPI_QUERIES
from crate.db.ops_runtime import set_ops_runtime_state
from crate.db.queries.observability_summary import SUMMARY_KEY, read_summary_inputs
from crate.db.queries.product_kpis import MINIMUM_SEGMENT_SAMPLE
from crate.metrics import query_summaries
from crate.stack_inventory import OBSERVABILITY_SERVICES

SUMMARY_SCHEMA = 1
KPI_WINDOWS = (7, 30)
PLAYBACK_WINDOW_MINUTES = 15
MINIMUM_STARTUPS = 20
BREAKDOWN_ROWS = 12
PLAYBACK_METRICS = {
    "startups": ("playback.startup.ms", PLAYBACK_WINDOW_MINUTES),
    "stalls": ("playback.stall.count", PLAYBACK_WINDOW_MINUTES),
    "stall_ms": ("playback.stall.ms", PLAYBACK_WINDOW_MINUTES),
    "recoveries": ("playback.recovery.count", PLAYBACK_WINDOW_MINUTES),
}
SNAPSHOT_KPIS = frozenset(
    kpi for query in KPI_QUERIES if query.snapshot for kpi in query.kpis
)


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _playback(read: Callable[[dict], dict]) -> dict:
    base = {
        "window_minutes": PLAYBACK_WINDOW_MINUTES,
        "minimum_startups": MINIMUM_STARTUPS,
    }
    try:
        summaries = read(PLAYBACK_METRICS)
    except Exception:  # noqa: BLE001 — a failed metric store reads as unavailable, never zero.
        return {
            **base,
            "availability": "unavailable",
            "reason": "metric_source_unavailable",
        }
    startups = summaries.get("startups") or {}
    if startups.get("availability") not in {"available", "empty", "stale"}:
        return {
            **base,
            "availability": "unavailable",
            "reason": startups.get("reason") or "metric_source_unavailable",
        }
    stalls = summaries.get("stalls") or {}
    stall_ms = summaries.get("stall_ms") or {}
    recoveries = summaries.get("recoveries") or {}
    count = int(startups.get("count") or 0)
    result = {
        **base,
        "observed_at": startups.get("observed_at"),
        "startups": count,
        "stalls": stalls.get("sum")
        if stalls.get("availability") != "unavailable"
        else None,
        "recoveries": recoveries.get("sum")
        if recoveries.get("availability") != "unavailable"
        else None,
        "startup_avg_ms": startups.get("avg") if count else None,
        "startup_max_ms": startups.get("max") if count else None,
        "stall_avg_ms": stall_ms.get("avg") if stall_ms.get("count") else None,
        "stalls_per_startup": None,
        "intents_and_results": "not_reported",
    }
    if startups.get("availability") == "stale":
        return {**result, "availability": "stale", "reason": startups.get("reason")}
    if count < MINIMUM_STARTUPS:
        return {**result, "availability": "insufficient_sample", "reason": None}
    if result["stalls"] is not None:
        result["stalls_per_startup"] = round(result["stalls"] / count, 4)
    return {**result, "availability": "available", "reason": None}


def _group(kpi: str) -> str:
    return kpi.split(".", 1)[0]


def _window(rows: list[dict], start: date) -> dict:
    groups: dict[str, dict] = {}
    for kpi in sorted({row["kpi"] for row in rows}):
        values = [
            (row["day"], float(row["value"]))
            for row in rows
            if row["kpi"] == kpi and row["day"] >= start and row["value"] is not None
        ]
        if not values:
            continue
        latest_day, latest = max(values)
        total = sum(value for _day, value in values)
        groups.setdefault(_group(kpi), {})[kpi] = {
            "kind": "snapshot" if kpi in SNAPSHOT_KPIS else "daily",
            "days": len(values),
            "latest_day": latest_day.isoformat(),
            "latest": round(latest, 4),
            "sum": round(total, 4),
            "mean": round(total / len(values), 4),
        }
    return groups


def _breakdowns(rows: list[dict]) -> dict:
    latest: dict[str, date] = {}
    for row in rows:
        current = latest.get(row["kpi"])
        latest[row["kpi"]] = row["day"] if current is None else max(row["day"], current)
    groups: dict[str, dict] = {}
    for kpi in sorted(latest):
        segments = []
        for row in rows:
            if row["kpi"] != kpi or row["day"] != latest[kpi]:
                continue
            suppressed = (
                row["sample"] is not None and row["sample"] < MINIMUM_SEGMENT_SAMPLE
            )
            segments.append(
                {
                    "segment": ",".join(
                        f"{key}={value}" for key, value in sorted(row["dims"].items())
                    ),
                    "value": None if suppressed else row["value"],
                    "sample": row["sample"],
                    "suppressed": suppressed,
                }
            )
        segments.sort(key=lambda item: (item["value"] is None, -(item["value"] or 0)))
        groups.setdefault(_group(kpi), {})[kpi] = {
            "day": latest[kpi].isoformat(),
            "segments": segments[:BREAKDOWN_ROWS],
            "truncated": len(segments) > BREAKDOWN_ROWS,
        }
    return groups


def _product_kpis(rows: list[dict], computed_at, today: date) -> dict:
    if not rows:
        return {
            "availability": "empty",
            "reason": "no_computed_kpis",
            "computed_at": _iso(computed_at),
            "minimum_sample": MINIMUM_SEGMENT_SAMPLE,
        }
    totals = [row for row in rows if not row["dims"]]
    segments = [row for row in rows if row["dims"]]
    return {
        "availability": "available",
        "reason": None,
        "computed_at": _iso(computed_at),
        "end": today.isoformat(),
        "minimum_sample": MINIMUM_SEGMENT_SAMPLE,
        "windows": {
            str(days): _window(totals, today - timedelta(days=days - 1))
            for days in KPI_WINDOWS
        },
        "breakdowns": _breakdowns(segments),
    }


def _stack(inventory: dict | None, built_at) -> dict:
    if not inventory:
        return {"availability": "unavailable", "reason": "no_stack_snapshot"}
    if inventory.get("availability") != "available":
        return {
            "availability": "unavailable",
            "reason": inventory.get("reason") or "inventory_unavailable",
            "observed_at": _iso(built_at),
        }
    projects = {
        stack.get("id"): stack.get("project") for stack in inventory.get("stacks") or []
    }
    services = inventory.get("services") or []

    def stack(stack_id: str) -> dict:
        members = [
            service for service in services if service.get("stack_id") == stack_id
        ]
        return {
            "project": projects.get(stack_id),
            "services": len(members),
            "running": sum(
                service.get("runtime_state") == "running" for service in members
            ),
            "not_running": sorted(
                service["service"]
                for service in members
                if service.get("runtime_state") != "running"
            )[:20],
            "unhealthy": sorted(
                service["service"]
                for service in members
                if service.get("health") == "unhealthy"
            )[:20],
        }

    application = stack("application")
    monitoring = stack("observability")
    present = {
        service["service"]
        for service in services
        if service.get("stack_id") == "observability"
    }
    in_application = any(
        service.get("project") == projects.get("application")
        for service in services
        if service.get("stack_id") == "observability"
    )
    if not present:
        deployment, status = "absent", "absent"
    else:
        deployment = "legacy_overlay" if in_application else "independent"
        status = (
            "running"
            if present >= OBSERVABILITY_SERVICES
            and not monitoring["not_running"]
            and not monitoring["unhealthy"]
            else "degraded"
        )
    return {
        "availability": "available",
        "reason": None,
        "observed_at": _iso(built_at),
        "host": inventory.get("host"),
        "application": application,
        "monitoring": {
            **monitoring,
            "deployment": deployment,
            "status": status,
            "missing": sorted(OBSERVABILITY_SERVICES - present) if present else [],
            "release": None,
            "release_reason": "not_reported_by_containers",
        },
        "resources": "live_only",
    }


def build_observability_summary(
    *,
    now: datetime | None = None,
    metrics: Callable[[dict], dict] = query_summaries,
    inputs: Callable[..., dict] = read_summary_inputs,
) -> dict:
    current = now or datetime.now(UTC)
    today = current.date()
    stored = inputs(today - timedelta(days=max(KPI_WINDOWS) - 1), today)
    return {
        "schema_version": SUMMARY_SCHEMA,
        "generated_at": current.isoformat(),
        "playback": _playback(metrics),
        "product_kpis": _product_kpis(
            stored["kpi_rows"], stored["kpi_computed_at"], today
        ),
        "stack": _stack(stored["inventory"], stored["inventory_built_at"]),
    }


def compute_observability_summary() -> dict:
    summary = build_observability_summary()
    set_ops_runtime_state(SUMMARY_KEY, summary)
    return summary


__all__ = [
    "SUMMARY_KEY",
    "build_observability_summary",
    "compute_observability_summary",
]
