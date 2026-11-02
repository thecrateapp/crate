"""Playback quality readings derived from metric summaries for Admin."""

from __future__ import annotations

MINIMUM_ATTEMPTS = 20
WINDOW_MINUTES = 15

SUMMARY_SPECS = {
    "playback_intents": ("playback.intent.count", WINDOW_MINUTES),
    "playback_started": (
        "playback.result.count",
        WINDOW_MINUTES,
        {"outcome": "started"},
    ),
    "playback_failed": ("playback.result.count", WINDOW_MINUTES, {"outcome": "failed"}),
    "playback_cancelled": (
        "playback.result.count",
        WINDOW_MINUTES,
        {"outcome": "cancelled"},
    ),
    "playback_active_ms": ("playback.active.ms", WINDOW_MINUTES),
    "playback_telemetry_accepted": (
        "playback.telemetry.events",
        WINDOW_MINUTES,
        {"outcome": "accepted"},
    ),
    "playback_telemetry_unverified": (
        "playback.telemetry.events",
        WINDOW_MINUTES,
        {"outcome": "unverified"},
    ),
    "playback_telemetry_rate_limited": (
        "playback.telemetry.events",
        WINDOW_MINUTES,
        {"outcome": "rate_limited"},
    ),
    "playback_telemetry_duplicates": (
        "playback.telemetry.events",
        WINDOW_MINUTES,
        {"outcome": "duplicate"},
    ),
    "playback_client_loss": ("playback.telemetry.client_loss", WINDOW_MINUTES),
    "playback_payload_v1": (
        "playback.telemetry.payload",
        WINDOW_MINUTES,
        {"version": "v1"},
    ),
    "playback_payload_v2": (
        "playback.telemetry.payload",
        WINDOW_MINUTES,
        {"version": "v2"},
    ),
}

_REQUIRED = ("playback_intents", "playback_started", "playback_failed")


def _total(summary: dict, key: str) -> float | None:
    entry = summary.get(key) or {}
    availability = entry.get("availability")
    if availability in (None, "unavailable"):
        return None
    if not entry.get("count"):
        return 0.0
    return float(entry.get("sum") or 0)


def _ratio(part: float | None, whole: float | None) -> float | None:
    if part is None or not whole:
        return None
    return round(part / whole, 4)


def derive_playback_qoe(summary: dict) -> dict:
    totals = {key: _total(summary, key) for key in SUMMARY_SPECS}
    for key in ("playback_stall_ms", "playback_stalls", "playback_recoveries"):
        totals[key] = _total(summary, key)
    started, failed = totals["playback_started"], totals["playback_failed"]
    attempts = None if started is None or failed is None else started + failed
    active, stall = totals["playback_active_ms"], totals["playback_stall_ms"]
    observed = None if active is None or stall is None else active + stall
    caveats = [
        reason
        for reason, key in (
            ("legacy_clients", "playback_payload_v1"),
            ("client_losses", "playback_client_loss"),
            ("unverified_events", "playback_telemetry_unverified"),
            ("rate_limited_events", "playback_telemetry_rate_limited"),
        )
        if totals[key]
    ]
    states = {
        (summary.get(key) or {}).get("availability")
        for key in (*SUMMARY_SPECS, "playback_stall_ms")
    }
    if attempts is None or any(totals[key] is None for key in _REQUIRED):
        availability, reason = "unavailable", "metric_source_unavailable"
    elif not totals["playback_payload_v2"] and not attempts:
        availability, reason = "empty", "no_current_clients"
    elif attempts < MINIMUM_ATTEMPTS:
        availability, reason = "insufficient_sample", None
    elif "stale" in states:
        availability, reason = "stale", None
    elif caveats or "partial" in states:
        availability, reason = "partial", ",".join(caveats) or "partial_window"
    else:
        availability, reason = "available", None
    startup = summary.get("playback_startup_ms") or {}
    return {
        "availability": availability,
        "reason": reason,
        "caveats": caveats,
        "window_minutes": WINDOW_MINUTES,
        "minimum_attempts": MINIMUM_ATTEMPTS,
        "intents": totals["playback_intents"],
        "attempts": attempts,
        "started": started,
        "failed": failed,
        "cancelled": totals["playback_cancelled"],
        "start_success_ratio": _ratio(started, attempts),
        "stall_ratio": _ratio(stall, observed),
        "startup_avg_ms": startup.get("avg") if startup.get("count") else None,
        "stalls": totals["playback_stalls"],
        "recoveries": totals["playback_recoveries"],
        "telemetry": {
            "accepted": totals["playback_telemetry_accepted"],
            "unverified": totals["playback_telemetry_unverified"],
            "rate_limited": totals["playback_telemetry_rate_limited"],
            "duplicates": totals["playback_telemetry_duplicates"],
            "client_losses": totals["playback_client_loss"],
            "legacy_batches": totals["playback_payload_v1"],
            "current_batches": totals["playback_payload_v2"],
        },
    }


__all__ = ["MINIMUM_ATTEMPTS", "SUMMARY_SPECS", "derive_playback_qoe"]
