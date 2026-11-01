"""Bounded Prometheus reads for Stack resource readings. Never called per request."""

from __future__ import annotations

import json
import time
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone
from urllib.parse import quote

SERVICE_LABEL = "container_label_com_docker_compose_service"
QUERIES = {
    "cpu": (
        f"sum by ({SERVICE_LABEL}) "
        f'(rate(container_cpu_usage_seconds_total{{{SERVICE_LABEL}!=""}}[1m])) * 100'
    ),
    "memory": (
        f"sum by ({SERVICE_LABEL}) "
        f'(container_memory_working_set_bytes{{{SERVICE_LABEL}!=""}})'
    ),
    "host_cpu": '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m])))',
    "host_used": "sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)",
    "host_total": "sum(node_memory_MemTotal_bytes)",
}
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


def fetch_stack_resources(
    base_url: str,
    *,
    opener: Callable = urllib.request.urlopen,
    now: Callable[[], float] = time.time,
) -> dict:
    """Per-service CPU/memory and host readings; any failed query raises."""
    rows = {key: _vector(base_url, query, opener) for key, query in QUERIES.items()}
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
    return {
        "observed_at": datetime.fromtimestamp(now(), tz=timezone.utc).isoformat(),
        "host": {
            "cpu_percent": round(host_cpu, 1) if host_cpu is not None else None,
            "memory_used_gib": round(used / GIB, 1) if used is not None else None,
            "memory_total_gib": round(total / GIB, 1) if total is not None else None,
        },
        "services": services,
    }


__all__ = ["PrometheusUnavailableError", "QUERIES", "fetch_stack_resources"]
