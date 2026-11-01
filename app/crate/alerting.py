"""Health evaluation engine.

Computes a degradation score (0–100) from metrics and checks thresholds.
The worker service loop persists the result; the operator supervisor alerts on it.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

from crate.db.cache_settings import get_setting

log = logging.getLogger(__name__)


@dataclass
class ThresholdBreach:
    name: str
    value: float
    threshold: float
    severity: str  # "warning" | "critical"


@dataclass
class HealthStatus:
    score: int | None = None
    availability: str = "unavailable"
    observed_at: str | None = None
    inputs: dict = field(default_factory=dict)
    collector_local: dict = field(default_factory=dict)
    breaches: list[ThresholdBreach] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)

    def snapshot(self) -> dict:
        return {
            "schema_version": 2,
            "availability": self.availability,
            "source": "redis_v2",
            "coverage": "observed_only",
            "observed_at": self.observed_at,
            "inputs": self.inputs,
            "collector_local": self.collector_local,
            "score": int(self.score) if self.score is not None else None,
            "breaches": [
                {
                    "name": breach.name[:80],
                    "value": round(float(breach.value), 1),
                    "threshold": round(float(breach.threshold), 1),
                    "severity": breach.severity,
                }
                for breach in self.breaches[:10]
            ],
        }


def _get_threshold(key: str, default: float) -> float:
    keys = [key]
    if key == "api_max_latency_ms":
        keys.append(
            "api_p95_latency_ms"
        )  # Deprecated read-only alias; same maximum semantics.
    for setting in keys:
        raw = get_setting(f"alert_threshold_{setting}")
        if raw is not None:
            try:
                value = float(raw)
                if math.isfinite(value) and value >= 0:
                    return value
            except (ValueError, TypeError):
                pass
    return default


DEFAULT_THRESHOLDS = {
    "api_max_latency_ms": 3000,
    "api_error_rate_pct": 5,
    "worker_queue_depth": 50,
    "disk_warning_pct": 75,
    "disk_critical_pct": 85,
    "disk_emergency_pct": 90,
    "ram_usage_pct": 95,
    "task_failure_rate_pct": 20,
}


def evaluate_health() -> HealthStatus:
    """Evaluate current system health and return a scored status."""
    from crate.metrics import query_summaries, get_collection_health

    status = HealthStatus()
    breaches: list[ThresholdBreach] = []
    summaries = query_summaries(
        {
            "api_latency": ("api.request.latency", 5),
            "api_requests": ("api.request.count", 5),
            "api_errors": ("api.request.count", 5, {"status_class": "5xx"}),
            "queue_depth": ("worker.queue.depth", 5),
        }
    )
    for key in ("api_latency", "api_requests", "api_errors", "queue_depth"):
        sample = summaries.get(key, {})
        status.inputs[key] = {
            "availability": sample.get("availability", "unavailable"),
            "observed_at": sample.get("observed_at"),
            "sample_count": int(sample.get("sample_count", 0)),
            "eligible_count": int(sample.get("eligible_count", 0)),
        }
    states = [value["availability"] for value in status.inputs.values()]
    status.availability = (
        "unavailable"
        if "unavailable" in states
        else "stale"
        if "stale" in states
        else "available"
        if all(state == "available" for state in states)
        else "partial"
    )
    local = get_collection_health()
    status.collector_local = {
        key: local[key] for key in ("scope", "coverage", "availability", "counters")
    }
    if (
        local["availability"] in {"partial", "unavailable"}
        and status.availability == "available"
    ):
        status.availability = local["availability"]
    timestamps = [
        value["observed_at"] for value in status.inputs.values() if value["observed_at"]
    ]
    status.observed_at = min(timestamps) if timestamps else None

    api_latency = summaries.get("api_latency", {})
    api_max = (
        api_latency.get("max")
        if api_latency.get("availability") == "available"
        else None
    )
    status.metrics["api_max"] = api_max
    threshold = _get_threshold(
        "api_max_latency_ms", DEFAULT_THRESHOLDS["api_max_latency_ms"]
    )
    if api_max is not None and api_max > threshold:
        breaches.append(
            ThresholdBreach("API max latency", api_max, threshold, "warning")
        )

    api_requests, api_errors = (
        summaries.get("api_requests", {}),
        summaries.get("api_errors", {}),
    )
    total_requests = api_errors.get("eligible_count", 0)
    error_count = api_errors.get("count", 0)
    error_rate = (
        (error_count / total_requests * 100)
        if total_requests > 0
        and api_requests.get("availability")
        == api_errors.get("availability")
        == "available"
        else None
    )
    status.metrics["api_error_rate"] = error_rate
    threshold = _get_threshold(
        "api_error_rate_pct", DEFAULT_THRESHOLDS["api_error_rate_pct"]
    )
    if error_rate is not None and error_rate > threshold:
        breaches.append(
            ThresholdBreach("API error rate", error_rate, threshold, "critical")
        )

    queue = summaries.get("queue_depth", {})
    queue_depth = queue.get("max") if queue.get("availability") == "available" else None
    status.metrics["queue_depth"] = queue_depth
    threshold = _get_threshold(
        "worker_queue_depth", DEFAULT_THRESHOLDS["worker_queue_depth"]
    )
    if queue_depth is not None and queue_depth > threshold:
        breaches.append(
            ThresholdBreach("Worker queue depth", queue_depth, threshold, "warning")
        )

    # Storage filesystems. CACHE_DIR may intentionally live on a different mount.
    try:
        from crate.storage_health import collect_storage_health

        disks = collect_storage_health()
    except Exception:
        disks = {}
    status.metrics["disks"] = disks
    available_disks = [value for value in disks.values() if value]
    worst = max(available_disks, key=lambda value: value.get("percent", 0), default={})
    status.metrics["disk_usage_pct"] = float(worst.get("percent", 0))
    status.metrics["disk_free_gb"] = float(worst.get("free_gb", 0))
    status.metrics["disk_days_until_full"] = worst.get("days_until_full")
    seen_filesystems: set[tuple[str, str]] = set()
    warning_threshold = _get_threshold(
        "disk_warning_pct", DEFAULT_THRESHOLDS["disk_warning_pct"]
    )
    critical_threshold = _get_threshold(
        "disk_critical_pct", DEFAULT_THRESHOLDS["disk_critical_pct"]
    )
    emergency_threshold = _get_threshold(
        "disk_emergency_pct", DEFAULT_THRESHOLDS["disk_emergency_pct"]
    )
    for label, disk in disks.items():
        path = str(disk.get("path") or label)
        filesystem_id = disk.get("filesystem_id")
        identity = (
            ("device", str(filesystem_id))
            if filesystem_id is not None
            else ("path", path)
        )
        if identity in seen_filesystems:
            continue
        seen_filesystems.add(identity)
        percent = float(disk.get("percent", 0))
        if percent >= emergency_threshold:
            level, threshold, severity = "emergency", emergency_threshold, "critical"
        elif percent >= critical_threshold:
            level, threshold, severity = "critical", critical_threshold, "critical"
        elif percent >= warning_threshold:
            level, threshold, severity = "warning", warning_threshold, "warning"
        else:
            continue
        breaches.append(
            ThresholdBreach(
                f"{label.title()} disk {level}", percent, threshold, severity
            )
        )

    # RAM
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    info[parts[0].rstrip(":")] = int(parts[1])
        total = info.get("MemTotal", 1)
        available = info.get("MemAvailable", 0)
        ram_pct = ((total - available) / total) * 100
        status.metrics["ram_usage_pct"] = ram_pct
        threshold = _get_threshold("ram_usage_pct", DEFAULT_THRESHOLDS["ram_usage_pct"])
        if ram_pct > threshold:
            breaches.append(ThresholdBreach("RAM usage", ram_pct, threshold, "warning"))
    except Exception:
        status.metrics["ram_usage_pct"] = 0

    # Compute degradation score (0-100, 100=healthy)
    # Each breach deducts points based on severity
    score = 100
    for b in breaches:
        if b.severity == "critical":
            score -= 20
        else:
            score -= 10
    status.score = (
        max(0, min(100, score)) if status.availability == "available" else None
    )
    status.breaches = breaches

    return status
