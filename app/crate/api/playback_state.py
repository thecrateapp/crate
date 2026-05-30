"""Crate Connect device registry and playback checkpoints."""

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.common import OkResponse
from crate.api.schemas.playback_state import (
    CurrentDeviceRequest,
    CurrentDeviceResponse,
    DeviceListResponse,
    PlaybackStateRequest,
    PlaybackStateUpdateResponse,
    ResumeCandidateResponse,
)
from crate.db.repositories.playback_state import (
    clear_playback_state,
    get_resume_candidate,
    list_devices,
    mark_device_present,
    revoke_device,
    upsert_device,
    upsert_playback_state,
)
from crate.db.repositories.connect import sync_active_playback_claim

router = APIRouter(prefix="/api/me", tags=["me"])

_PLAYBACK_STATE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


def _require_persisted_user_id(request: Request) -> int:
    user = _require_auth(request)
    user_id = user.get("id")
    if not isinstance(user_id, int):
        raise HTTPException(status_code=401, detail="A persisted user is required")
    return user_id


def _current_session_id(request: Request) -> str | None:
    user = getattr(request.state, "user", None) or {}
    session_id = user.get("session_id")
    return session_id if isinstance(session_id, str) and session_id else None


def _header_device_id(request: Request) -> str | None:
    value = (request.headers.get("X-Device-Fingerprint") or "").strip()
    return value or None


def _header_device_label(request: Request) -> str | None:
    value = (request.headers.get("X-Device-Label") or "").strip()
    return value or None


def _queue_payload(items: list[Any] | None) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for item in items or []:
        if hasattr(item, "model_dump"):
            value = item.model_dump(mode="json", exclude_none=True)
        elif isinstance(item, dict):
            value = {key: val for key, val in item.items() if val is not None}
        else:
            continue
        payload.append(value)
    return payload


@router.put(
    "/devices/current",
    response_model=CurrentDeviceResponse,
    responses=_PLAYBACK_STATE_RESPONSES,
    summary="Register or update the current Crate Connect device",
)
def put_current_device(request: Request, body: CurrentDeviceRequest):
    user_id = _require_persisted_user_id(request)
    device = upsert_device(
        user_id,
        device_id=body.device_id,
        device_label=body.device_label,
        device_type=body.device_type,
        app_platform=body.app_platform,
        app_version=body.app_version,
        capabilities=body.capabilities.model_dump(mode="json"),
        session_id=_current_session_id(request),
    )
    return {"ok": True, "device": device}


@router.post(
    "/devices/current/presence",
    response_model=CurrentDeviceResponse,
    responses=_PLAYBACK_STATE_RESPONSES,
    summary="Refresh current Crate Connect device presence",
)
def post_current_device_presence(request: Request, body: CurrentDeviceRequest):
    user_id = _require_persisted_user_id(request)
    device = mark_device_present(
        user_id,
        device_id=body.device_id,
        device_label=body.device_label,
        device_type=body.device_type,
        app_platform=body.app_platform,
        app_version=body.app_version,
        capabilities=body.capabilities.model_dump(mode="json"),
        session_id=_current_session_id(request),
    )
    return {"ok": True, "device": device}


@router.get(
    "/devices",
    response_model=DeviceListResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List Crate Connect devices for the current user",
)
def get_devices(request: Request):
    user_id = _require_persisted_user_id(request)
    return {"devices": list_devices(user_id)}


@router.delete(
    "/devices/{device_id}",
    response_model=OkResponse,
    responses=_PLAYBACK_STATE_RESPONSES,
    summary="Forget a Crate Connect device",
)
def delete_device(request: Request, device_id: str):
    user_id = _require_persisted_user_id(request)
    removed = revoke_device(user_id, device_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"ok": True}


@router.put(
    "/playback-state/current",
    response_model=PlaybackStateUpdateResponse,
    responses=_PLAYBACK_STATE_RESPONSES,
    summary="Publish a Crate Connect playback checkpoint for the current device",
)
def put_current_playback_state(request: Request, body: PlaybackStateRequest):
    user_id = _require_persisted_user_id(request)
    upsert_device(
        user_id,
        device_id=body.device_id,
        device_label=_header_device_label(request) or body.device_id,
        device_type=body.device_type,
        app_platform=body.app_platform,
        session_id=_current_session_id(request),
        touch_presence=False,
    )
    state = upsert_playback_state(
        user_id,
        device_id=body.device_id,
        snapshot_kind=body.snapshot_kind,
        status=body.status,
        playback_session_id=str(body.playback_session_id)
        if body.playback_session_id
        else None,
        track_id=body.track_id,
        track_entity_uid=str(body.track_entity_uid) if body.track_entity_uid else None,
        track_path=body.track_path,
        title=body.title,
        artist=body.artist,
        album=body.album,
        album_cover=body.album_cover,
        position_ms=body.position_ms,
        duration_ms=body.duration_ms,
        current_index=body.current_index,
        queue_revision=body.queue_revision,
        queue=_queue_payload(body.queue),
        play_source=body.play_source,
        repeat_mode=body.repeat_mode,
        shuffle=body.shuffle,
        unshuffled_queue=_queue_payload(body.unshuffled_queue)
        if body.unshuffled_queue is not None
        else None,
        playback_rate=body.playback_rate,
        app_platform=body.app_platform,
        device_type=body.device_type,
        expires_at=body.expires_at,
    )
    if body.claim_active or body.status in {"paused", "stopped"}:
        sync_active_playback_claim(
            user_id,
            device_id=body.device_id,
            status=body.status,
            state_revision=body.queue_revision,
        )
    return {"ok": True, "state": state}


@router.get(
    "/playback-state/resume",
    response_model=ResumeCandidateResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the best Crate Connect resume candidate",
)
def get_playback_resume_candidate(
    request: Request,
    device_id: str | None = Query(default=None),
    include_current_device: bool = Query(default=False),
):
    user_id = _require_persisted_user_id(request)
    candidate = get_resume_candidate(
        user_id,
        device_id=device_id or _header_device_id(request),
        include_current_device=include_current_device,
    )
    return {"candidate": candidate}


@router.delete(
    "/playback-state/current",
    response_model=OkResponse,
    responses=_PLAYBACK_STATE_RESPONSES,
    summary="Clear the current device Crate Connect playback checkpoint",
)
def delete_current_playback_state(
    request: Request,
    device_id: str | None = Query(default=None),
    clear_queue: bool = Query(default=True),
):
    user_id = _require_persisted_user_id(request)
    resolved_device_id = device_id or _header_device_id(request)
    if not resolved_device_id:
        raise HTTPException(status_code=400, detail="device_id is required")
    clear_playback_state(user_id, device_id=resolved_device_id, clear_queue=clear_queue)
    return {"ok": True}
