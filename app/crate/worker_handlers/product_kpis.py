"""Daily product KPIs, recomputed hourly from rollups and small tables."""

from __future__ import annotations

from crate.db.jobs.product_kpis import compute_product_kpis, product_kpi_days_due
from crate.worker_handlers import TaskHandler, is_cancelled

CHUNK_DAYS = 31


def _handle_compute_product_kpis(task_id: str, params: dict, config: dict) -> dict:
    days = product_kpi_days_due()
    rows = 0
    for offset in range(0, len(days), CHUNK_DAYS):
        if is_cancelled(task_id):
            return {"status": "cancelled", "days": offset, "rows": rows}
        rows += compute_product_kpis(days[offset : offset + CHUNK_DAYS])
    return {
        "days": len(days),
        "rows": rows,
        "first_day": days[0].isoformat() if days else None,
        "last_day": days[-1].isoformat() if days else None,
    }


PRODUCT_KPI_TASK_HANDLERS: dict[str, TaskHandler] = {
    "compute_product_kpis": _handle_compute_product_kpis,
}
