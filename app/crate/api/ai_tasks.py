"""Queue AI tasks from routes with the 202 pattern (SM3-D8, SMQ)."""

from __future__ import annotations

from crate.db.queries.tasks import find_latest_task_by_dedup_key
from crate.db.repositories.tasks import (
    create_task_dedup,
    find_active_task_by_type_params,
)


def queue_ai_task(task_type: str, params: dict, *, dedup_key: str) -> dict:
    """Queue once per dedup key and return a TaskEnqueueResponse payload.

    A duplicate request joins the active task. If that task finished between
    the dedup check and the lookup, the finished task is returned instead of
    an error, so the client still reads the result it already paid for.
    """
    task_id = create_task_dedup(task_type, params, dedup_key=dedup_key)
    if task_id is not None:
        return {"task_id": task_id, "status": "queued", "deduplicated": False}
    active = find_active_task_by_type_params(task_type, dedup_key=dedup_key)
    if active is not None:
        return {"task_id": active, "status": "queued", "deduplicated": True}
    latest = find_latest_task_by_dedup_key(task_type, dedup_key)
    if latest is None:
        # Nothing left to join (the row was pruned): queue a fresh task.
        task_id = create_task_dedup(task_type, params, dedup_key=dedup_key)
        return {"task_id": task_id, "status": "queued", "deduplicated": False}
    return {"task_id": latest["id"], "status": latest["status"], "deduplicated": True}
