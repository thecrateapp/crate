"""Health evaluation and alerting engine.

Computes a degradation score (0–100) from metrics and checks
thresholds. Integrates with Telegram for proactive alerts.
"""

from __future__ import annotations

import logging
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
    score: int = 100
    breaches: list[ThresholdBreach] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)

    def summary_text(self) -> str:
        lines = []
        m = self.metrics
        lines.append(
            f"\U0001f4ca API: p95 {m.get('api_p95', 0):.0f}ms, {m.get('api_error_rate', 0):.1f}% errors"
        )
        lines.append(f"\u2699\ufe0f Queue: {m.get('queue_depth', 0):.0f} pending")
        lines.append(
            f"\U0001f4be Disk: {m.get('disk_free_gb', 0):.0f} GB free ({m.get('disk_usage_pct', 0):.0f}%)"
        )
        if m.get("disk_days_until_full") is not None:
            lines.append(
                f"\u23f3 Disk projection: {m['disk_days_until_full']:.1f} days remaining"
            )
        lines.append(f"\U0001f9e0 RAM: {m.get('ram_usage_pct', 0):.0f}%")
        if self.breaches:
            lines.append("")
            lines.append("\u26a0\ufe0f Breaches:")
            for b in self.breaches:
                lines.append(
                    f"  \u2022 {b.name}: {b.value:.1f} (threshold: {b.threshold})"
                )
        return "\n".join(lines)


def _get_threshold(key: str, default: float) -> float:
    raw = get_setting(f"alert_threshold_{key}")
    if raw is not None:
        try:
            return float(raw)
        except (ValueError, TypeError):
            pass
    return default


DEFAULT_THRESHOLDS = {
    "api_p95_latency_ms": 3000,
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
    from crate.metrics import query_summary

    status = HealthStatus()
    breaches: list[ThresholdBreach] = []

    # API latency
    api_latency = query_summary("api.request.latency", minutes=5)
    api_p95 = api_latency.get("max", 0)  # approximation — max of 5min as p95 proxy
    status.metrics["api_p95"] = api_p95
    threshold = _get_threshold(
        "api_p95_latency_ms", DEFAULT_THRESHOLDS["api_p95_latency_ms"]
    )
    if api_p95 > threshold:
        breaches.append(
            ThresholdBreach("API p95 latency", api_p95, threshold, "warning")
        )

    # API error rate
    api_requests = query_summary("api.request.count", minutes=5)
    api_errors = query_summary("api.request.errors", minutes=5)
    total_requests = api_requests.get("count", 0)
    error_count = api_errors.get("count", 0)
    error_rate = (error_count / total_requests * 100) if total_requests > 0 else 0
    status.metrics["api_error_rate"] = error_rate
    threshold = _get_threshold(
        "api_error_rate_pct", DEFAULT_THRESHOLDS["api_error_rate_pct"]
    )
    if error_rate > threshold:
        breaches.append(
            ThresholdBreach("API error rate", error_rate, threshold, "critical")
        )

    # Queue depth
    queue = query_summary("worker.queue.depth", minutes=5)
    queue_depth = queue.get("max", 0)
    status.metrics["queue_depth"] = queue_depth
    threshold = _get_threshold(
        "worker_queue_depth", DEFAULT_THRESHOLDS["worker_queue_depth"]
    )
    if queue_depth > threshold:
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
    status.score = max(0, min(100, score))
    status.breaches = breaches

    return status


def check_and_alert():
    """Evaluate health and send Telegram alerts if thresholds are breached.

    Called from the Telegram bot loop every 5 minutes.
    """
    from crate.telegram import send_alert

    status = evaluate_health()

    if status.score < 50:
        send_alert(
            "critical",
            f"\U0001f534 Service CRITICAL ({status.score}/100)\n\n{status.summary_text()}",
        )
    elif status.score < 80:
        send_alert(
            "degraded",
            f"\u26a0\ufe0f Service degraded ({status.score}/100)\n\n{status.summary_text()}",
        )

    for breach in status.breaches:
        send_alert(
            f"metric:{breach.name}",
            f"\u26a0\ufe0f <b>{breach.name}</b>: {breach.value:.1f} (threshold: {breach.threshold})",
        )
