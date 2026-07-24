"""Low-cardinality runtime saturation telemetry."""

from __future__ import annotations

import asyncio
from threading import Lock
from typing import Any

_lock = Lock()
_last_lag_ms = 0.0
_max_lag_ms = 0.0
_total_lag_ms = 0.0
_samples = 0


async def monitor_event_loop_lag(*, interval_seconds: float = 1.0) -> None:
    interval = max(0.01, float(interval_seconds))
    loop = asyncio.get_running_loop()
    while True:
        expected = loop.time() + interval
        await asyncio.sleep(interval)
        lag_ms = max(0.0, (loop.time() - expected) * 1000)
        _record_event_loop_lag(lag_ms)


def _record_event_loop_lag(lag_ms: float) -> None:
    global _last_lag_ms, _max_lag_ms, _total_lag_ms, _samples
    with _lock:
        _last_lag_ms = lag_ms
        _max_lag_ms = max(_max_lag_ms, lag_ms)
        _total_lag_ms += lag_ms
        _samples += 1


def reset_runtime_saturation() -> None:
    global _last_lag_ms, _max_lag_ms, _total_lag_ms, _samples
    with _lock:
        _last_lag_ms = 0.0
        _max_lag_ms = 0.0
        _total_lag_ms = 0.0
        _samples = 0


def get_runtime_saturation() -> dict[str, Any]:
    from crate.db.engine import get_pool_runtime

    with _lock:
        event_loop = {
            "last_lag_ms": round(_last_lag_ms, 3),
            "max_lag_ms": round(_max_lag_ms, 3),
            "average_lag_ms": round(_total_lag_ms / _samples, 3) if _samples else 0.0,
            "samples": _samples,
        }
    return {"event_loop": event_loop, "database": get_pool_runtime()}


__all__ = [
    "get_runtime_saturation",
    "monitor_event_loop_lag",
    "reset_runtime_saturation",
]
