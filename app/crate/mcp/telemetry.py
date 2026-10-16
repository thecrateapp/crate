"""Finite metric names; never retain arguments, identities or result values."""


def record_tool_result(
    name: str, latency_ms: float, payload: dict, byte_size: int
) -> None:
    from crate.mcp.tools import ACTION_CATALOG, CATALOG
    from crate.metrics import record_later

    if name not in CATALOG and name not in ACTION_CATALOG:
        return
    code = str((payload.get("error") or {}).get("code") or "")
    outcome = {
        "FORBIDDEN": "denied",
        "RATE_LIMITED": "rate_limited",
        "LIMIT_EXCEEDED": "rate_limited",
        "PLAN_STALE": "conflict",
        "SOURCE_CHANGED": "conflict",
        "EVIDENCE_STALE": "conflict",
        "CURSOR_STALE": "conflict",
        "TARGET_BUSY": "conflict",
        "STATE_CONFLICT": "conflict",
        "IDEMPOTENCY_CONFLICT": "conflict",
        "INVALID_ARGUMENT": "invalid",
        "ACTION_STATUS_UNKNOWN": "status_unknown",
    }.get(code, "unavailable" if code else "success")
    data = payload.get("data") or {}
    if isinstance(data, dict) and (
        data.get("deduplicated") is True or data.get("replayed") is True
    ):
        outcome = "deduplicated"
    try:
        record_later(f"mcp.tool.{name}.latency_ms", max(0, latency_ms))
        record_later(f"mcp.tool.{name}.response_bytes", max(0, byte_size))
        record_later(f"mcp.tool.{name}.{outcome}", 1)
        record_later("mcp.tool.latency_ms", max(0, latency_ms))
        record_later("mcp.tool.response_bytes", max(0, byte_size))
        record_later(f"mcp.tool.{outcome}", 1)
    except Exception:  # noqa: BLE001 — observability must never alter an accepted operation.
        pass


def record_job_result(result: dict) -> None:
    from crate.metrics import record_later

    verification = (result.get("verification") or {}).get("status")
    execution = result.get("execution") or {}
    outcome = (
        "conflict"
        if execution.get("status") == "conflict"
        else "verification_failed"
        if verification in {"failed", "manual_reconciliation_required"}
        else "failed"
        if result.get("status") == "failed"
        else "prepared"
        if execution.get("status") == "prepared"
        else "completed"
    )
    try:
        record_later(f"mcp.job.{outcome}", 1)
    except Exception:  # noqa: BLE001 — never fail an operation for a metric.
        pass
