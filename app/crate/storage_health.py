from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from crate.streaming.paths import cache_root, data_root

_GIB = 1024**3


def estimate_days_until_full(
    history: list[dict],
    *,
    current_used_bytes: int,
    free_bytes: int,
    now: datetime | None = None,
) -> float | None:
    current_time = now or datetime.now(timezone.utc)
    oldest: tuple[datetime, float] | None = None
    for sample in history:
        try:
            timestamp = datetime.fromisoformat(str(sample["timestamp"]))
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            used = float(sample["avg"])
        except (KeyError, TypeError, ValueError):
            continue
        if oldest is None or timestamp < oldest[0]:
            oldest = (timestamp, used)
    if oldest is None:
        return None
    elapsed_days = (current_time - oldest[0]).total_seconds() / 86400
    growth = float(current_used_bytes) - oldest[1]
    if elapsed_days < 1 / 24 or growth <= 0 or free_bytes <= 0:
        return None
    growth_per_day = growth / elapsed_days
    if growth_per_day <= 0:
        return None
    return round(float(free_bytes) / growth_per_day, 1)


def pressure_level(percent: float) -> str:
    if percent >= 90:
        return "emergency"
    if percent >= 85:
        return "critical"
    if percent >= 75:
        return "warning"
    return "healthy"


def collect_storage_health() -> dict[str, dict]:
    from crate import metrics

    paths = {
        "music": Path("/music"),
        "data": data_root(),
        "cache": cache_root(),
    }
    result: dict[str, dict] = {}
    for label, path in paths.items():
        try:
            usage = shutil.disk_usage(path)
        except OSError:
            continue
        metric_name = f"storage.{label}.used_bytes"
        try:
            history = metrics.query_recent(metric_name, minutes=1440)
        except Exception:
            history = []
        days_until_full = estimate_days_until_full(
            history,
            current_used_bytes=usage.used,
            free_bytes=usage.free,
        )
        try:
            metrics.record(metric_name, float(usage.used))
        except Exception:
            pass
        percent = round(usage.used / usage.total * 100, 1) if usage.total else 0.0
        result[label] = {
            "path": str(path),
            "filesystem_id": _filesystem_id(path),
            "total_gb": round(usage.total / _GIB, 1),
            "used_gb": round(usage.used / _GIB, 1),
            "free_gb": round(usage.free / _GIB, 1),
            "percent": percent,
            "pressure": pressure_level(percent),
            "days_until_full": days_until_full,
        }
    return result


def _filesystem_id(path: Path) -> int | None:
    try:
        return path.stat().st_dev
    except OSError:
        return None


__all__ = [
    "collect_storage_health",
    "estimate_days_until_full",
    "pressure_level",
]
