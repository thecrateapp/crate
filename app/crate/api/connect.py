from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.responses import StreamingResponse

from crate.api.auth import _require_auth
from crate.api.cache_events import broadcast_invalidation
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.connect import (
    ActivePlaybackSessionEnvelope,
    ConnectCommandAckRequest,
    ConnectCommandAckResponse,
    ConnectCommandEnvelope,
    ConnectCommandListEnvelope,
    ConnectCommandRequest,
    ConnectPreferencesResponse,
    ConnectPreferencesUpdateRequest,
    ConnectTransferRequest,
    ConnectTransferResponse,
)
from crate.db.repositories.auth import get_user_by_id, update_user
from crate.db.repositories.connect import (
    ConnectActiveSessionMissing,
    ConnectDeviceNotFound,
    ConnectDeviceUnavailable,
    ConnectPlaybackStateMissing,
    ConnectStaleCommand,
    acknowledge_connect_command,
    get_active_session,
    get_device_playback_state,
    read_connect_commands,
    send_connect_command,
    transfer_playback,
)
from crate.db.repositories.connect_ws_hub import connect_hub

router = APIRouter(prefix="/api/me/connect", tags=["me"])

_CONNECT_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested resource could not be found."),
        409: error_response("The Connect command conflicts with current state."),
        422: error_response("The request payload failed validation."),
    },
)


def _require_persisted_user_id(request: Request) -> int:
    user = _require_auth(request)
    user_id = user.get("id")
    if not isinstance(user_id, int):
        raise HTTPException(status_code=401, detail="A persisted user is required")
    return user_id


def _raise_connect_error(exc: Exception) -> None:
    if isinstance(exc, (ConnectDeviceNotFound, ConnectPlaybackStateMissing)):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(
        exc,
        (
            ConnectDeviceUnavailable,
            ConnectActiveSessionMissing,
            ConnectStaleCommand,
        ),
    ):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def _json_default(value: Any) -> str:
    return str(value)


def _sse(command: dict[str, Any]) -> str:
    stream_id = command.get("stream_id") or command.get("command_id")
    data = json.dumps(command, default=_json_default)
    return f"id: {stream_id}\nevent: connect.command\ndata: {data}\n\n"


@router.get(
    "/session",
    response_model=ActivePlaybackSessionEnvelope,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the current Crate Connect active playback session",
)
def get_connect_session(request: Request):
    user_id = _require_persisted_user_id(request)
    session = get_active_session(user_id)
    state = None
    active_device_id = session.get("active_device_id") if session else None
    if isinstance(active_device_id, str) and active_device_id:
        state = get_device_playback_state(user_id, device_id=active_device_id)
    return {"session": session, "state": state}


@router.get(
    "/preferences",
    response_model=ConnectPreferencesResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get current user's Crate Connect preferences",
)
def get_connect_preferences(request: Request):
    user_id = _require_persisted_user_id(request)
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {"enabled": bool(user.get("crate_connect_enabled"))}


@router.put(
    "/preferences",
    response_model=ConnectPreferencesResponse,
    responses=_CONNECT_RESPONSES,
    summary="Update current user's Crate Connect preferences",
)
async def put_connect_preferences(
    request: Request, body: ConnectPreferencesUpdateRequest
):
    user_id = _require_persisted_user_id(request)
    user = update_user(user_id, crate_connect_enabled=body.enabled)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    enabled = bool(user.get("crate_connect_enabled"))
    await connect_hub.broadcast_to_user(
        user_id,
        {
            "type": "connect_preferences",
            "payload": {"enabled": enabled},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
    broadcast_invalidation("connect:preferences")
    return {"enabled": enabled}


@router.post(
    "/transfer",
    response_model=ConnectTransferResponse,
    responses=_CONNECT_RESPONSES,
    summary="Transfer playback to another Crate Connect device",
)
def post_connect_transfer(request: Request, body: ConnectTransferRequest):
    user_id = _require_persisted_user_id(request)
    try:
        return transfer_playback(
            user_id,
            target_device_id=body.target_device_id,
            source_device_id=body.source_device_id,
            start_playing=body.start_playing,
        )
    except Exception as exc:
        _raise_connect_error(exc)


@router.post(
    "/commands",
    response_model=ConnectCommandEnvelope,
    responses=_CONNECT_RESPONSES,
    summary="Send a remote command to the active Crate Connect device",
)
def post_connect_command(request: Request, body: ConnectCommandRequest):
    user_id = _require_persisted_user_id(request)
    try:
        command = send_connect_command(
            user_id,
            command_id=str(body.command_id) if body.command_id else None,
            command_type=body.type,
            payload=body.payload,
            target_device_id=body.target_device_id,
            source_device_id=body.source_device_id,
            playback_session_id=str(body.playback_session_id)
            if body.playback_session_id
            else None,
        )
    except Exception as exc:
        _raise_connect_error(exc)
    return {"command": command}


@router.get(
    "/commands",
    response_model=ConnectCommandListEnvelope,
    responses=_CONNECT_RESPONSES,
    summary="Poll pending Crate Connect commands for a device",
)
def get_connect_commands(
    request: Request,
    device_id: str = Query(..., min_length=3, max_length=160),
    last_event_id: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
):
    user_id = _require_persisted_user_id(request)
    commands = read_connect_commands(
        user_id,
        device_id=device_id,
        last_id=last_event_id or "0-0",
        limit=limit,
        block_ms=0,
    )
    return {"commands": commands}


@router.get(
    "/events",
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        {
            200: {
                "content": {
                    "text/event-stream": {
                        "schema": {"type": "string", "format": "event-stream"}
                    }
                },
                "description": "Server-sent Crate Connect command stream.",
            },
            400: error_response("device_id is required."),
        },
    ),
    summary="Stream Crate Connect commands for a device",
)
def get_connect_events(
    request: Request,
    device_id: str = Query(..., min_length=3, max_length=160),
    last_event_id: str | None = Query(default=None),
):
    user_id = _require_persisted_user_id(request)
    header_last_id = request.headers.get("last-event-id")
    initial_last_id = last_event_id or header_last_id or "0-0"

    async def event_stream():
        last_id = initial_last_id
        while True:
            if await request.is_disconnected():
                break
            commands = await asyncio.to_thread(
                read_connect_commands,
                user_id,
                device_id=device_id,
                last_id=last_id,
                limit=25,
                block_ms=15000,
            )
            if not commands:
                yield ": keepalive\n\n"
                await asyncio.sleep(2)
                continue
            for command in commands:
                last_id = str(command.get("stream_id") or last_id)
                yield _sse(command)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post(
    "/commands/{command_id}/ack",
    response_model=ConnectCommandAckResponse,
    responses=_CONNECT_RESPONSES,
    summary="Acknowledge a Crate Connect command",
)
def post_connect_command_ack(
    request: Request, command_id: str, body: ConnectCommandAckRequest
):
    user_id = _require_persisted_user_id(request)
    try:
        ack = acknowledge_connect_command(
            user_id,
            device_id=body.device_id,
            command_id=command_id,
            status=body.status,
            error=body.error,
        )
    except Exception as exc:
        _raise_connect_error(exc)
    return {"ok": True, "ack": ack}
