"""Opt-in persisted observability summary for Admin, MCP and Crate Agent."""

from __future__ import annotations

from crate.observability.summary import compute_observability_summary
from crate.worker_handlers import TaskHandler


def _handle_compute_observability_summary(
    task_id: str, params: dict, config: dict
) -> dict:
    summary = compute_observability_summary()
    return {
        section: summary[section]["availability"]
        for section in ("playback", "product_kpis", "stack")
    }


OBSERVABILITY_SUMMARY_TASK_HANDLERS: dict[str, TaskHandler] = {
    "compute_observability_summary": _handle_compute_observability_summary,
}
