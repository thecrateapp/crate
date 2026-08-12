from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import secrets
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.encoders import jsonable_encoder

from crate.api.auth import COOKIE_NAME, COOKIE_NAME_LISTEN, _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.redis_sse import close_pubsub, get_async_redis, open_pubsub
from crate.api.schemas.jam import (
    JamInviteCreateRequest,
    JamInviteJoinRequest,
    JamInviteResponse,
    JamJoinResponse,
    JamRoomCreateRequest,
    JamRoomDeleteResponse,
    JamRoomListResponse,
    JamRoomResponse,
    JamRoomUpdateRequest,
)
from crate.auth import verify_jwt
from crate.db.jam import (
    append_jam_room_event,
    consume_jam_room_invite,
    create_jam_room,
    create_jam_room_invite,
    delete_jam_room,
    get_jam_room,
    get_jam_room_member,
    get_jam_room_members,
    is_jam_room_member,
    list_jam_room_events,
    list_jam_rooms_for_user,
    mark_jam_room_member_offline,
    reactivate_permanent_jam_room,
    touch_jam_room_member,
    update_jam_room_settings,
    update_jam_room_state,
    upsert_jam_room_member,
)
from crate.db.jam_queue import (
    add_jam_queue_item,
    advance_jam_queue,
    create_jam_track_request,
    list_jam_queue_items,
    list_jam_track_requests,
    remove_jam_queue_item,
    reorder_jam_queue_item,
    resolve_jam_track_request,
    start_jam_queue,
    toggle_jam_queue_vote,
)
from crate.db.repositories.auth import get_session
from crate.db.repositories.auth_shared import coerce_datetime
from crate.db.repositories.tasks import create_task_dedup

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jam", tags=["jam"])

_JAM_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        403: error_response("The current user cannot access or mutate this jam room."),
        404: error_response("The requested jam room or invite could not be found."),
        409: error_response("The jam room is no longer active."),
        422: error_response("The request payload failed validation."),
    },
)


def _json_payload(payload: dict) -> dict:
    return jsonable_encoder(payload)


def _coerce_positive_id(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


class _JamPeer:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        self.distributed = False
        self._send_lock = asyncio.Lock()

    async def send_json(self, payload: dict) -> None:
        async with self._send_lock:
            await self.websocket.send_json(_json_payload(payload))

    async def send_text(self, payload: str) -> None:
        async with self._send_lock:
            await self.websocket.send_text(payload)

    async def close(self, *, code: int, reason: str = "") -> None:
        async with self._send_lock:
            await self.websocket.close(code=code, reason=reason)


class _LocalJamHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[_JamPeer]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, peer: _JamPeer) -> None:
        async with self._lock:
            self._rooms.setdefault(room_id, set()).add(peer)

    async def disconnect(self, room_id: str, peer: _JamPeer) -> None:
        async with self._lock:
            peers = self._rooms.get(room_id)
            if not peers:
                return
            peers.discard(peer)
            if not peers:
                self._rooms.pop(room_id, None)

    async def broadcast(
        self, room_id: str, payload: dict, *, fallback_only: bool = False
    ) -> None:
        async with self._lock:
            peers = list(self._rooms.get(room_id, set()))
        for peer in peers:
            if fallback_only and peer.distributed:
                continue
            try:
                await peer.send_json(payload)
            except (RuntimeError, ConnectionResetError, BrokenPipeError):
                log.debug(
                    "Broadcast send failed for peer in room %s", room_id, exc_info=True
                )
                await self.disconnect(room_id, peer)

    async def close_room(
        self, room_id: str, *, code: int = 4409, reason: str = "Room closed"
    ) -> None:
        async with self._lock:
            peers = list(self._rooms.pop(room_id, set()))
        for peer in peers:
            with contextlib.suppress(
                RuntimeError, ConnectionResetError, BrokenPipeError
            ):
                await peer.close(code=code, reason=reason)


_local_hub = _LocalJamHub()
_sync_clocks: dict[str, dict] = {}
_sync_clocks_lock = asyncio.Lock()
_local_heartbeat_owners: dict[str, str] = {}
_local_heartbeat_lock = asyncio.Lock()


def _room_channel(room_id: str) -> str:
    return f"crate:jam:room:{room_id}"


def _sync_clock_key(room_id: str) -> str:
    return f"crate:jam:sync:{room_id}"


_SYNC_HEARTBEAT_SECONDS = 1.0
_HEARTBEAT_LOCK_TTL_SECONDS = max(5, int(_SYNC_HEARTBEAT_SECONDS * 4))


async def _broadcast_to_room(room_id: str, payload: dict) -> None:
    """Publish to the distributed room bus, falling back to local peers."""
    try:
        redis = get_async_redis()
        await redis.publish(_room_channel(room_id), json.dumps(_json_payload(payload)))
        await _local_hub.broadcast(room_id, payload, fallback_only=True)
    except (ConnectionError, RuntimeError):
        log.exception(
            "Failed to publish jam room event for room %s; using local fallback",
            room_id,
        )
        await _local_hub.broadcast(room_id, payload)


