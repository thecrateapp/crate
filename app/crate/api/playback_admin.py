from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.permissions import require_permission
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.media import (
    AdminPlaybackDeliveryResponse,
    PlaybackWarmupRequest,
)
from crate.config import load_config
from crate.db.queries.streaming_admin import get_playback_delivery_snapshot
from crate.db.repositories.tasks import (
    create_task_dedup,
    find_active_task_by_type_params,
)
from crate.worker_handlers.playback import (
    _playback_warmup_enabled,
    get_stream_transcode_runtime,
)

router = APIRouter(tags=["admin"])


def _require_ops_health(request: Request) -> dict:
    return require_permission(request, "ops.health.view")


@router.get(
    "/api/admin/playback-delivery",
    response_model=AdminPlaybackDeliveryResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get playback delivery and transcode cache status",
)
def api_admin_playback_delivery(request: Request, limit: int = 20):
    _require_ops_health(request)
    payload = get_playback_delivery_snapshot(limit=limit)
    payload["runtime"] = get_stream_transcode_runtime(load_config())
    return payload


@router.post(
    "/api/admin/playback-delivery/warmup",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue a bounded warmup of recent local playback variants",
)
def api_admin_playback_warmup(request: Request, body: PlaybackWarmupRequest):
    _require_ops_health(request)
    if not _playback_warmup_enabled():
        raise HTTPException(
            status_code=409,
            detail="Playback warmup is disabled; set CRATE_PLAYBACK_WARMUP_ENABLED=true",
        )

    params = body.model_dump(mode="json")
    task_id = create_task_dedup(
        "warmup_stream_variants",
        params,
        dedup_key="admin-playback-warmup",
        priority=3,
        pool="maintenance",
    )
    if task_id:
        return {"task_id": task_id, "status": "queued", "deduplicated": False}

    existing_task_id = find_active_task_by_type_params(
        "warmup_stream_variants",
        params,
        dedup_key="admin-playback-warmup",
    )
    if existing_task_id:
        return {
            "task_id": existing_task_id,
            "status": "queued",
            "deduplicated": True,
        }
    raise HTTPException(status_code=503, detail="Could not queue playback warmup")
