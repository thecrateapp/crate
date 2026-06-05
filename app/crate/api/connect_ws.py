"""Crate Connect v2 WebSocket transport."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import ValidationError

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.connect_ws import (
    ConnectClientMessage,
    ConnectHelloMessage,
    ConnectWsTicketRequest,
    ConnectWsTicketResponse,
)
from crate.db.repositories.connect_state import (
    ConnectNotActiveInstance,
    ConnectStaleState,
    ConnectTransferPending,
    assert_active_instance,
    assert_no_pending_transfer,
    flush_player_state_to_postgres,
    get_player_state,
    update_player_state,
)
from crate.db.repositories.connect_ws_hub import ConnectHub, connect_hub
from crate.db.repositories.connect_ws_tickets import (
    create_ws_ticket,
    validate_ws_ticket,
)
from crate.db.repositories.playback_state import mark_device_present, upsert_device

router = APIRouter(prefix="/api/me/connect", tags=["me"])

REMOTE_COMMAND_TYPES = {
    "seek",
    "next_track",
    "previous_track",
    "pause",
    "resume",
    "volume",
}
PENDING_ALLOWED_TYPES = {
    "transfer_ready",
    "transfer_cancel",
    "heartbeat",
    "update_volume",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_persisted_user_id(request: Request) -> int:
    user = _require_auth(request)
    user_id = user.get("id")
    if not isinstance(user_id, int):
        raise HTTPException(status_code=401, detail="A persisted user is required")
    return user_id


@router.post(
    "/ws-ticket",
    response_model=ConnectWsTicketResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Create a one-time Crate Connect WebSocket ticket",
)
async def post_connect_ws_ticket(request: Request, body: ConnectWsTicketRequest):
    user_id = _require_persisted_user_id(request)
    return await asyncio.to_thread(create_ws_ticket, user_id, device_id=body.device_id)


@router.websocket("/ws")
async def connect_websocket(websocket: WebSocket, ticket: str = Query(...)) -> None:
    ticket_data = await asyncio.to_thread(validate_ws_ticket, ticket)
    if not ticket_data:
        await websocket.close(code=4001, reason="Invalid or expired ticket")
        return

    user_id = int(ticket_data["user_id"])
    persistent_device_id = str(ticket_data["device_id"])
    instance_id: str | None = None

    await websocket.accept()
    await websocket.send_json(
        {
            "type": "hello",
            "payload": {"user_id": user_id, "server_time": _now().isoformat()},
        }
    )

    try:
        raw_hello = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        hello = ConnectHelloMessage.model_validate(raw_hello)
    except (asyncio.TimeoutError, ValidationError):
        await websocket.close(code=4002, reason="Expected hello message")
        return

    payload = hello.payload
    if payload.device_id != persistent_device_id:
        await websocket.close(code=4004, reason="Device ID mismatch")
        return

    instance_id = payload.playback_instance_id
    capabilities = payload.capabilities.model_dump(mode="json")
    await connect_hub.connect(
        user_id,
        instance_id,
        websocket,
        device_id=persistent_device_id,
        device_label=payload.device_label,
        device_type=payload.device_type,
        app_platform=payload.app_platform,
        app_version=payload.app_version,
        capabilities=capabilities,
    )
    await asyncio.to_thread(
        upsert_device,
        user_id,
        device_id=persistent_device_id,
        device_label=payload.device_label,
        device_type=payload.device_type,
        app_platform=payload.app_platform,
        app_version=payload.app_version,
        capabilities=capabilities,
        session_id=None,
    )
    await asyncio.to_thread(
        mark_device_present,
        user_id,
        device_id=persistent_device_id,
        device_label=payload.device_label,
        device_type=payload.device_type,
        app_platform=payload.app_platform,
        app_version=payload.app_version,
        capabilities=capabilities,
        session_id=None,
    )

    await _broadcast_connected_instances(user_id, connect_hub)
    state = await asyncio.to_thread(get_player_state, user_id)
    await websocket.send_json(
        {
            "type": "player_state",
            "payload": state,
            "version": int((state or {}).get("version") or 0),
            "timestamp": _now().isoformat(),
        }
    )

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                message = ConnectClientMessage.model_validate(raw)
            except ValidationError as exc:
                await _send_error(
                    connect_hub, user_id, instance_id, "invalid_message", str(exc)
                )
                continue
            await handle_message(
                user_id,
                instance_id,
                persistent_device_id,
                message,
                connect_hub,
            )
    except WebSocketDisconnect:
        pass
    finally:
        await connect_hub.disconnect(user_id, instance_id)
        await _broadcast_connected_instances(user_id, connect_hub)


async def handle_message(
    user_id: int,
    instance_id: str,
    device_id: str,
    message: ConnectClientMessage,
    hub: ConnectHub,
) -> None:
    try:
        if message.type == "heartbeat":
            await hub.send_to_instance(
                user_id, instance_id, {"type": "heartbeat_ack", "payload": {}}
            )
            return
        if message.type == "claim_active":
            await _handle_claim_active(user_id, instance_id, device_id, message, hub)
            return
        if message.type == "transfer_request":
            await _handle_transfer_request(user_id, instance_id, message, hub)
            return
        if message.type == "transfer_ready":
            await _handle_transfer_ready(user_id, instance_id, message, hub)
            return
        if message.type == "transfer_cancel":
            await _handle_transfer_cancel(user_id, instance_id, message, hub)
            return
        if message.type in REMOTE_COMMAND_TYPES:
            await _handle_remote_command(user_id, instance_id, message, hub)
            return
        if message.type.startswith("update_"):
            await _handle_state_update(user_id, instance_id, message, hub)
            return
        await _send_error(
            hub,
            user_id,
            instance_id,
            "unknown_type",
            f"Unknown message type: {message.type}",
        )
    except ConnectStaleState as exc:
        await _send_error(hub, user_id, instance_id, "stale_state", str(exc))
    except ConnectNotActiveInstance as exc:
        await _send_error(hub, user_id, instance_id, "not_active_instance", str(exc))
    except ConnectTransferPending as exc:
        await _send_error(hub, user_id, instance_id, "transfer_pending", str(exc))
    except ValueError as exc:
        await _send_error(hub, user_id, instance_id, "invalid_request", str(exc))


async def _handle_claim_active(
    user_id: int,
    instance_id: str,
    device_id: str,
    message: ConnectClientMessage,
    hub: ConnectHub,
) -> None:
    state = await asyncio.to_thread(get_player_state, user_id)
    state = state or {"session_id": str(uuid.uuid4())}
    await _cancel_pending_transfer_if_source_reclaims(user_id, instance_id, state, hub)
    previous_instance_id = state.get("active_instance_id")
    meta = hub.get_instance_meta(user_id, instance_id)
    position_ms = _int_payload(
        message.payload, "position_ms", default=state.get("position_ms") or 0
    )
    updates = {
        "active_instance_id": instance_id,
        "active_device_id": device_id,
        "active_device_label": meta.device_label if meta else None,
        "status": "playing",
        "position_ms": position_ms,
        "transfer_state": None,
        "transfer_id": None,
        "transfer_source_instance_id": None,
        "transfer_target_instance_id": None,
    }
    next_state = await asyncio.to_thread(
        update_player_state,
        user_id,
        updates,
        expected_version=message.version,
        base_state=state,
    )
    if previous_instance_id and previous_instance_id != instance_id:
        await hub.send_to_instance(
            user_id,
            str(previous_instance_id),
            {
                "type": "became_inactive",
                "payload": {
                    "active_instance_id": instance_id,
                    "active_device_label": updates["active_device_label"],
                },
            },
        )
    await _broadcast_state_update(user_id, next_state, hub)


async def _handle_state_update(
    user_id: int,
    instance_id: str,
    message: ConnectClientMessage,
    hub: ConnectHub,
) -> None:
    state = await _require_state(user_id)
    _validate_update_during_transfer(instance_id, message, state)
    if message.type != "update_volume":
        assert_active_instance(state, instance_id)

    updates = _updates_from_message(message)
    next_state = await asyncio.to_thread(
        update_player_state,
        user_id,
        updates,
        expected_version=message.version,
        base_state=state,
    )
    await _broadcast_state_update(user_id, next_state, hub)
    if next_state.get("status") in {"paused", "stopped"}:
        await asyncio.to_thread(flush_player_state_to_postgres, user_id)


async def _handle_remote_command(
    user_id: int,
    instance_id: str,
    message: ConnectClientMessage,
    hub: ConnectHub,
) -> None:
    state = await _require_state(user_id)
    assert_no_pending_transfer(state)
    active_instance_id = state.get("active_instance_id")
    if not active_instance_id:
        raise ValueError("No active playback instance")
    sent = await hub.send_to_instance(
        user_id,
        str(active_instance_id),
        {
            "type": message.type,
            "payload": message.payload,
            "version": state.get("version"),
        },
    )
    if not sent and not hub.enable_pubsub:
        await _send_error(
            hub,
            user_id,
            instance_id,
            "target_unavailable",
            "Active instance is not connected",
        )


async def _handle_transfer_request(
    user_id: int,
    instance_id: str,
    message: ConnectClientMessage,
    hub: ConnectHub,
) -> None:
    target_instance_id = str(message.payload.get("target_instance_id") or "")
    if not target_instance_id:
        raise ValueError("target_instance_id is required")
    if hub.get_instance_meta(user_id, target_instance_id) is None:
        raise ValueError("Target playback instance is not connected")
    state = await _require_state(user_id)
    assert_no_pending_transfer(state)
    source_instance_id = str(state.get("active_instance_id") or instance_id)
    transfer_id = str(uuid.uuid4())
    deadline = _now() + timedelta(seconds=10)
    updates = {
        "transfer_state": "pending",
        "transfer_id": transfer_id,
        "transfer_source_instance_id": source_instance_id,
        "transfer_target_instance_id": target_instance_id,
        "transfer_deadline": deadline.isoformat(),
    }
    next_state = await asyncio.to_thread(
        update_player_state,
        user_id,
        updates,
        expected_version=message.version,
        base_state=state,
    )
    await hub.send_to_instance(
        user_id,
        target_instance_id,
        {
            "type": "transfer_incoming",
            "payload": {
                "transfer_id": transfer_id,
                "source_instance_id": source_instance_id,
                "state": next_state,
            },
            "version": next_state.get("version"),
        },
    )
    asyncio.create_task(_transfer_timeout(user_id, transfer_id, hub))


async def _handle_transfer_ready(
    user_id: int,
    instance_id: str,
    message: ConnectClientMessage,
    hub: ConnectHub,
) -> None:
    state = await _require_state(user_id)
    transfer_id = str(message.payload.get("transfer_id") or "")
    if (
        state.get("transfer_state") != "pending"
        or state.get("transfer_id") != transfer_id
    ):
        raise ValueError("No matching pending transfer")
    if state.get("transfer_target_instance_id") != instance_id:
        raise ValueError("Only the transfer target can complete this transfer")
    meta = hub.get_instance_meta(user_id, instance_id)
    source_instance_id = state.get("transfer_source_instance_id")
    next_state = await asyncio.to_thread(
        update_player_state,
        user_id,
        {
            "active_instance_id": instance_id,
            "active_device_id": meta.device_id if meta else None,
            "active_device_label": meta.device_label if meta else None,
            "status": "playing",
            "transfer_state": None,
            "transfer_id": None,
            "transfer_source_instance_id": None,
            "transfer_target_instance_id": None,
            "transfer_deadline": None,
        },
        expected_version=message.version,
        base_state=state,
    )
    await hub.send_to_instance(
        user_id,
        instance_id,
        {
            "type": "transfer_committed",
            "payload": {
                "active_instance_id": instance_id,
                "active_device_label": next_state.get("active_device_label"),
            },
        },
    )
    if source_instance_id and source_instance_id != instance_id:
        await hub.send_to_instance(
            user_id,
            str(source_instance_id),
            {
                "type": "became_inactive",
                "payload": {
                    "active_instance_id": instance_id,
                    "active_device_label": next_state.get("active_device_label"),
                },
            },
        )
    await _broadcast_state_update(user_id, next_state, hub)
    await asyncio.to_thread(flush_player_state_to_postgres, user_id)


async def _handle_transfer_cancel(
    user_id: int,
    instance_id: str,
    message: ConnectClientMessage,
    hub: ConnectHub,
) -> None:
    state = await _require_state(user_id)
    transfer_id = str(message.payload.get("transfer_id") or "")
    if (
        state.get("transfer_state") != "pending"
        or state.get("transfer_id") != transfer_id
    ):
        raise ValueError("No matching pending transfer")
    if state.get("transfer_target_instance_id") != instance_id:
        raise ValueError("Only the transfer target can cancel this transfer")
    reason = str(message.payload.get("reason") or "cancelled")
    next_state = await _clear_transfer(user_id, state, expected_version=message.version)
    await _send_transfer_failed(user_id, state, reason, hub)
    await _broadcast_state_update(user_id, next_state, hub)


async def _cancel_pending_transfer_if_source_reclaims(
    user_id: int, instance_id: str, state: dict[str, Any], hub: ConnectHub
) -> None:
    if (
        state.get("transfer_state") == "pending"
        and state.get("transfer_source_instance_id") == instance_id
    ):
        await _send_transfer_failed(user_id, state, "source-claimed", hub)


async def _transfer_timeout(user_id: int, transfer_id: str, hub: ConnectHub) -> None:
    await asyncio.sleep(10)
    state = await asyncio.to_thread(get_player_state, user_id)
    if not state or state.get("transfer_id") != transfer_id:
        return
    next_state = await _clear_transfer(user_id, state)
    await _send_transfer_failed(user_id, state, "timeout", hub)
    await _broadcast_state_update(user_id, next_state, hub)


async def _clear_transfer(
    user_id: int, state: dict[str, Any], *, expected_version: int | None = None
) -> dict[str, Any]:
    return await asyncio.to_thread(
        update_player_state,
        user_id,
        {
            "transfer_state": None,
            "transfer_id": None,
            "transfer_source_instance_id": None,
            "transfer_target_instance_id": None,
            "transfer_deadline": None,
        },
        expected_version=expected_version,
        base_state=state,
    )


async def _send_transfer_failed(
    user_id: int, state: dict[str, Any], reason: str, hub: ConnectHub
) -> None:
    payload = {"transfer_id": state.get("transfer_id"), "reason": reason}
    for instance_id in {
        state.get("transfer_source_instance_id"),
        state.get("transfer_target_instance_id"),
    }:
        if instance_id:
            await hub.send_to_instance(
                user_id,
                str(instance_id),
                {"type": "transfer_failed", "payload": payload},
            )


def _validate_update_during_transfer(
    instance_id: str, message: ConnectClientMessage, state: dict[str, Any]
) -> None:
    if state.get("transfer_state") != "pending":
        return
    if message.type in PENDING_ALLOWED_TYPES:
        return
    if (
        message.type == "update_status"
        and state.get("transfer_source_instance_id") == instance_id
    ):
        return
    if (
        message.type == "update_position"
        and state.get("transfer_source_instance_id") == instance_id
    ):
        return
    raise ConnectTransferPending("A playback transfer is already pending")


def _updates_from_message(message: ConnectClientMessage) -> dict[str, Any]:
    payload = message.payload
    if message.type == "update_snapshot":
        updates = _queue_updates_from_payload(payload)
        updates["status"] = _status_from_payload(payload)
        updates["position_ms"] = _int_payload(payload, "position_ms", default=0)
        return updates
    if message.type == "update_position":
        return {"position_ms": _int_payload(payload, "position_ms", default=0)}
    if message.type == "update_status":
        return {"status": _status_from_payload(payload)}
    if message.type == "update_queue":
        return _queue_updates_from_payload(payload)
    if message.type == "update_volume":
        volume = max(0.0, min(1.0, float(payload.get("volume") or 0)))
        return {"volume": volume}
    if message.type == "update_shuffle":
        return {"shuffle": bool(payload.get("shuffle"))}
    if message.type == "update_repeat":
        repeat = str(payload.get("repeat") or "off")
        if repeat not in {"off", "one", "all"}:
            raise ValueError("Invalid repeat mode")
        return {"repeat": repeat}
    raise ValueError(f"Unsupported update type: {message.type}")


def _queue_updates_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw_queue = payload.get("queue")
    queue: list[Any] = raw_queue if isinstance(raw_queue, list) else []
    current_index = _int_payload(payload, "current_index", default=0)
    current_track = _track_from_payload(payload, queue, current_index)
    repeat = str(payload.get("repeat_mode") or payload.get("repeat") or "off")
    if repeat not in {"off", "one", "all"}:
        raise ValueError("Invalid repeat mode")
    return {
        "queue": queue,
        "current_index": current_index,
        "queue_revision": payload.get("queue_revision"),
        "play_source": payload.get("play_source")
        if isinstance(payload.get("play_source"), dict)
        else None,
        "unshuffled_queue": payload.get("unshuffled_queue"),
        "track": current_track,
        "track_id": current_track.get("id"),
        "title": current_track.get("title") or "",
        "artist": current_track.get("artist") or "",
        "album": current_track.get("album") or "",
        "album_cover": current_track.get("album_cover"),
        "duration_ms": current_track.get("duration_ms"),
        "repeat": repeat,
        "shuffle": bool(payload.get("shuffle")),
    }


def _status_from_payload(payload: dict[str, Any]) -> str:
    status = str(payload.get("status") or "")
    if status not in {"playing", "paused", "stopped", "buffering"}:
        raise ValueError("Invalid status")
    return status


async def _require_state(user_id: int) -> dict[str, Any]:
    state = await asyncio.to_thread(get_player_state, user_id)
    if not state:
        raise ValueError("No active PlayerState")
    return state


async def _broadcast_state_update(
    user_id: int,
    state: dict[str, Any],
    hub: ConnectHub,
    *,
    exclude_instance: str | None = None,
) -> None:
    await hub.broadcast_to_user(
        user_id,
        {
            "type": "player_state_update",
            "payload": state,
            "version": state.get("version"),
            "timestamp": _now().isoformat(),
        },
        exclude_instance=exclude_instance,
    )


async def _broadcast_connected_instances(user_id: int, hub: ConnectHub) -> None:
    snapshot = hub.connected_instances_snapshot(user_id)
    state = await asyncio.to_thread(get_player_state, user_id)
    snapshot["active_instance_id"] = (state or {}).get("active_instance_id")
    await hub.broadcast_to_user(
        user_id,
        {
            "type": "connected_instances",
            "payload": snapshot,
            "timestamp": _now().isoformat(),
        },
    )


async def _send_error(
    hub: ConnectHub, user_id: int, instance_id: str, code: str, message: str
) -> None:
    await hub.send_to_instance(
        user_id,
        instance_id,
        {"type": "error", "payload": {"code": code, "message": message}},
    )


def _int_payload(payload: dict[str, Any], key: str, *, default: Any) -> int:
    try:
        return max(0, int(payload.get(key, default)))
    except (TypeError, ValueError):
        return max(0, int(default or 0))


def _track_from_payload(
    payload: dict[str, Any], queue: list[Any], index: int
) -> dict[str, Any]:
    track = _track_from_queue(queue, index)
    if track:
        return track
    duration_ms = _as_optional_int(payload.get("duration_ms"))
    return {
        "id": _as_optional_int(payload.get("track_id")),
        "entity_uid": payload.get("track_entity_uid"),
        "path": payload.get("track_path"),
        "title": payload.get("title") or "",
        "artist": payload.get("artist") or "",
        "album": payload.get("album") or "",
        "album_cover": payload.get("album_cover"),
        "duration_ms": duration_ms,
    }


def _track_from_queue(queue: list[Any], index: int) -> dict[str, Any]:
    if index < 0 or index >= len(queue):
        return {}
    item = queue[index]
    if not isinstance(item, dict):
        return {}
    duration_seconds = item.get("duration")
    duration_ms = None
    try:
        if duration_seconds is not None:
            duration_ms = max(0, int(float(duration_seconds) * 1000))
    except (TypeError, ValueError):
        duration_ms = None
    return {
        "id": _as_optional_int(item.get("track_id")),
        "entity_uid": item.get("track_entity_uid"),
        "path": item.get("path"),
        "title": item.get("title") or "",
        "artist": item.get("artist") or "",
        "album": item.get("album") or "",
        "album_cover": item.get("album_cover"),
        "duration_ms": duration_ms,
    }


def _as_optional_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