async def _broadcast_room_presence(room_id: str) -> None:
    await _broadcast_to_room(
        room_id,
        {
            "type": "presence",
            "room_id": room_id,
            "members": get_jam_room_members(room_id, active_only=True),
        },
    )


async def _set_sync_clock(
    room_id: str, *, track: dict | None, position_ms: float, playing: bool
) -> dict:
    """Store the authoritative playback clock for a room."""
    clock_started_at_ms = datetime.now(timezone.utc).timestamp() * 1000
    clock = _json_payload(
        {
            "track": track,
            "position_ms": position_ms,
            "playing": playing,
            "clock_started_at": clock_started_at_ms / 1000,
            "clock_started_at_ms": clock_started_at_ms,
        }
    )
    async with _sync_clocks_lock:
        _sync_clocks[room_id] = clock
    try:
        redis = get_async_redis()
        await redis.set(_sync_clock_key(room_id), json.dumps(clock))
    except (ConnectionError, RuntimeError):
        log.exception(
            "Failed to persist jam sync clock for room %s; using local fallback",
            room_id,
        )
    return clock


async def _get_sync_clock(room_id: str) -> dict | None:
    """Read the current playback clock for a room."""
    try:
        redis = get_async_redis()
        raw = await redis.get(_sync_clock_key(room_id))
        if raw:
            clock = json.loads(raw)
            async with _sync_clocks_lock:
                _sync_clocks[room_id] = clock
            return clock
    except (ConnectionError, RuntimeError):
        log.exception(
            "Failed to read jam sync clock for room %s; using local fallback", room_id
        )
    async with _sync_clocks_lock:
        return _sync_clocks.get(room_id)


async def _clear_sync_clock(room_id: str) -> None:
    """Remove the playback clock (room paused/ended)."""
    async with _sync_clocks_lock:
        _sync_clocks.pop(room_id, None)
    try:
        redis = get_async_redis()
        await redis.delete(_sync_clock_key(room_id))
    except (ConnectionError, RuntimeError):
        log.exception("Failed to clear jam sync clock for room %s", room_id)


async def _compute_expected_position(clock: dict) -> float:
    """Compute the expected playback position based on the clock."""
    return _clock_position_at(clock, datetime.now(timezone.utc).timestamp() * 1000)


def _clock_position_at(clock: dict, now_ms: float) -> float:
    """Project a room clock at an explicit server timestamp."""
    if not clock.get("playing"):
        return float(clock["position_ms"])
    started_at_ms = clock.get("clock_started_at_ms")
    if not isinstance(started_at_ms, (int, float)):
        # Clocks written by older API processes only have the seconds field.
        started_at_ms = float(clock["clock_started_at"]) * 1000
    elapsed = max(0.0, now_ms - float(started_at_ms))
    return float(clock["position_ms"]) + elapsed


def _build_sync_clock_payload(
    clock: dict, *, now_ms: float | None = None, force_sync: bool = False
) -> dict:
    """Build a sync message with the timestamp used for its position."""
    server_time_ms = (
        now_ms if now_ms is not None else datetime.now(timezone.utc).timestamp() * 1000
    )
    payload = {
        "type": "sync_clock",
        "track": clock.get("track"),
        "position_ms": _clock_position_at(clock, server_time_ms),
        "playing": clock.get("playing"),
        "server_time_ms": server_time_ms,
    }
    if force_sync:
        payload["force_sync"] = True
    return payload


def _room_sync_clock_seed(room: dict) -> tuple[dict, float, bool] | None:
    """Return a safe clock seed when the persisted room has no live clock."""
    current_payload = room.get("current_track_payload")
    if not isinstance(current_payload, dict):
        return None
    current_track = current_payload.get("track")
    if not isinstance(current_track, dict):
        return None
    try:
        position_seconds = float(current_payload.get("position", 0))
    except (TypeError, ValueError):
        position_seconds = 0
    if not math.isfinite(position_seconds):
        position_seconds = 0
    return (
        current_track,
        max(0, position_seconds) * 1000,
        current_payload.get("playing") is True,
    )


def _serialize_room(
    room: dict,
    *,
    events_limit: int = 50,
    user_id: int | None = None,
    include_auto_dj_suggestions: bool = False,
    active_members_only: bool = True,
) -> dict:
    suggestions: list[dict] = []
    if include_auto_dj_suggestions and room.get("queue_mode") == "auto_dj":
        from crate.db.jam_auto_dj import (
            list_auto_dj_candidates,
            list_recent_auto_dj_artists,
        )
        from crate.db.jam_queue import list_jam_queue_vote_tracks
        from crate.jam_auto_dj import (
            _collective_vote_target,
            candidate_to_track_payload,
            rank_auto_dj_candidates,
        )

        current_payload = room.get("current_track_payload")
        current_track = (
            current_payload.get("track")
            if isinstance(current_payload, dict)
            and isinstance(current_payload.get("track"), dict)
            else None
        )
        candidates = list_auto_dj_candidates(
            str(room["id"]),
            genre_filters=room.get("genre_filters") or [],
        )
        suggestions = [
            candidate_to_track_payload(candidate)
            for candidate in rank_auto_dj_candidates(
                candidates,
                current_track=current_track,
                target_vector=_collective_vote_target(
                    current_track,
                    list_jam_queue_vote_tracks(str(room["id"])),
                ),
                genre_filters=room.get("genre_filters") or [],
                recent_artists=list_recent_auto_dj_artists(str(room["id"])),
                limit=5,
                random_value=0.37,
            )
        ]
    members = get_jam_room_members(str(room["id"]), active_only=active_members_only)
    serialized = {
        **room,
        "members": members,
        "events": list_jam_room_events(str(room["id"]), limit=events_limit),
        "queue": list_jam_queue_items(str(room["id"]), user_id=user_id),
        "requests": list_jam_track_requests(str(room["id"])),
        "auto_dj_suggestions": suggestions,
    }
    if active_members_only:
        serialized["member_count"] = len(members)
    return serialized


