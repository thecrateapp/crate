from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request

from crate.api.permissions import require_permission
from crate.api.schemas.smart_mix_admin import (
    SmartMixAdminStatusResponse,
    SmartMixBackfillRequest,
    SmartMixBackfillResponse,
)
from crate.db.queries.smart_mix_admin import get_smart_mix_admin_status
from crate.db.queries.tasks import list_tasks
from crate.db.repositories.tasks import create_task_dedup, update_task


router = APIRouter(prefix="/api/admin/smart-mix", tags=["admin"])
BACKFILL_TASK_TYPE = "backfill_smart_mix_profiles"
BACKFILL_DEDUP_KEY = "smart-mix:backfill:v1"
_ACTIVE_TASK_STATUSES = {"pending", "running", "delegated", "completing"}


def _require_manage(request: Request) -> dict:
    return require_permission(request, "library.analysis.manage")


def _backfill_tasks() -> list[dict]:
    return list_tasks(task_type=BACKFILL_TASK_TYPE, limit=10)


def _active_backfill_task(tasks: list[dict] | None = None) -> dict | None:
    return next(
        (
            task
            for task in (tasks if tasks is not None else _backfill_tasks())
            if str(task.get("status") or "") in _ACTIVE_TASK_STATUSES
        ),
        None,
    )


def _control_state(
    tasks: list[dict],
    active: dict | None,
) -> Literal["idle", "running", "paused"]:
    if active is not None:
        return "running"
    if tasks:
        result = tasks[0].get("result")
        if isinstance(result, dict) and result.get("control") == "paused":
            return "paused"
    return "idle"


@router.get("/status", response_model=SmartMixAdminStatusResponse)
def smart_mix_status(request: Request) -> SmartMixAdminStatusResponse:
    _require_manage(request)
    tasks = _backfill_tasks()
    active = _active_backfill_task(tasks)
    coverage = get_smart_mix_admin_status()
    return SmartMixAdminStatusResponse.model_validate(
        {
            **coverage,
            "controlState": _control_state(tasks, active),
            "activeTask": active,
        }
    )


@router.post("/backfill", response_model=SmartMixBackfillResponse)
def start_smart_mix_backfill(
    body: SmartMixBackfillRequest,
    request: Request,
) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _queue_backfill(body, response_status="queued")


@router.post("/backfill/resume", response_model=SmartMixBackfillResponse)
def resume_smart_mix_backfill(
    body: SmartMixBackfillRequest,
    request: Request,
) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _queue_backfill(body, response_status="resumed")


@router.post("/backfill/pause", response_model=SmartMixBackfillResponse)
def pause_smart_mix_backfill(request: Request) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _stop_backfill("paused")


@router.post("/backfill/cancel", response_model=SmartMixBackfillResponse)
def cancel_smart_mix_backfill(request: Request) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _stop_backfill("cancelled")


def _queue_backfill(
    body: SmartMixBackfillRequest,
    *,
    response_status: Literal["queued", "resumed"],
) -> SmartMixBackfillResponse:
    task_id = create_task_dedup(
        BACKFILL_TASK_TYPE,
        {
            "batch_size": body.batch_size,
            "max_attempts": body.max_attempts,
            "triggered_by": "admin",
        },
        dedup_key=BACKFILL_DEDUP_KEY,
    )
    if task_id is not None:
        return SmartMixBackfillResponse.model_validate(
            {
                "taskId": task_id,
                "status": response_status,
                "deduplicated": False,
            }
        )

    active = _active_backfill_task()
    return SmartMixBackfillResponse.model_validate(
        {
            "taskId": str(active["id"]) if active and active.get("id") else None,
            "status": "already_running",
            "deduplicated": True,
        }
    )


def _stop_backfill(
    control: Literal["paused", "cancelled"],
) -> SmartMixBackfillResponse:
    active = _active_backfill_task()
    if active is None or not active.get("id"):
        raise HTTPException(status_code=409, detail="No active Smart Mix backfill")
    task_id = str(active["id"])
    update_task(
        task_id,
        status="cancelled",
        result={"control": control, "checkpointed": True},
    )
    return SmartMixBackfillResponse.model_validate(
        {"taskId": task_id, "status": control}
    )


__all__ = ["router"]
