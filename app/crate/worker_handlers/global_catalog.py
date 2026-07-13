"""Worker handlers for global catalog reconciliation."""

from __future__ import annotations

from datetime import datetime, timezone

from crate.db.repositories.global_catalog_state import (
    get_catalog_state,
    transition_catalog_state,
)
from crate.federation.global_genres import refresh_global_catalog_genre_snapshots
from crate.federation.global_reconciliation import (
    reconcile_dirty_catalog_sources,
    reconcile_local_catalog,
    reconcile_remote_catalog,
)
from crate.worker_handlers import TaskHandler

DEFAULT_BATCH_SIZE = 500
MAX_BATCH_SIZE = 5000


def _handle_reconcile_incremental(task_id: str, params: dict, config: dict) -> dict:
    batch_size = _batch_size(params)
    result = reconcile_dirty_catalog_sources(limit=batch_size)
    if result["completed"]:
        refresh_global_catalog_genre_snapshots()
    return {
        "status": "completed",
        "mode": "incremental",
        **result,
    }


def _handle_reconcile_full(task_id: str, params: dict, config: dict) -> dict:
    batch_size = _batch_size(params)
    state = get_catalog_state()
    if state["status"] != "backfilling":
        transition_catalog_state("backfilling")
    try:
        local = reconcile_local_catalog(batch_size=batch_size)
        remote = reconcile_remote_catalog(batch_size=batch_size)
        refresh_global_catalog_genre_snapshots()
    except Exception as exc:
        transition_catalog_state("failed", last_error=str(exc)[:4000])
        raise

    completed_at = datetime.now(timezone.utc).isoformat()
    transition_catalog_state("ready", last_full_reconcile_at=completed_at)
    return {
        "status": "completed",
        "mode": "full",
        "local": local,
        "remote": remote,
    }


def _batch_size(params: dict) -> int:
    try:
        return max(
            1, min(int(params.get("batch_size", DEFAULT_BATCH_SIZE)), MAX_BATCH_SIZE)
        )
    except (TypeError, ValueError):
        return DEFAULT_BATCH_SIZE


GLOBAL_CATALOG_TASK_HANDLERS: dict[str, TaskHandler] = {
    "global_catalog_reconcile_incremental": _handle_reconcile_incremental,
    "global_catalog_reconcile_full": _handle_reconcile_full,
}
