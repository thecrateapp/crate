"""Mutation helpers for persistent import queue read models."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.import_queue_shared import coerce_json
from crate.db.ops_runtime import set_ops_runtime_state
from crate.db.tx import transaction_scope
from crate.db.ui_snapshot_store import mark_ui_snapshots_stale


def _rowcount(result: Any) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def mark_import_queue_item_imported(
    source_path: str,
    *,
    result: dict[str, Any],
    source: str | None = None,
) -> bool:
    return _update_import_queue_item_status(
        source_path,
        status=result.get("status") or "imported",
        payload_patch=result,
        source=source,
    )


def mark_import_queue_item_importing(
    source_path: str,
    *,
    task_id: str,
    source: str | None = None,
) -> bool:
    """Atomically claim one pending staged album for an import task."""
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    UPDATE import_queue_items
                    SET status = 'importing',
                        payload_json = COALESCE(payload_json, '{}'::jsonb)
                            || jsonb_build_object(
                                'task_id', :task_id,
                                'started_at', NOW(),
                                'last_error', NULL
                            ),
                        updated_at = NOW()
                    WHERE path = :path
                      AND (:source IS NULL OR source = :source)
                      AND status = 'pending'
                    RETURNING source, path
                    """
                ),
                {
                    "path": source_path,
                    "source": source,
                    "task_id": task_id,
                },
            )
            .mappings()
            .first()
        )
        if not row:
            return False

        pending_count = int(
            session.execute(
                text("SELECT COUNT(*) FROM import_queue_items WHERE status = 'pending'")
            ).scalar()
            or 0
        )
        set_ops_runtime_state(
            "imports_pending", {"count": pending_count}, session=session
        )
        mark_ui_snapshots_stale(scope="ops", subject_key="dashboard", session=session)
        append_domain_event(
            "library.import_queue.changed",
            {
                "pending_count": pending_count,
                "path": row["path"],
                "status": "importing",
            },
            scope="ops",
            subject_key="import_queue",
            session=session,
        )
        return True


def mark_import_queue_item_pending(
    source_path: str,
    *,
    source: str | None = None,
    error: str | None = None,
) -> bool:
    """Return a failed import to the retryable staging queue."""
    return _update_import_queue_item_status(
        source_path,
        status="pending",
        payload_patch={"task_id": None, "last_error": error},
        source=source,
    )


def release_orphaned_import_claims() -> int:
    """Return staged albums to pending when their import task is no longer active."""
    with transaction_scope() as session:
        released = (
            session.execute(
                text(
                    """
                    UPDATE import_queue_items item
                    SET status = 'pending',
                        payload_json = COALESCE(item.payload_json, '{}'::jsonb)
                            || jsonb_build_object(
                                'status', 'pending',
                                'task_id', NULL,
                                'last_error', 'Import task stopped before finishing'
                            ),
                        updated_at = NOW()
                    WHERE item.status = 'importing'
                      AND NOT EXISTS (
                          SELECT 1 FROM tasks task
                          WHERE task.id = item.payload_json->>'task_id'
                            AND task.status IN ('pending', 'running', 'delegated', 'completing')
                      )
                    RETURNING item.path
                    """
                )
            )
            .scalars()
            .all()
        )
        if not released:
            return 0
        pending_count = int(
            session.execute(
                text("SELECT COUNT(*) FROM import_queue_items WHERE status = 'pending'")
            ).scalar()
            or 0
        )
        set_ops_runtime_state(
            "imports_pending", {"count": pending_count}, session=session
        )
        mark_ui_snapshots_stale(scope="ops", subject_key="dashboard", session=session)
        append_domain_event(
            "library.import_queue.changed",
            {"pending_count": pending_count, "released": len(released)},
            scope="ops",
            subject_key="import_queue",
            session=session,
        )
        return len(released)


def remove_import_queue_item(source_path: str, *, source: str | None = None) -> bool:
    with transaction_scope() as session:
        if source:
            result = session.execute(
                text(
                    "DELETE FROM import_queue_items WHERE source = :source AND path = :path"
                ),
                {"source": source, "path": source_path},
            )
        else:
            result = session.execute(
                text("DELETE FROM import_queue_items WHERE path = :path"),
                {"path": source_path},
            )
        removed = _rowcount(result)
        pending_count = int(
            session.execute(
                text(
                    "SELECT COUNT(*) AS cnt FROM import_queue_items WHERE status = 'pending'"
                )
            ).scalar()
            or 0
        )
        set_ops_runtime_state(
            "imports_pending", {"count": pending_count}, session=session
        )
        if removed:
            mark_ui_snapshots_stale(
                scope="ops", subject_key="dashboard", session=session
            )
            append_domain_event(
                "library.import_queue.changed",
                {"pending_count": pending_count, "removed": removed},
                scope="ops",
                subject_key="import_queue",
                session=session,
            )
        return removed > 0


def _update_import_queue_item_status(
    source_path: str,
    *,
    status: str,
    payload_patch: dict[str, Any] | None = None,
    source: str | None = None,
) -> bool:
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                SELECT source, path, payload_json
                FROM import_queue_items
                WHERE path = :path
                  AND (:source IS NULL OR source = :source)
                ORDER BY updated_at DESC
                LIMIT 1
                """
                ),
                {"path": source_path, "source": source},
            )
            .mappings()
            .first()
        )
        if not row:
            return False

        payload_raw = coerce_json(row.get("payload_json"))
        payload = payload_raw if isinstance(payload_raw, dict) else {}
        if payload_patch:
            payload.update(payload_patch)
        payload["status"] = status

        session.execute(
            text(
                """
                UPDATE import_queue_items
                SET status = :status,
                    payload_json = CAST(:payload_json AS jsonb),
                    updated_at = NOW()
                WHERE source = :source AND path = :path
                """
            ),
            {
                "status": status,
                "payload_json": json.dumps(payload, default=str),
                "source": row["source"],
                "path": row["path"],
            },
        )
        pending_count = int(
            session.execute(
                text(
                    "SELECT COUNT(*) AS cnt FROM import_queue_items WHERE status = 'pending'"
                )
            ).scalar()
            or 0
        )
        set_ops_runtime_state(
            "imports_pending", {"count": pending_count}, session=session
        )
        mark_ui_snapshots_stale(scope="ops", subject_key="dashboard", session=session)
        append_domain_event(
            "library.import_queue.changed",
            {
                "pending_count": pending_count,
                "path": row["path"],
                "status": status,
            },
            scope="ops",
            subject_key="import_queue",
            session=session,
        )
        return True


__all__ = [
    "mark_import_queue_item_imported",
    "mark_import_queue_item_importing",
    "mark_import_queue_item_pending",
    "release_orphaned_import_claims",
    "remove_import_queue_item",
]
