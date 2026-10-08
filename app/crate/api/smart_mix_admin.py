from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request

from crate.api.permissions import require_permission
from crate.api.schemas.smart_mix_admin import (
    SmartMixAdminStatusResponse,
    SmartMixBackfillRequest,
    SmartMixBackfillResponse,
)
from crate.db.jobs.smart_mix_backfill import (
    queue_next_smart_mix_batch,
    set_smart_mix_campaign_status,
    start_smart_mix_campaign,
)
from crate.db.queries.smart_mix_admin import (
    get_smart_mix_admin_status,
    get_smart_mix_campaign_status,
)
from crate.db.queries.tasks import list_tasks
from crate.db.repositories.tasks import create_task_dedup


router = APIRouter(prefix="/api/admin/smart-mix", tags=["admin"])
BACKFILL_TASK_TYPE = "backfill_smart_mix_profiles"
COVERAGE_TASK_TYPE = "refresh_smart_mix_coverage"
COVERAGE_DEDUP_KEY = "smart-mix:coverage"
COVERAGE_MAX_AGE_SECONDS = 600
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


def _control_state(campaign: dict | None) -> Literal["idle", "running", "paused"]:
    status = (campaign or {}).get("status")
    if status == "running":
        return "running"
    if status == "paused":
        return "paused"
    return "idle"


def _coverage_is_stale(refreshed_at: datetime | str | None) -> bool:
    if refreshed_at is None:
        return True
    if isinstance(refreshed_at, str):
        refreshed_at = datetime.fromisoformat(refreshed_at)
    if refreshed_at.tzinfo is None:
        refreshed_at = refreshed_at.replace(tzinfo=UTC)
    age = (datetime.now(UTC) - refreshed_at).total_seconds()
    return age > COVERAGE_MAX_AGE_SECONDS


@router.get("/status", response_model=SmartMixAdminStatusResponse)
def smart_mix_status(request: Request) -> SmartMixAdminStatusResponse:
    _require_manage(request)
    campaign = get_smart_mix_campaign_status()
    coverage = get_smart_mix_admin_status()
    if _coverage_is_stale(coverage.get("refreshed_at")):
        create_task_dedup(COVERAGE_TASK_TYPE, {}, dedup_key=COVERAGE_DEDUP_KEY)
    return SmartMixAdminStatusResponse.model_validate(
        {
            **coverage,
            "controlState": _control_state(campaign),
            "campaign": campaign,
            "activeTask": _active_backfill_task(),
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
    return _stop_backfill("paused", allowed_from={"running"})


@router.post("/backfill/cancel", response_model=SmartMixBackfillResponse)
def cancel_smart_mix_backfill(request: Request) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _stop_backfill("cancelled", allowed_from={"running", "paused"})


def _queue_backfill(
    body: SmartMixBackfillRequest,
    *,
    response_status: Literal["queued", "resumed"],
) -> SmartMixBackfillResponse:
    active = _active_backfill_task()
    campaign = start_smart_mix_campaign(
        batch_size=body.batch_size,
        max_attempts=body.max_attempts,
    )
    if active is not None:
        return SmartMixBackfillResponse.model_validate(
            {
                "taskId": str(active["id"]) if active.get("id") else None,
                "status": "already_running",
                "deduplicated": True,
            }
        )
    task_id = queue_next_smart_mix_batch(campaign)
    return SmartMixBackfillResponse.model_validate(
        {
            "taskId": task_id,
            "status": response_status,
            "deduplicated": task_id is None,
        }
    )


def _stop_backfill(
    control: Literal["paused", "cancelled"],
    *,
    allowed_from: set[str],
) -> SmartMixBackfillResponse:
    if set_smart_mix_campaign_status(control, allowed_from=allowed_from) is None:
        raise HTTPException(status_code=409, detail="No active Smart Mix backfill")
    active = _active_backfill_task()
    return SmartMixBackfillResponse.model_validate(
        {
            "taskId": str(active["id"]) if active and active.get("id") else None,
            "status": control,
        }
    )


__all__ = ["router"]