def _reactivate_permanent_room_if_needed(room: dict) -> dict:
    if room.get("status") == "active" or not room.get("is_permanent"):
        return room
    return reactivate_permanent_jam_room(str(room["id"])) or room


def _normalise_room_tags(tags: list[str] | None) -> list[str]:
    seen: set[str] = set()
    normalised: list[str] = []
    for raw in tags or []:
        tag = raw.strip().lower()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        normalised.append(tag[:40])
        if len(normalised) >= 12:
            break
    return normalised


def _normalise_genre_filters(genres: list[str] | None) -> list[str]:
    return _normalise_room_tags(genres)


def _room_has_current_track(current_track_payload: object) -> bool:
    if not isinstance(current_track_payload, dict):
        return False
    track = current_track_payload.get("track")
    return isinstance(track, dict) and bool(track)


def _prime_auto_dj_room(room: dict) -> dict:
    """Schedule the first Auto DJ buffer without blocking the API response."""

    if room.get("queue_mode") != "auto_dj":
        return room
    try:
        create_task_dedup(
            "prime_jam_auto_dj",
            {"room_id": str(room["id"])},
            dedup_key=f"jam-auto-dj:{room['id']}",
        )
    except Exception:
        # The service loop remains the durable fallback, but a failed enqueue
        # must not turn a successful room settings update into a 500.
        log.exception("Failed to enqueue Auto DJ prime for room %s", room.get("id"))
    return get_jam_room(str(room["id"])) or room


def _normalise_room_description(description: str | None) -> str | None:
    if description is None:
        return None
    value = description.strip()
    return value[:500] if value else None


def _session_is_active_for_user(session: dict | None, user_id: int) -> bool:
    if (
        not session
        or int(session.get("user_id") or 0) != user_id
        or session.get("revoked_at") is not None
    ):
        return False
    expires_at = coerce_datetime(session.get("expires_at"))
    return expires_at is not None and expires_at > datetime.now(timezone.utc)


