"""Bounded Prometheus reads for Stack resource readings. Never called per request."""

from __future__ import annotations

import json
import re
import time
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone
from urllib.parse import quote

SERVICE_LABEL = "container_label_com_docker_compose_service"
QUERIES = {
    "cpu": (
        f"sum by ({SERVICE_LABEL}) "
        f'(rate(container_cpu_usage_seconds_total{{{SERVICE_LABEL}!=""}}[2m])) * 100'
    ),
    "memory": (
        f"sum by ({SERVICE_LABEL}) "
        f'(container_memory_working_set_bytes{{{SERVICE_LABEL}!=""}})'
    ),
    "host_cpu": '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))',
    "host_used": "sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)",
    "host_total": "sum(node_memory_MemTotal_bytes)",
    "ingress": "sum by (router) (rate(traefik_router_requests_total[2m])) * 60",
    "postgres": (
        "(sum(rate(pg_stat_database_xact_commit[4m]))"
        " + sum(rate(pg_stat_database_xact_rollback[4m]))) * 60"
    ),
    "redis": "sum by (job) (rate(redis_commands_processed_total[2m])) * 60",
}
REDIS_JOBS = {"redis-cache": "crate-redis", "redis-durable": "crate-redis-durable"}
SCRAPE_JOBS = {
    "prometheus": "crate-prometheus",
    "node": "crate-node-exporter",
    "cadvisor": "crate-cadvisor",
    "postgresql": "crate-postgres-exporter",
    "redis-cache": "crate-redis-exporter",
    "redis-durable": "crate-redis-durable-exporter",
    "traefik": "traefik",
}
APP_JOB = "crate-app"
DURATION_UNITS = {"ms": 0.001, "s": 1, "m": 60, "h": 3600}
TIMEOUT_SECONDS = 2.0
MIB = 1024 * 1024
GIB = 1024 * MIB


class PrometheusUnavailableError(RuntimeError):
    pass


def quote_query(query: str) -> str:
    return quote(query, safe="")


def _vector(base_url: str, query: str, opener: Callable) -> list[dict]:
    url = f"{base_url.rstrip('/')}/api/v1/query?query={quote_query(query)}"
    try:
        with opener(url, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read())
    except Exception as error:
        raise PrometheusUnavailableError(str(error)) from error
    data = payload.get("data") or {}
    if payload.get("status") != "success" or data.get("resultType") != "vector":
        raise PrometheusUnavailableError(payload.get("error") or "Unexpected result")
    return data.get("result") or []


def _scalar(rows: list[dict]) -> float | None:
    return float(rows[0]["value"][1]) if rows else None


def _active_targets(base_url: str, opener: Callable) -> list[dict]:
    url = f"{base_url.rstrip('/')}/api/v1/targets?state=active"
    try:
        with opener(url, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read())
    except Exception as error:
        raise PrometheusUnavailableError(str(error)) from error
    if payload.get("status") != "success":
        raise PrometheusUnavailableError(payload.get("error") or "Unexpected result")
    return (payload.get("data") or {}).get("activeTargets") or []


def _seconds(duration: str) -> float | None:
    parts = re.findall(r"(\d+)(ms|s|m|h)", duration or "")
    if not parts:
        return None
    return sum(int(amount) * DURATION_UNITS[unit] for amount, unit in parts)


def _scrape_time(value: str) -> str | None:
    if not value or value.startswith("0001-"):
        return None
    return re.sub(r"(\.\d{3})\d*", r"\1", value)


def _scrapes(targets: list[dict]) -> dict[str, dict]:
    scrapes: dict[str, dict] = {}
    for target in targets:
        labels = target.get("labels") or {}
        job = labels.get("job")
        service = labels.get("service") if job == APP_JOB else SCRAPE_JOBS.get(job)
        if not service:
            continue
        health = target.get("health") or "unknown"
        if service in scrapes and health == "up":
            continue
        scrapes[service] = {
            "health": health,
            "interval_seconds": _seconds(target.get("scrapeInterval", "")),
            "last_scrape": _scrape_time(target.get("lastScrape", "")),
        }
    return scrapes


def fetch_stack_resources(
    base_url: str,
    *,
    opener: Callable = urllib.request.urlopen,
    now: Callable[[], float] = time.time,
) -> dict:
    """Per-service CPU/memory and host readings; any failed query raises."""
    rows = {key: _vector(base_url, query, opener) for key, query in QUERIES.items()}
    targets = _active_targets(base_url, opener)
    services: dict[str, dict[str, float | None]] = {}
    for key, field, scale in (("cpu", "cpu_percent", 1), ("memory", "memory_mib", MIB)):
        for row in rows[key]:
            name = row.get("metric", {}).get(SERVICE_LABEL)
            if not name:
                continue
            entry = services.setdefault(name, {"cpu_percent": None, "memory_mib": None})
            entry[field] = round(float(row["value"][1]) / scale, 1)
    used, total = _scalar(rows["host_used"]), _scalar(rows["host_total"])
    host_cpu = _scalar(rows["host_cpu"])
    ingress = {}
    for row in rows["ingress"]:
        router = row.get("metric", {}).get("router", "").split("@", 1)[0]
        if router:
            ingress[router] = round(float(row["value"][1]), 1)
    stores = {}
    postgres = _scalar(rows["postgres"])
    if postgres is not None:
        stores["crate-postgres"] = round(postgres, 1)
    for row in rows["redis"]:
        store = REDIS_JOBS.get(row.get("metric", {}).get("job", ""))
        if store:
            stores[store] = round(float(row["value"][1]), 1)
    return {
        "observed_at": datetime.fromtimestamp(now(), tz=timezone.utc).isoformat(),
        "ingress": ingress,
        "host": {
            "cpu_percent": round(host_cpu, 1) if host_cpu is not None else None,
            "memory_used_gib": round(used / GIB, 1) if used is not None else None,
            "memory_total_gib": round(total / GIB, 1) if total is not None else None,
        },
        "services": services,
        "stores": stores,
        "scrapes": _scrapes(targets),
    }


__all__ = ["PrometheusUnavailableError", "QUERIES", "fetch_stack_resources"]
