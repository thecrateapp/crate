import asyncio
import time
import json as _json
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.responses import StreamingResponse

from crate.api._deps import json_dumps
from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.tasks import (
    AdminTasksSnapshotResponse,
    CancelAllTasksResponse,
    ScheduleRunResponse,
    TaskCatalogResponse,
    TaskCancelResponse,
    TaskCleanupRequest,
    TaskCleanupResponse,
    TaskCleanByStatusResponse,
    TaskResponse,
    TaskRetryRequest,
    TaskRetryResponse,
    WorkerRestartResponse,
    WorkerSchedulesResponse,
    WorkerSchedulesUpdateRequest,
    WorkerSchedulesUpdateResponse,
    WorkerSlotsRequest,
    WorkerSlotsResponse,
    WorkerStatusResponse,
)
from crate.db.admin_tasks_surface import (
    TASKS_SURFACE_STREAM_CHANNEL,
    get_cached_tasks_surface,
)
from crate.db.cache_store import get_cache
from crate.db.queries.tasks import get_task, list_tasks
from crate.db.repositories.tasks import (
    create_task,
    delete_old_finished_tasks,
    delete_tasks_by_status,
)
from crate.docker_ctl import restart_container
from crate.media_worker_progress import cancel_media_worker_job
from crate.db.repositories.runtime_policy import (
    read_runtime_policy_state,
    read_schedules_state,
    update_admission_slots,
    update_schedules,
)
from crate.runtime_policy_contract import PolicyRevisionConflict
from crate.scheduler import DEFAULT_SCHEDULES, guarded_run_schedule
from crate.task_registry import (
    TASK_ACTIONS,
    TASK_CATEGORIES,
    TASK_TYPES,
    task_category,
    task_label,
)
from crate.api.redis_sse import close_pubsub, open_pubsub

router = APIRouter(tags=["tasks"])

DEFAULT_MAX_WORKERS = 5
DEFAULT_MIN_WORKERS = 2

_TASK_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested task resource could not be found."),
        409: error_response("A conflicting task is already running."),
        422: error_response("The request payload failed validation."),
        500: error_response("The worker action failed."),
    },
)


def _require_task_operator(request: Request) -> dict:
    return require_permission(request, "ops.tasks.manage")


def _require_analysis_manager(request: Request) -> dict:
    return require_permission(request, "library.analysis.manage")


TASKS_STREAM_REFRESH_SECONDS = 2


async def _tasks_stream(limit: int) -> AsyncIterator[str]:
    pubsub = None
    try:
        pubsub = await open_pubsub(TASKS_SURFACE_STREAM_CHANNEL)
        heartbeat_counter = 0
        pending = False
        yield f"data: {json_dumps(get_cached_tasks_surface(limit=limit))}\n\n"
        last_sent = time.monotonic()
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if message and message.get("type") == "message":
                pending = True
                try:
                    signal = _json.loads(message.get("data") or "{}")
                except (TypeError, ValueError):
                    signal = {}
                transition = signal.get("task") if isinstance(signal, dict) else None
                if (
                    isinstance(signal, dict)
                    and signal.get("kind") == "task_transition"
                    and isinstance(transition, dict)
                ):
                    yield f"event: task_transition\ndata: {json_dumps(transition)}\n\n"
            now = time.monotonic()
            if pending and now - last_sent >= TASKS_STREAM_REFRESH_SECONDS:
                snapshot = await asyncio.to_thread(
                    get_cached_tasks_surface,
                    limit=limit,
                    max_age_seconds=TASKS_STREAM_REFRESH_SECONDS,
                )
                yield f"data: {json_dumps(snapshot)}\n\n"
                pending = False
                last_sent = now
                heartbeat_counter = 0
                continue
            heartbeat_counter += 1
            if heartbeat_counter >= 30:
                heartbeat_counter = 0
                yield ": heartbeat\n\n"
    except Exception:
        while True:
            yield f"data: {json_dumps(get_cached_tasks_surface(limit=limit))}\n\n"
            await asyncio.sleep(15)
    finally:
        if pubsub is not None:
            await close_pubsub(pubsub, TASKS_SURFACE_STREAM_CHANNEL)