def _auth_ws(websocket: WebSocket) -> dict:
    media_ticket = websocket.query_params.get("media_ticket")
    if media_ticket:
        from crate.media_access import validate_media_access_ticket

        validated = validate_media_access_ticket(
            media_ticket,
            audience="ws",
            request_path=websocket.url.path,
        )
        if validated:
            session = get_session(validated.session_id)
            if _session_is_active_for_user(session, validated.user_id):
                return {
                    "user_id": validated.user_id,
                    "sid": validated.session_id,
                }

    token = websocket.query_params.get("token")
    if not token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        for cookie_name in (COOKIE_NAME_LISTEN, COOKIE_NAME):
            token = websocket.cookies.get(cookie_name)
            if token:
                break
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = verify_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    session_id = payload.get("sid")
    if session_id:
        session = get_session(session_id)
        try:
            user_id = int(payload["user_id"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=401, detail="Invalid token") from None
        if not _session_is_active_for_user(session, user_id):
            raise HTTPException(status_code=401, detail="Session expired")
    return payload


async def _acquire_heartbeat_lock(room_id: str, owner: str) -> bool:
    key = f"crate:jam:heartbeat:{room_id}"
    try:
        redis = get_async_redis()
        return bool(
            await redis.set(key, owner, nx=True, ex=_HEARTBEAT_LOCK_TTL_SECONDS)
        )
    except (ConnectionError, RuntimeError):
        log.exception("Failed to acquire Redis jam heartbeat lock for room %s", room_id)
    async with _local_heartbeat_lock:
        if room_id in _local_heartbeat_owners:
            return False
        _local_heartbeat_owners[room_id] = owner
        return True


async def _renew_heartbeat_lock(room_id: str, owner: str) -> bool:
    key = f"crate:jam:heartbeat:{room_id}"
    try:
        redis = get_async_redis()
        current_owner = await redis.get(key)
        if current_owner != owner:
            return False
        await redis.expire(key, _HEARTBEAT_LOCK_TTL_SECONDS)
        return True
    except (ConnectionError, RuntimeError):
        log.exception("Failed to renew Redis jam heartbeat lock for room %s", room_id)
    async with _local_heartbeat_lock:
        return _local_heartbeat_owners.get(room_id) == owner


async def _release_heartbeat_lock(room_id: str, owner: str) -> None:
    key = f"crate:jam:heartbeat:{room_id}"
    try:
        redis = get_async_redis()
        current_owner = await redis.get(key)
        if current_owner == owner:
            await redis.delete(key)
    except (ConnectionError, RuntimeError):
        log.exception("Failed to release Redis jam heartbeat lock for room %s", room_id)
    async with _local_heartbeat_lock:
        if _local_heartbeat_owners.get(room_id) == owner:
            _local_heartbeat_owners.pop(room_id, None)


@router.post(
    "/rooms",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="Create a jam room",
)
def create_room(request: Request, body: JamRoomCreateRequest):
    user = _require_auth(request)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Room name is required")
    genre_filters = _normalise_genre_filters(body.genre_filters)
    room = create_jam_room(
        user["id"],
        body.name.strip(),
        visibility=body.visibility,
        is_permanent=body.is_permanent or body.queue_mode == "auto_dj",
        description=_normalise_room_description(body.description),
        tags=_normalise_room_tags(body.tags),
        queue_mode=body.queue_mode,
        auto_dj_voting=body.auto_dj_voting,
        genre_filters=genre_filters,
    )
    append_jam_room_event(str(room["id"]), "join", {"role": "host"}, user["id"])
    room = _prime_auto_dj_room(room)
    return _serialize_room(
        room,
        user_id=user["id"],
        include_auto_dj_suggestions=True,
        active_members_only=True,
    )


@router.get(
    "/rooms",
    response_model=JamRoomListResponse,
    responses=_JAM_RESPONSES,
    summary="List active jam rooms visible to the current user",
)
def list_rooms(request: Request, q: str | None = Query(default=None, max_length=80)):
    user = _require_auth(request)
    rooms = list_jam_rooms_for_user(user["id"], limit=50, query=q)
    return {
        "rooms": [
            _serialize_room(
                room,
                events_limit=12,
                user_id=user["id"],
                active_members_only=True,
            )
            for room in rooms
        ]
    }


@router.get(
    "/rooms/{room_id}",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="Get jam room state",
)
async def get_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    member = get_jam_room_member(room_id, user["id"])
    if (
        not member
        and room.get("visibility") == "public"
        and (room.get("status") == "active" or room.get("is_permanent"))
    ):
        room = _reactivate_permanent_room_if_needed(room)
        upsert_jam_room_member(room_id, user["id"], role="collab")
        event = append_jam_room_event(room_id, "join", {"role": "collab"}, user["id"])
        updated = get_jam_room(room_id) or room
        serialized = _serialize_room(
            updated,
            user_id=user["id"],
            include_auto_dj_suggestions=True,
            active_members_only=True,
        )
        await _broadcast_to_room(
            room_id,
            {
                "type": "join",
                "event": event,
                "room": serialized,
                "members": serialized["members"],
            },
        )
        return serialized
    if not member:
        raise HTTPException(status_code=403, detail="Not a room member")
    room = _reactivate_permanent_room_if_needed(room)
    touch_jam_room_member(room_id, user["id"])
    return _serialize_room(
        room,
        user_id=user["id"],
        include_auto_dj_suggestions=True,
        active_members_only=True,
    )


@router.patch(
    "/rooms/{room_id}",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="Update jam room settings",
)
async def update_room(request: Request, room_id: str, body: JamRoomUpdateRequest):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["host_user_id"] != user["id"]:
        raise HTTPException(
            status_code=403, detail="Only the host can update this room"
        )
    if room.get("status") != "active":
        if room.get("is_permanent"):
            room = _reactivate_permanent_room_if_needed(room)
        else:
            raise HTTPException(status_code=409, detail="Room is no longer active")

    name = body.name.strip() if body.name is not None else None
    if body.name is not None and not name:
        raise HTTPException(status_code=422, detail="Room name is required")
    effective_queue_mode = body.queue_mode or room.get("queue_mode", "manual")
    updated = update_jam_room_settings(
        room_id,
        name=name,
        visibility=body.visibility,
        is_permanent=(True if effective_queue_mode == "auto_dj" else body.is_permanent),
        description=_normalise_room_description(body.description)
        if "description" in body.model_fields_set
        else None,
        description_provided="description" in body.model_fields_set,
        tags=_normalise_room_tags(body.tags) if body.tags is not None else None,
        queue_mode=body.queue_mode,
        auto_dj_voting=(
            body.auto_dj_voting if "auto_dj_voting" in body.model_fields_set else None
        ),
        genre_filters=(
            _normalise_genre_filters(body.genre_filters)
            if "genre_filters" in body.model_fields_set
            else None
        ),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")
    updated = _prime_auto_dj_room(updated)
    event = append_jam_room_event(
        room_id,
        "room_updated",
        {
            "name": updated["name"],
            "visibility": updated.get("visibility", "private"),
            "is_permanent": bool(updated.get("is_permanent")),
            "description": updated.get("description"),
            "tags": updated.get("tags") or [],
            "queue_mode": updated.get("queue_mode", "manual"),
            "auto_dj_voting": bool(updated.get("auto_dj_voting", True)),
            "genre_filters": updated.get("genre_filters") or [],
        },
        user["id"],
    )
    serialized = _serialize_room(
        updated,
        user_id=user["id"],
        include_auto_dj_suggestions=True,
        active_members_only=True,
    )
    await _broadcast_to_room(
        room_id,
        {
            "type": "room_updated",
            "event": event,
            "room": serialized,
            "members": serialized["members"],
        },
    )
    return serialized


@router.post(
    "/rooms/{room_id}/join",
    response_model=JamJoinResponse,
    responses=_JAM_RESPONSES,
    summary="Join a public jam room",
)
async def join_public_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.get("status") != "active":
        if room.get("is_permanent"):
            room = _reactivate_permanent_room_if_needed(room)
        else:
            raise HTTPException(status_code=409, detail="Room is no longer active")
    existing_member = get_jam_room_member(room_id, user["id"])
    if not existing_member and room.get("visibility") != "public":
        raise HTTPException(status_code=403, detail="This room is invite-only")

    event = None
    if existing_member:
        touch_jam_room_member(room_id, user["id"])
    else:
        upsert_jam_room_member(room_id, user["id"], role="collab")
        event = append_jam_room_event(room_id, "join", {"role": "collab"}, user["id"])
    updated = get_jam_room(room_id) or room
    serialized = _serialize_room(updated, user_id=user["id"], active_members_only=True)
    if event:
        await _broadcast_to_room(
            room_id,
            {
                "type": "join",
                "event": event,
                "room": serialized,
                "members": serialized["members"],
            },
        )
    else:
        await _broadcast_to_room(
            room_id,
            {
                "type": "presence",
                "room_id": room_id,
                "members": serialized["members"],
            },
        )
    return {"ok": True, "room": serialized, "event": event}


@router.post(
    "/rooms/{room_id}/invites",
    response_model=JamInviteResponse,
    responses=_JAM_RESPONSES,
    summary="Create a jam room invite",
)
def create_room_invite(request: Request, room_id: str, body: JamInviteCreateRequest):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["host_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the host can create invites")
    if room.get("status") != "active":
        raise HTTPException(status_code=409, detail="Room is no longer active")
    invite = create_jam_room_invite(
        room_id,
        user["id"],
        expires_in_hours=body.expires_in_hours,
        max_uses=body.max_uses,
    )
    return {
        **invite,
        "join_url": f"/jam/invite/{invite['token']}",
        "qr_value": f"/jam/invite/{invite['token']}",
    }


@router.post(
    "/rooms/invites/{token}/join",
    response_model=JamJoinResponse,
    responses=_JAM_RESPONSES,
    summary="Join a jam room from an invite",
)
async def join_room_by_invite(request: Request, token: str, body: JamInviteJoinRequest):
    user = _require_auth(request)
    invite = consume_jam_room_invite(token)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    room = get_jam_room(str(invite["room_id"]))
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.get("status") != "active":
        raise HTTPException(status_code=409, detail="Room is no longer active")
    existing_member = get_jam_room_member(str(invite["room_id"]), user["id"])
    role = existing_member["role"] if existing_member else "collab"
    upsert_jam_room_member(str(invite["room_id"]), user["id"], role=role)
    event = append_jam_room_event(
        str(invite["room_id"]), "join", {"role": role}, user["id"]
    )
    updated = get_jam_room(str(invite["room_id"])) or room
    serialized = _serialize_room(updated, user_id=user["id"], active_members_only=True)
    await _broadcast_to_room(
        str(invite["room_id"]),
        {
            "type": "join",
            "event": event,
            "room": serialized,
            "members": serialized["members"],
        },
    )
    return {
        "ok": True,
        "room": serialized,
        "event": event,
    }


@router.post(
    "/rooms/{room_id}/end",
    response_model=JamRoomResponse,
    responses=_JAM_RESPONSES,
    summary="End a jam room",
)
async def end_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["host_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the host can end this room")
    if room.get("status") == "ended":
        return _serialize_room(room)
    ended_at = datetime.now(timezone.utc).isoformat()
    updated = update_jam_room_state(room_id, status="ended", ended_at=ended_at)
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")
    event = append_jam_room_event(
        room_id, "room_ended", {"ended_at": ended_at}, user["id"]
    )
    await _clear_sync_clock(room_id)
    await _broadcast_to_room(
        room_id,
        {
            "type": "room_ended",
            "event": event,
            "room": _serialize_room(updated),
            "members": get_jam_room_members(room_id, active_only=True),
        },
    )
    await _local_hub.close_room(room_id, reason="Room ended")
    return _serialize_room(updated)


@router.delete(
    "/rooms/{room_id}",
    response_model=JamRoomDeleteResponse,
    responses=_JAM_RESPONSES,
    summary="Delete a jam room",
)
async def delete_room(request: Request, room_id: str):
    user = _require_auth(request)
    room = get_jam_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["host_user_id"] != user["id"]:
        raise HTTPException(
            status_code=403, detail="Only the host can delete this room"
        )

    await _clear_sync_clock(room_id)
    await _broadcast_to_room(
        room_id,
        {
            "type": "room_deleted",
            "room_id": room_id,
        },
    )
    if not delete_jam_room(room_id):
        raise HTTPException(status_code=404, detail="Room not found")
    await _local_hub.close_room(room_id, reason="Room deleted")
    return {"ok": True, "room_id": room_id}


@router.websocket("/rooms/{room_id}/ws")
async def jam_room_ws(websocket: WebSocket, room_id: str):
    try:
        payload = _auth_ws(websocket)
    except HTTPException:
        await websocket.close(code=4401)
        return

    user_id = int(payload["user_id"])
    room = get_jam_room(room_id)
    if not room or not is_jam_room_member(room_id, user_id):
        await websocket.close(code=4403)
        return
    if room.get("status") != "active":
        if room.get("is_permanent"):
            room = _reactivate_permanent_room_if_needed(room)
        else:
            await websocket.close(code=4403)
            return
    if room.get("status") != "active":
        await websocket.close(code=4403)
        return
    member = get_jam_room_member(room_id, user_id)
    if not member:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    peer = _JamPeer(websocket)
    await _local_hub.connect(room_id, peer)

    pubsub = None
    listener_task: asyncio.Task | None = None
    left_room = False
    try:
        pubsub = await open_pubsub(_room_channel(room_id))
        peer.distributed = True
    except (ConnectionError, RuntimeError):
        log.exception("Failed to open Redis pubsub for room %s", room_id)
        await peer.send_json(
            {
                "type": "warning",
                "detail": "Room sync is running in local fallback mode",
            }
        )
    touch_jam_room_member(room_id, user_id)
    await peer.send_json(
        {
            "type": "state_sync",
            "room": _serialize_room(room, user_id=user_id, active_members_only=True),
        }
    )

    try:
        clock = await _get_sync_clock(room_id)
        if clock is None:
            seed = _room_sync_clock_seed(room)
            if seed is not None:
                current_track, position_ms, playing = seed
                clock = await _set_sync_clock(
                    room_id,
                    track=current_track,
                    position_ms=position_ms,
                    playing=playing,
                )
        if clock:
            await peer.send_json(_build_sync_clock_payload(clock, force_sync=True))
    except (RuntimeError, ConnectionResetError, BrokenPipeError):
        log.exception("Failed to send sync clock for room %s", room_id)

    await _broadcast_room_presence(room_id)

    heartbeat_task: asyncio.Task | None = None
    heartbeat_owner = secrets.token_urlsafe(16)

    async def _sync_heartbeat():
        while True:
            await asyncio.sleep(_SYNC_HEARTBEAT_SECONDS)
            if not await _renew_heartbeat_lock(room_id, heartbeat_owner):
                break
            clock = await _get_sync_clock(room_id)
            if not clock or not clock.get("playing"):
                continue
            await _broadcast_to_room(room_id, _build_sync_clock_payload(clock))

    if await _acquire_heartbeat_lock(room_id, heartbeat_owner):
        heartbeat_task = asyncio.create_task(_sync_heartbeat())

    async def _redis_listener():
        if pubsub is None:
            return
        try:
            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if message and message.get("type") == "message":
                    data_str = message.get("data")
                    if data_str and isinstance(data_str, str):
                        try:
                            await peer.send_text(data_str)
                            payload = json.loads(data_str)
                            if payload.get("type") in {"room_ended", "room_deleted"}:
                                await peer.close(code=4409, reason="Room closed")
                                break
                        except (RuntimeError, ConnectionResetError, BrokenPipeError):
                            log.debug(
                                "Redis listener send failed for room %s",
                                room_id,
                                exc_info=True,
                            )
                            break
        except (ConnectionError, RuntimeError):
            log.debug("Redis listener ended for room %s", room_id, exc_info=True)

    listener_task = asyncio.create_task(_redis_listener())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                await peer.send_json({"type": "error", "detail": "Invalid JSON"})
                continue
            event_type = data.get("type")
            if event_type == "ping":
                client_sent_at_ms = data.get("client_sent_at_ms")
                pong = {
                    "type": "pong",
                    "server_time_ms": datetime.now(timezone.utc).timestamp() * 1000,
                }
                if isinstance(client_sent_at_ms, (int, float)):
                    pong["client_sent_at_ms"] = client_sent_at_ms
                await peer.send_json(pong)
                touch_jam_room_member(room_id, user_id)
                await _broadcast_room_presence(room_id)
                continue
            if event_type == "leave":
                # Route changes and tab closes do not always reach the server
                # as a clean WebSocketDisconnect. Make leaving explicit so
                # the remaining members see the change immediately.
                mark_jam_room_member_offline(room_id, user_id)
                await _local_hub.disconnect(room_id, peer)
                await _broadcast_room_presence(room_id)
                left_room = True
                break
            if event_type not in {
                "queue_add",
                "queue_remove",
                "queue_reorder",
                "queue_vote",
                "track_request",
                "request_approve",
                "request_reject",
                "play",
                "pause",
                "seek",
                "play_next",
                "queue_play",
                "sync",
                "join",
                "presence",
            }:
                continue
            touch_jam_room_member(room_id, user_id)
            role = member.get("role")
            current_room = get_jam_room(room_id) or room
            queue_mode = current_room.get("queue_mode", "manual")
            if event_type == "sync":
                if data.get("scope") == "room" and role != "host":
                    await peer.send_json(
                        {"type": "error", "detail": "Only the host can sync the room"}
                    )
                    continue
                clock = await _get_sync_clock(room_id)
                if data.get("scope") == "room":
                    current_payload = current_room.get("current_track_payload")
                    current_track = (
                        current_payload.get("track")
                        if isinstance(current_payload, dict)
                        and isinstance(current_payload.get("track"), dict)
                        else None
                    )
                    requested_track = data.get("track")
                    sync_track = current_track or (
                        requested_track if isinstance(requested_track, dict) else None
                    )
                    if sync_track is not None:
                        requested_position = data.get("position")
                        try:
                            position_seconds = float(requested_position)
                        except (TypeError, ValueError):
                            position_seconds = float("nan")
                        if not math.isfinite(position_seconds):
                            if clock is not None:
                                position_seconds = (
                                    _clock_position_at(
                                        clock,
                                        datetime.now(timezone.utc).timestamp() * 1000,
                                    )
                                    / 1000
                                )
                            elif isinstance(current_payload, dict):
                                try:
                                    position_seconds = float(
                                        current_payload.get("position", 0)
                                    )
                                except (TypeError, ValueError):
                                    position_seconds = 0
                            else:
                                position_seconds = 0
                        position_seconds = max(0, position_seconds)
                        clock = await _set_sync_clock(
                            room_id,
                            track=sync_track,
                            position_ms=position_seconds * 1000,
                            playing=bool(data.get("playing")) and bool(sync_track),
                        )
                if clock:
                    payload = _build_sync_clock_payload(clock, force_sync=True)
                    if data.get("scope") == "room":
                        await _broadcast_to_room(room_id, payload)
                    else:
                        await peer.send_json(payload)
                continue
            if (
                event_type
                in {
                    "play",
                    "pause",
                    "seek",
                    "play_next",
                    "queue_play",
                }
                and role != "host"
            ):
                await peer.send_json(
                    {"type": "error", "detail": "Only the host can control playback"}
                )
                continue
            if event_type in {"queue_remove", "queue_reorder"} and role != "host":
                await peer.send_json(
                    {"type": "error", "detail": "Only the host can manage this queue"}
                )
                continue
            if event_type == "queue_add" and not (
                role == "host" or (queue_mode == "auto" and role == "collab")
            ):
                await peer.send_json(
                    {
                        "type": "error",
                        "detail": "Members must suggest tracks in DJ mode",
                    }
                )
                continue
            if event_type == "queue_vote" and queue_mode not in {"auto", "auto_dj"}:
                await peer.send_json(
                    {"type": "error", "detail": "Votes are available in auto mode"}
                )
                continue
            if (
                event_type == "queue_vote"
                and queue_mode == "auto_dj"
                and current_room.get("auto_dj_voting") is False
            ):
                await peer.send_json(
                    {
                        "type": "error",
                        "detail": "Voting is disabled for this Auto DJ room",
                    }
                )
                continue
            if event_type in {"queue_vote", "track_request"} and role not in {
                "host",
                "collab",
            }:
                await peer.send_json(
                    {"type": "error", "detail": "You cannot use this room action"}
                )
                continue
            if event_type in {"request_approve", "request_reject"} and role != "host":
                await peer.send_json(
                    {"type": "error", "detail": "Only the host can resolve requests"}
                )
                continue

            if event_type == "queue_add":
                track = data.get("track")
                if not isinstance(track, dict):
                    await peer.send_json(
                        {"type": "error", "detail": "A track is required"}
                    )
                    continue
                item = add_jam_queue_item(
                    room_id,
                    track,
                    user_id,
                    source="owner" if role == "host" else "member",
                )
                if item.get("_deduplicated"):
                    await peer.send_json(
                        {
                            "type": "error",
                            "detail": "Track is already in the room queue",
                        }
                    )
                    continue
                data = {**data, "queue_item_id": item["id"]}
                if not _room_has_current_track(
                    current_room.get("current_track_payload")
                ):
                    started_item = start_jam_queue(room_id)
                    started_track = (
                        started_item.get("track")
                        if isinstance(started_item, dict)
                        else None
                    )
                    if isinstance(started_track, dict):
                        data = {
                            **data,
                            "current_track": started_track,
                            "position": 0,
                            "playing": True,
                        }
                        started_clock = await _set_sync_clock(
                            room_id,
                            track=started_track,
                            position_ms=0,
                            playing=True,
                        )
                        data = {
                            **data,
                            "server_time_ms": started_clock["clock_started_at_ms"],
                        }
                        update_jam_room_state(
                            room_id,
                            current_track_payload={
                                "track": started_track,
                                "position": 0,
                                "playing": True,
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                            },
                        )
            elif event_type == "track_request":
                track = data.get("track")
                if not isinstance(track, dict):
                    await peer.send_json(
                        {"type": "error", "detail": "A track is required"}
                    )
                    continue
                request = create_jam_track_request(room_id, track, user_id)
                data = {**data, "request_id": request["id"]}
            elif event_type == "queue_vote":
                queue_item_id = _coerce_positive_id(data.get("queue_item_id"))
                if queue_item_id is None:
                    await peer.send_json(
                        {"type": "error", "detail": "A queue item is required"}
                    )
                    continue
                result = toggle_jam_queue_vote(room_id, queue_item_id, user_id)
                data = {**data, **result, "queue_item_id": str(queue_item_id)}
            elif event_type in {"request_approve", "request_reject"}:
                request_id = _coerce_positive_id(data.get("request_id"))
                if request_id is None:
                    await peer.send_json(
                        {"type": "error", "detail": "A request is required"}
                    )
                    continue
                resolved = resolve_jam_track_request(
                    room_id,
                    request_id,
                    user_id,
                    approve=event_type == "request_approve",
                )
                if resolved is None:
                    await peer.send_json(
                        {"type": "error", "detail": "Track request not found"}
                    )
                    continue
                data = {**data, **resolved}
            elif event_type == "queue_remove":
                queue_item_id = _coerce_positive_id(data.get("queue_item_id"))
                if queue_item_id is None and isinstance(data.get("index"), int):
                    queue = list_jam_queue_items(room_id)
                    index = data["index"]
                    queue_item_id = (
                        queue[index]["id"] if 0 <= index < len(queue) else None
                    )
                if queue_item_id is None or not remove_jam_queue_item(
                    room_id, queue_item_id
                ):
                    await peer.send_json(
                        {"type": "error", "detail": "Queue item not found"}
                    )
                    continue
                data = {**data, "queue_item_id": str(queue_item_id)}
            elif event_type == "queue_reorder":
                queue_item_id = _coerce_positive_id(data.get("queue_item_id"))
                if queue_item_id is None and isinstance(data.get("fromIndex"), int):
                    queue = list_jam_queue_items(room_id)
                    from_index = data["fromIndex"]
                    queue_item_id = (
                        queue[from_index]["id"]
                        if 0 <= from_index < len(queue)
                        else None
                    )
                to_index = data.get("toIndex")
                if queue_item_id is None or not isinstance(to_index, int):
                    await peer.send_json(
                        {
                            "type": "error",
                            "detail": "Queue item and destination are required",
                        }
                    )
                    continue
                reorder_jam_queue_item(room_id, queue_item_id, to_index)
                data = {**data, "queue_item_id": str(queue_item_id)}

            if event_type == "play_next":
                next_item = advance_jam_queue(room_id)
                data = {
                    **data,
                    "track": next_item["track"] if next_item else None,
                    "queue_item_id": next_item["id"] if next_item else None,
                    "position": 0,
                    "playing": bool(next_item),
                }

            if event_type == "queue_play":
                current_item = start_jam_queue(room_id)
                data = {
                    **data,
                    "track": current_item["track"] if current_item else None,
                    "queue_item_id": current_item["id"] if current_item else None,
                    "position": 0,
                    "playing": bool(current_item),
                }

            if event_type in {"play", "pause", "seek", "play_next", "queue_play"}:
                track = data.get("track")
                position_seconds = float(data.get("position", 0))
                position_ms = position_seconds * 1000
                playing = (
                    event_type in {"play", "play_next", "queue_play"} and bool(track)
                ) or (event_type == "seek" and bool(data.get("playing")))
                transport_clock = await _set_sync_clock(
                    room_id,
                    track=track,
                    position_ms=position_ms,
                    playing=playing,
                )
                data = {
                    **data,
                    "server_time_ms": transport_clock["clock_started_at_ms"],
                }
                state = {
                    "track": track,
                    "position": position_seconds,
                    "playing": playing,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                update_jam_room_state(room_id, current_track_payload=state)

            event = append_jam_room_event(room_id, event_type, data, user_id)
            await _broadcast_to_room(
                room_id,
                {
                    "type": event_type,
                    "event": event,
                    "members": get_jam_room_members(room_id, active_only=True),
                    "queue": list_jam_queue_items(room_id),
                    "requests": list_jam_track_requests(room_id),
                },
            )
    except WebSocketDisconnect:
        pass
    finally:
        if listener_task is not None:
            listener_task.cancel()
            try:
                await listener_task
            except asyncio.CancelledError:
                pass
            except Exception:
                log.debug(
                    "Jam Redis listener exited during cleanup for room %s",
                    room_id,
                    exc_info=True,
                )
        if heartbeat_task:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            except Exception:
                log.debug(
                    "Jam heartbeat exited during cleanup for room %s",
                    room_id,
                    exc_info=True,
                )
            try:
                await _release_heartbeat_lock(room_id, heartbeat_owner)
            except Exception:
                log.debug(
                    "Failed to release jam heartbeat for room %s",
                    room_id,
                    exc_info=True,
                )
        if not left_room:
            try:
                mark_jam_room_member_offline(room_id, user_id)
            except Exception:
                log.exception("Failed to mark jam member offline for room %s", room_id)
            try:
                await _local_hub.disconnect(room_id, peer)
            except Exception:
                log.exception("Failed to disconnect jam peer for room %s", room_id)
            try:
                await _broadcast_room_presence(room_id)
            except Exception:
                # Presence cleanup must not be lost because a Redis connection
                # is already closing. The TTL is still a secondary fallback.
                log.exception("Failed to broadcast jam presence for room %s", room_id)
        if pubsub is not None:
            try:
                await close_pubsub(pubsub, _room_channel(room_id))
            except Exception:
                log.debug(
                    "Failed to close jam pubsub for room %s",
                    room_id,
                    exc_info=True,
                )
