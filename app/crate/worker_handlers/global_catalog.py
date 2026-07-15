"""Worker handlers for global catalog reconciliation."""

from __future__ import annotations

from datetime import datetime, timezone

from crate.db.repositories.global_catalog_state import (
    get_catalog_state,
    transition_catalog_state,
)
from crate.db.repositories.tasks import create_task
from crate.db.repositories.global_user_library import (
    USER_LIBRARY_REFS_BACKFILL_VERSION,
    backfill_legacy_user_library_refs_batch,
    finalize_user_library_refs_backfill,
)
from crate.federation.global_genres import refresh_global_catalog_genre_snapshots
from crate.federation.global_reconciliation import (
    prune_local_catalog_sources_batch,
    prune_remote_catalog_sources_batch,
    reconcile_dirty_catalog_sources,
    reconcile_local_catalog_batch,
    reconcile_remote_catalog_batch,
)
from crate.worker_handlers import TaskHandler

DEFAULT_BATCH_SIZE = 500
MAX_BATCH_SIZE = 5000
_USER_REF_COUNTERS = (
    "artist_follows",
    "album_saves",
    "track_likes",
    "playlist_tracks",
    "playlist_track_exclusions",
    "play_events",
    "listening_stats_users",
)


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
    bootstrap = state.get("bootstrap_cursor_json")
    bootstrap = bootstrap if isinstance(bootstrap, dict) else {}
    phase = str(bootstrap.get("phase") or "local")
    cursor = bootstrap.get("cursor")
    try:
        if phase == "local":
            batch = reconcile_local_catalog_batch(
                batch_size=batch_size,
                cursor=cursor if isinstance(cursor, dict) else None,
            )
            return _continue_full_reconciliation(
                task_id,
                params,
                current_phase="local",
                next_phase="local_prune" if batch["completed"] else "local",
                result=batch,
                batch_size=batch_size,
            )
        if phase == "local_prune":
            batch = prune_local_catalog_sources_batch(
                batch_size=batch_size,
                cursor=int(cursor) if cursor is not None else None,
            )
            return _continue_full_reconciliation(
                task_id,
                params,
                current_phase="local_prune",
                next_phase="remote" if batch["completed"] else "local_prune",
                result=batch,
                batch_size=batch_size,
            )
        if phase == "remote":
            batch = reconcile_remote_catalog_batch(
                batch_size=batch_size,
                cursor=cursor if isinstance(cursor, dict) else None,
            )
            return _continue_full_reconciliation(
                task_id,
                params,
                current_phase="remote",
                next_phase="remote_prune" if batch["completed"] else "remote",
                result=batch,
                batch_size=batch_size,
            )
        if phase == "remote_prune":
            batch = prune_remote_catalog_sources_batch(
                batch_size=batch_size,
                cursor=int(cursor) if cursor is not None else None,
            )
            return _continue_full_reconciliation(
                task_id,
                params,
                current_phase="remote_prune",
                next_phase="user_refs" if batch["completed"] else "remote_prune",
                result=batch,
                batch_size=batch_size,
            )
        if phase == "user_refs":
            report = bootstrap.get("user_refs_report")
            report = dict(report) if isinstance(report, dict) else {}
            user_refs = backfill_legacy_user_library_refs_batch(
                batch_size=batch_size,
                cursor=int(cursor) if cursor is not None else None,
                rebuild_listening_stats=(
                    int(state.get("user_refs_backfill_version") or 0)
                    < USER_LIBRARY_REFS_BACKFILL_VERSION
                ),
            )
            for name in _USER_REF_COUNTERS:
                report[name] = int(report.get(name) or 0) + int(
                    user_refs.get(name) or 0
                )
            if user_refs["completed"]:
                finalized_report = finalize_user_library_refs_backfill(report)
                next_cursor_json = {
                    "phase": "snapshots",
                    "cursor": None,
                    "user_refs_report": finalized_report,
                }
            else:
                next_cursor_json = {
                    "phase": "user_refs",
                    "cursor": user_refs["next_cursor"],
                    "user_refs_report": report,
                }
            transition_catalog_state(
                "backfilling",
                bootstrap_cursor_json=next_cursor_json,
            )
            continuation_task_id = _queue_full_reconciliation_continuation(
                task_id, params, batch_size
            )
            return {
                "status": "continued",
                "mode": "full",
                "phase": "user_refs",
                "completed": False,
                "batch": user_refs,
                "continuation_task_id": continuation_task_id,
            }
        if phase != "snapshots":
            raise ValueError(f"Unsupported catalog reconciliation phase: {phase}")
        refresh_global_catalog_genre_snapshots()
    except Exception as exc:
        transition_catalog_state("failed", last_error=str(exc)[:4000])
        raise

    completed_at = datetime.now(timezone.utc).isoformat()
    transition_catalog_state(
        "ready",
        last_full_reconcile_at=completed_at,
        bootstrap_cursor_json={},
    )
    return {
        "status": "completed",
        "mode": "full",
        "phase": "snapshots",
        "completed": True,
    }


def _persist_partial_reconciliation(phase: str, result: dict) -> None:
    transition_catalog_state(
        "backfilling",
        bootstrap_cursor_json={"phase": phase, "cursor": result["next_cursor"]},
    )


def _continue_full_reconciliation(
    task_id: str,
    params: dict,
    *,
    current_phase: str,
    next_phase: str,
    result: dict,
    batch_size: int,
) -> dict:
    next_cursor = result.get("next_cursor") if next_phase == current_phase else None
    transition_catalog_state(
        "backfilling",
        bootstrap_cursor_json={"phase": next_phase, "cursor": next_cursor},
    )
    continuation_task_id = _queue_full_reconciliation_continuation(
        task_id, params, batch_size
    )
    return {
        "status": "continued",
        "mode": "full",
        "phase": current_phase,
        "completed": False,
        "batch": result,
        "continuation_task_id": continuation_task_id,
    }


def _queue_full_reconciliation_continuation(
    task_id: str, params: dict, batch_size: int
) -> str:
    continuation_params = {
        "batch_size": batch_size,
        "triggered_by": "continuation",
    }
    return create_task(
        "global_catalog_reconcile_full",
        continuation_params,
        parent_task_id=task_id,
    )


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
