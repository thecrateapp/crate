from __future__ import annotations

from sqlalchemy import text

from crate.db.repositories.runtime_policy import admit_task_start
from crate.db.repositories.tasks_mutation_shared import utc_now_iso
from crate.db.repositories.tasks_shared import (
    _register_task_transition_signal,
    register_tasks_surface_signal,
)
from crate.db.tx import optional_scope
from crate.quality_task_policy import QUALITY_MUTATING_TASK_TYPES


ACTIVE_STATUSES = {"running", "delegated", "completing"}
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


def start_task(
    task_id: str,
    *,
    worker_id: str | None = None,
    session=None,
    expected_policy_revision: int | None = None,
    expected_policy_hash: str | None = None,
) -> dict | None:
    now = utc_now_iso()
    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        if not admit_task_start(
            s,
            task_id,
            worker_id,
            expected_revision=expected_policy_revision,
            expected_hash=expected_policy_hash,
        ):
            return None
        row = (
            s.execute(
                text(
                    """
                UPDATE tasks
                SET status = 'running',
                    started_at = COALESCE(started_at, :now),
                    updated_at = :now,
                    heartbeat_at = :now,
                    worker_id = :worker_id,
                    error = NULL
                WHERE id = :id
                  AND status = 'pending' AND cancellation_requested_at IS NULL
                RETURNING *
                """
                ),
                {"now": now, "worker_id": worker_id, "id": task_id},
            )
            .mappings()
            .first()
        )
        if row is not None:
            _register_task_transition_signal(s, dict(row))
        if row is not None and row["type"] in QUALITY_MUTATING_TASK_TYPES:
            from crate.db.analytics_quality_surface import mark_quality_report_stale

            mark_quality_report_stale(session=s)
    return dict(row) if row else None


def update_task(
    task_id: str,
    *,
    status: str | None = None,
    progress: str | None = None,
    result: dict | None = None,
    error: str | None = None,
    session=None,
    dumps_fn,
    register_tasks_surface_signal_fn,
):
    now = utc_now_iso()
    fields = ["updated_at = :updated_at"]
    params: dict[str, object] = {"updated_at": now, "task_id": task_id}
    if status is not None:
        fields.append("status = :set_status")
        params["set_status"] = status
        if status == "running":
            fields.append("started_at = COALESCE(started_at, :set_started_at)")
            fields.append("heartbeat_at = :set_started_at")
            params["set_started_at"] = now
        elif status in ACTIVE_STATUSES:
            fields.append("heartbeat_at = NULL")
            fields.append("worker_id = NULL")
        elif status in TERMINAL_STATUSES:
            fields.append("heartbeat_at = NULL")
            fields.append("worker_id = NULL")
            if status == "completed":
                fields.append("error = NULL")
    if progress is not None:
        fields.append("progress = :set_progress")
        params["set_progress"] = progress
    if result is not None:
        fields.append("result_json = :set_result_json")
        params["set_result_json"] = dumps_fn(result)
    if error is not None:
        fields.append("error = :set_error")
        params["set_error"] = error

    # SQL_SAFE: fields are built internally from hardcoded column names; values use SQL params.
    with optional_scope(session) as s:
        register_tasks_surface_signal_fn(s)
        row = (
            s.execute(
                text(
                    f"UPDATE tasks SET {', '.join(fields)} WHERE id = :task_id AND status NOT IN ('completed','failed','cancelled') RETURNING *"
                ),
                params,
            )
            .mappings()
            .first()
        )
        if status is not None and row is not None:
            _register_task_transition_signal(s, dict(row))
        if (
            status is not None
            and row is not None
            and row["type"] in QUALITY_MUTATING_TASK_TYPES
        ):
            from crate.db.analytics_quality_surface import mark_quality_report_stale

            mark_quality_report_stale(session=s)


def heartbeat_task(task_id: str, *, session=None):
    with optional_scope(session) as s:
        s.execute(
            text(
                """
                UPDATE tasks
                SET heartbeat_at = :now,
                    updated_at = :now
                WHERE id = :id
                  AND status = 'running'
                """
            ),
            {"now": utc_now_iso(), "id": task_id},
        )


def fail_or_retry_task(task_id: str, error: str, *, session=None) -> str:
    now = utc_now_iso()
    trimmed_error = str(error or "Task failed")[:500]

    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        row = (
            s.execute(
                text(
                    """
                SELECT *
                FROM tasks
                WHERE id = :id
                FOR UPDATE
                """
                ),
                {"id": task_id},
            )
            .mappings()
            .first()
        )
        if not row:
            return "missing"

        status = str(row.get("status") or "")
        if status in TERMINAL_STATUSES:
            return status

        if row["type"] in QUALITY_MUTATING_TASK_TYPES:
            from crate.db.analytics_quality_surface import mark_quality_report_stale

            mark_quality_report_stale(session=s)

        retry_count = int(row.get("retry_count") or 0)
        max_retries = int(row.get("max_retries") or 0)
        if retry_count < max_retries and row["cancellation_requested_at"] is None:
            next_retry = retry_count + 1
            transition = (
                s.execute(
                    text(
                        """
                    UPDATE tasks
                    SET status = 'pending',
                        retry_count = :retry_count,
                        updated_at = :now,
                        heartbeat_at = NULL,
                        worker_id = NULL,
                        error = :error,
                        progress = :progress
                    WHERE id = :id
                    RETURNING *
                    """
                    ),
                    {
                        "id": task_id,
                        "retry_count": next_retry,
                        "now": now,
                        "error": trimmed_error,
                        "progress": f"Retrying after worker error ({next_retry}/{max_retries})",
                    },
                )
                .mappings()
                .first()
            )
            if transition is not None:
                _register_task_transition_signal(s, dict(transition))
            return "retrying"

        transition = (
            s.execute(
                text(
                    """
                UPDATE tasks
                SET status = 'failed',
                    updated_at = :now,
                    heartbeat_at = NULL,
                    worker_id = NULL,
                    error = :error,
                    result_json = CASE WHEN cancellation_requested_at IS NOT NULL
                        THEN COALESCE(result_json,'{}'::jsonb) || jsonb_build_object(
                            'execution',COALESCE(result_json->'execution','{}'::jsonb)||'{"status": "partial"}'::jsonb,
                            'verification',COALESCE(result_json->'verification','{}'::jsonb)||'{"status": "manual_reconciliation_required"}'::jsonb)
                        ELSE result_json END
                WHERE id = :id
                RETURNING *
                """
                ),
                {"id": task_id, "now": now, "error": trimmed_error},
            )
            .mappings()
            .first()
        )
        if transition is not None:
            _register_task_transition_signal(s, dict(transition))
        return "failed"


__all__ = [
    "fail_or_retry_task",
    "heartbeat_task",
    "start_task",
    "update_task",
]