@router.get(
    "/api/admin/tasks-snapshot",
    response_model=AdminTasksSnapshotResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical admin tasks snapshot",
)
def api_admin_tasks_snapshot(request: Request, fresh: bool = False, limit: int = 100):
    _require_task_operator(request)
    return get_cached_tasks_surface(limit=limit, fresh=fresh)


@router.get(
    "/api/admin/tasks-stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream admin task snapshot updates",
)
async def api_admin_tasks_stream(request: Request, limit: int = 100):
    _require_task_operator(request)
    safe_limit = min(max(limit, 1), 200)
    return StreamingResponse(
        _tasks_stream(safe_limit),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/api/tasks",
    response_model=list[TaskResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List background tasks",
)
def api_tasks(
    request: Request, status: str | None = None, limit: int = 50, fresh: bool = False
):
    _require_auth(request)
    snapshot = get_cached_tasks_surface(limit=200 if status else limit, fresh=fresh)
    tasks = snapshot.get("history") or []
    if status:
        if status == "running":
            tasks = [
                task
                for task in tasks
                if task.get("status") in {"running", "delegated", "completing"}
            ]
        else:
            tasks = [task for task in tasks if task.get("status") == status]
    result = []
    for t in tasks:
        result.append(
            {
                "id": t["id"],
                "type": t["type"],
                "status": t["status"],
                "progress": t.get("progress"),
                "error": t.get("error"),
                "result": t.get("result"),
                "params": t.get("params"),
                "priority": t.get("priority", 2),
                "pool": t.get("pool", "default"),
                "created_at": t.get("created_at"),
                "started_at": t.get("started_at"),
                "updated_at": t.get("updated_at"),
            }
        )
    return result


@router.post(
    "/api/tasks/backfill-track-fingerprints",
    response_model=TaskEnqueueResponse,
    responses=_TASK_RESPONSES,
    summary="Queue audio fingerprint backfill",
)
def api_backfill_track_fingerprints(request: Request):
    """Populate entity-stable audio fingerprints for tracks missing them."""
    _require_analysis_manager(request)
    pending = list_tasks(
        status="pending", task_type="backfill_track_audio_fingerprints", limit=1
    )
    running = list_tasks(
        status="running", task_type="backfill_track_audio_fingerprints", limit=1
    )
    if pending or running:
        return JSONResponse({"error": "Already running"}, status_code=409)
    task_id = create_task("backfill_track_audio_fingerprints")
    return {"task_id": task_id}


@router.post(
    "/api/tasks/backfill-similarities",
    response_model=TaskEnqueueResponse,
    responses=_TASK_RESPONSES,
    summary="Queue artist similarity backfill",
)
def api_backfill_similarities(request: Request):
    """Populate artist_similarities table from existing similar_json data."""
    require_permission(request, "library.metadata.write")
    pending = list_tasks(status="pending", task_type="backfill_similarities", limit=1)
    running = list_tasks(status="running", task_type="backfill_similarities", limit=1)
    if pending or running:
        return JSONResponse({"error": "Already running"}, status_code=409)
    task_id = create_task("backfill_similarities")
    return {"task_id": task_id}


@router.post(
    "/api/tasks/normalize-artist-bios",
    response_model=TaskEnqueueResponse,
    responses=_TASK_RESPONSES,
    summary="Queue artist biography normalization",
)
def api_normalize_artist_bios(request: Request):
    """Remove legacy attribution/markup from stored artist biographies."""
    require_permission(request, "library.metadata.write")
    pending = list_tasks(status="pending", task_type="normalize_artist_bios", limit=1)
    running = list_tasks(status="running", task_type="normalize_artist_bios", limit=1)
    if pending or running:
        return JSONResponse({"error": "Already running"}, status_code=409)
    return {"task_id": create_task("normalize_artist_bios")}


@router.post(
    "/api/tasks/sync-shows",
    response_model=TaskEnqueueResponse,
    responses=_TASK_RESPONSES,
    summary="Queue a live-shows sync",
)
def api_sync_shows(request: Request):
    """Trigger a sync_shows task to fetch shows from Ticketmaster into DB."""
    require_permission(request, "curation.shows.write")
    pending = list_tasks(status="pending", task_type="sync_shows", limit=1)
    running = list_tasks(status="running", task_type="sync_shows", limit=1)
    if pending or running:
        return JSONResponse({"error": "Already running"}, status_code=409)
    task_id = create_task("sync_shows")
    return {"task_id": task_id}


@router.post(
    "/api/tasks/sync-library",
    response_model=TaskEnqueueResponse,
    responses=_TASK_RESPONSES,
    summary="Queue a library filesystem sync",
)
def api_sync_library(request: Request):
    """Create a library_sync task to re-sync the filesystem to DB."""
    require_permission(request, "library.import.manage")
    running = list_tasks(status="running", task_type="library_sync", limit=1)
    pending = list_tasks(status="pending", task_type="library_sync", limit=1)
    if running or pending:
        return JSONResponse(
            {"error": "Library sync already in progress"}, status_code=409
        )
    task_id = create_task("library_sync")
    return {"task_id": task_id, "status": "started"}


@router.get(
    "/api/tasks/{task_id}",
    response_model=TaskResponse,
    responses=_TASK_RESPONSES,
    summary="Get a single background task",
)
def api_task_detail(request: Request, task_id: str):
    _require_auth(request)
    task = get_task(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    progress = task.get("progress", "")
    try:
        progress_parsed = (
            _json.loads(progress) if progress and progress.startswith("{") else progress
        )
    except (_json.JSONDecodeError, TypeError):
        progress_parsed = progress

    return {
        "id": task["id"],
        "type": task["type"],
        "status": task["status"],
        "progress": progress_parsed,
        "error": task.get("error"),
        "result": task.get("result"),
        "created_at": task["created_at"],
        "updated_at": task["updated_at"],
    }


@router.get(
    "/api/worker/status",
    response_model=WorkerStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get worker status and queue counts",
)
def api_worker_status(request: Request):
    """Get worker status: running/pending tasks, engine info."""
    _require_auth(request)
    try:
        from crate.db.ops_snapshot import get_cached_ops_snapshot

        snapshot = get_cached_ops_snapshot()
        live = snapshot.get("live") or {}
        return {
            "engine": live.get("engine", "dramatiq"),
            "running": len(live.get("running_tasks") or []),
            "pending": len(live.get("pending_tasks") or []),
            "running_tasks": [
                {"id": task["id"], "type": task["type"], "pool": task.get("pool")}
                for task in (live.get("running_tasks") or [])
            ],
            "pending_tasks": [
                {"id": task["id"], "type": task["type"], "pool": task.get("pool")}
                for task in (live.get("pending_tasks") or [])
            ],
        }
    except Exception:
        pass

    running = list_tasks(status="running")
    pending = list_tasks(status="pending")
    cached_status = get_cache("worker_status") or {}

    return {
        "engine": cached_status.get("engine", "dramatiq"),
        "running": len(running),
        "pending": len(pending),
        "running_tasks": [
            {"id": t["id"], "type": t["type"], "pool": t.get("pool", "default")}
            for t in running
        ],
        "pending_tasks": [
            {"id": t["id"], "type": t["type"], "pool": t.get("pool", "default")}
            for t in pending
        ],
    }


@router.post(
    "/api/worker/slots",
    response_model=WorkerSlotsResponse,
    responses=_TASK_RESPONSES,
    summary="Update worker slot limits",
)
def api_set_worker_slots(request: Request, body: WorkerSlotsRequest):
    """Limit concurrent task admission without resizing worker processes."""
    _require_task_operator(request)
    if body.min_slots not in {None, 1}:
        raise HTTPException(
            422,
            "Dramatiq has no minimum process autoscaling control; use slot admission limits",
        )
    try:
        state = (
            update_admission_slots(body.slots, expected_revision=body.expected_revision)
            if body.slots is not None
            else read_runtime_policy_state()
        )
        if (
            body.slots is None
            and body.expected_revision is not None
            and body.expected_revision != state["configured_revision"]
        ):
            raise PolicyRevisionConflict("Runtime revision changed")
    except PolicyRevisionConflict as error:
        raise HTTPException(409, str(error)) from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    return {
        "max_slots": state["policy"]["max_running"],
        "min_slots": 1,
        "configured_revision": state["configured_revision"],
        "effective_revision": state["effective_revision"],
        "slot_semantics": "admission_limits",
        "process_resize": False,
    }


@router.post(
    "/api/worker/restart",
    response_model=WorkerRestartResponse,
    responses=_TASK_RESPONSES,
    summary="Restart the worker container",
)
def api_restart_worker(request: Request):
    """Restart the worker container."""
    _require_task_operator(request)
    ok = restart_container("crate-worker")
    if ok:
        return {"status": "restarting"}
    return JSONResponse({"error": "Restart failed"}, status_code=500)


@router.post(
    "/api/worker/cancel-all",
    response_model=CancelAllTasksResponse,
    responses=_TASK_RESPONSES,
    summary="Cancel all pending and running tasks",
)
def api_cancel_all_tasks(request: Request):
    """Cancel all running and pending tasks."""
    from crate.agent_diagnostics import DiagnosticError
    from crate.db.repositories.task_control import request_cancellation

    _require_task_operator(request)
    running = list_tasks(status="running")
    pending = list_tasks(status="pending")
    cancelled = 0
    outcomes = []
    for t in running + pending:
        try:
            outcome = request_cancellation(t["id"])
        except DiagnosticError as error:
            outcomes.append(
                {
                    "task_id": t["id"],
                    "request_state": "rejected",
                    "error_code": error.code,
                }
            )
            continue
        outcomes.append(outcome)
        if outcome["request_state"] in {"cancelled", "cancellation_requested"}:
            cancel_media_worker_job(t["id"])
            cancelled += 1
    return {
        "cancelled": cancelled,
        "skipped": len(outcomes) - cancelled,
        "items": outcomes,
    }


@router.get(
    "/api/worker/schedules",
    response_model=WorkerSchedulesResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get configured worker schedules",
)
def api_get_schedules(request: Request):
    """Get configured task schedules."""
    _require_auth(request)
    state = read_schedules_state()
    result = {}
    for task_type, interval in state["schedules"].items():
        result[task_type] = {
            "label": task_label(task_type),
            "interval_seconds": interval,
            "interval_human": _format_interval(interval),
            "last_run": state["last_enqueued_at"].get(task_type),
            "last_enqueued_at": state["last_enqueued_at"].get(task_type),
            "last_succeeded_at": state["last_succeeded_at"].get(task_type),
            "revision": state["revision"],
            "enabled": interval > 0,
        }
    return result


@router.post(
    "/api/worker/schedules",
    response_model=WorkerSchedulesUpdateResponse,
    responses=_TASK_RESPONSES,
    summary="Update worker schedules",
)
def api_set_schedules(request: Request, body: WorkerSchedulesUpdateRequest):
    """Update task schedules. Body: {task_type: interval_seconds, ...}. Set to 0 to disable."""
    _require_task_operator(request)
    state = read_schedules_state()
    try:
        updated = update_schedules(
            body.schedules,
            expected_revision=body.expected_revision or state["revision"],
        )
    except PolicyRevisionConflict as error:
        raise HTTPException(409, str(error)) from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    return {"schedules": updated["schedules"], "revision": updated["revision"]}


@router.post(
    "/api/worker/schedules/{task_type}/run",
    response_model=ScheduleRunResponse,
    responses=merge_responses(
        _TASK_RESPONSES, {404: error_response("Schedule not found")}
    ),
    summary="Run a scheduled task now",
)
def api_run_schedule_now(request: Request, task_type: str):
    actor = _require_task_operator(request)
    if task_type not in DEFAULT_SCHEDULES:
        raise HTTPException(status_code=404, detail="Schedule not found")
    try:
        result = guarded_run_schedule(
            task_type, origin="admin", actor_user_id=actor.get("id")
        )
    except PolicyRevisionConflict as error:
        raise HTTPException(409, str(error)) from None
    return {"task_type": task_type, **result}


@router.get(
    "/api/admin/task-catalog",
    response_model=TaskCatalogResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get task type labels and manual task actions",
)
def api_task_catalog(request: Request):
    _require_auth(request)
    return {
        "categories": TASK_CATEGORIES,
        "types": [
            {"type": name, "label": info.label, "category": info.category}
            for name, info in TASK_TYPES.items()
        ],
        "actions": [
            {
                "id": action.id,
                "label": action.label,
                "task_type": action.task_type,
                "task_label": task_label(action.task_type),
                "category": task_category(action.task_type),
                "path": action.path,
                "capability": action.capability,
                "icon": action.icon,
                "body": action.body,
            }
            for action in TASK_ACTIONS
        ],
    }


def _format_interval(seconds: int) -> str:
    if seconds <= 0:
        return "disabled"
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds // 3600}h"
    return f"{seconds // 86400}d"


@router.post(
    "/api/tasks/clean/{status}",
    response_model=TaskCleanByStatusResponse,
    responses=_TASK_RESPONSES,
    summary="Delete tasks by status",
)
def api_clean_tasks_by_status(request: Request, status: str):
    """Delete all tasks with the given status. Allowed: completed, cancelled, failed."""
    _require_task_operator(request)
    from fastapi import HTTPException

    allowed = {"completed", "cancelled", "failed"}
    if status not in allowed:
        raise HTTPException(
            status_code=400, detail=f"Status must be one of: {', '.join(allowed)}"
        )
    deleted = delete_tasks_by_status(status)
    return {"deleted": deleted, "status": status}


@router.post(
    "/api/tasks/cleanup",
    response_model=TaskCleanupResponse,
    responses=_TASK_RESPONSES,
    summary="Delete old finished tasks",
)
def api_cleanup_tasks(request: Request, body: TaskCleanupRequest | None = None):
    """Delete completed/failed/cancelled tasks older than N days."""
    _require_task_operator(request)
    from datetime import datetime, timezone, timedelta

    days = body.older_than_days if body else 7
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    deleted = delete_old_finished_tasks(cutoff)
    return {"deleted": deleted}


@router.post(
    "/api/tasks/retry",
    response_model=TaskRetryResponse,
    responses=_TASK_RESPONSES,
    summary="Retry a task by cloning its params",
)
def api_retry_task(request: Request, body: TaskRetryRequest):
    """Retry a failed task by creating a new one with the same type and params (dispatches to Dramatiq)."""
    _require_task_operator(request)
    task_id = body.task_id
    if not task_id:
        return JSONResponse({"error": "task_id required"}, status_code=400)
    task = get_task(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    if task["type"] in {"ai_catalog_refresh", "ai_profile_test"}:
        raise HTTPException(
            409,
            "AI operations require a new dedicated human request",
            headers={"X-Crate-Error": "AI_DEDICATED_REQUEST_REQUIRED"},
        )

    params = task.get("params") or {}
    if isinstance(params, str):
        try:
            params = _json.loads(params)
        except (_json.JSONDecodeError, TypeError):
            params = {}

    new_id = create_task(
        task["type"],
        params,
        origin="admin",
        actor_user_id=getattr(request.state, "user", {}).get("id"),
        retry_of=task_id,
    )
    return {"task_id": new_id, "original_id": task_id}


@router.post(
    "/api/tasks/{task_id}/cancel",
    response_model=TaskCancelResponse,
    responses=_TASK_RESPONSES,
    summary="Cancel a pending or running task",
)
def api_cancel_task(request: Request, task_id: str):
    actor = _require_task_operator(request)
    task = get_task(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    if task["status"] not in ("pending", "running", "delegated"):
        return JSONResponse(
            {"error": f"Cannot cancel task in '{task['status']}' status"},
            status_code=400,
        )

    from crate.agent_diagnostics import DiagnosticError
    from crate.db.repositories.task_control import request_cancellation

    try:
        result = request_cancellation(
            task_id, actor_user_id=actor.get("id") if actor else None
        )
    except DiagnosticError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    cancel_media_worker_job(task_id)
    return {
        "status": result["status"],
        "id": task_id,
        "cancellation_requested": result["cancellation_requested"],
        "request_state": result["request_state"],
    }
