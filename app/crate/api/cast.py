from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from crate.api.auth import _request_base_origin, _require_auth
from crate.api.browse_media import _playback_headers, _stream_resolved_file
from crate.api.browse_album import api_cover
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.cast import (
    CastPlayCheckpointRequest,
    CastReceiverStateRequest,
    CastMediaResponse,
    CastSessionCreateRequest,
    CastSessionQueueItemRequest,
    CastSessionQueueUpdateRequest,
    CastTicketRequest,
    CastTicketResponse,
)
from crate.db.repositories.cast_sessions import (
    create_cast_session,
    revoke_cast_session,
    touch_cast_session,
    update_cast_session_queue,
    update_cast_session_state,
)
from crate.db.repositories.cast_spectrum import (
    ensure_cast_spectrum_request,
    mark_cast_spectrum_missing,
)
from crate.db.repositories.cast_tickets import (
    CAST_AUTO_POLICY,
    create_cast_ticket,
    get_cast_ticket,
    mark_cast_ticket_used,
    receiver_safe_delivery_policy,
)
from crate.db.repositories.streaming import (
    get_track_delivery_row_by_entity_uid,
    get_track_delivery_row_by_id,
    get_track_delivery_row_by_path,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.db.repositories.user_library_playback_writes import record_play_event
from crate.streaming.policy import (
    BALANCED_POLICY,
    DATA_SAVER_POLICY,
    ORIGINAL_POLICY,
    infer_format,
)
from crate.streaming.service import media_type_for_path, resolve_playback
from crate.cast_spectrum import MEDIA_TYPE as CAST_SPECTRUM_MEDIA_TYPE
from crate.cast_spectrum import source_fingerprint
from crate.streaming.paths import resolve_data_file
from crate.streaming.service import resolve_source_path

router = APIRouter(tags=["cast"])

_CAST_TICKET_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_CAST_PUBLIC_RESPONSES: dict[int | str, dict[str, Any]] = {
    404: error_response("The cast ticket is invalid, expired, revoked, or missing."),
    425: error_response("The receiver-safe playback variant is still preparing."),
}
_RECEIVER_SAFE_SOURCE_FORMATS = {"aac", "m4a", "mp3"}
_RECEIVER_CAPABILITY_FORMAT_KEYS = (
    "formats",
    "audio_formats",
    "supported_formats",
    "content_types",
    "mime_types",
    "codecs",
)


def _require_persisted_user_id(request: Request) -> int:
    user = _require_auth(request)
    user_id = user.get("id")
    if not isinstance(user_id, int):
        raise HTTPException(status_code=401, detail="A persisted user is required")
    return user_id


def _absolute_url(
    request: Request,
    route_name: str,
    ticket: str,
    *,
    public_origin: str,
) -> str:
    route_url = request.url_for(route_name, ticket=ticket)
    return f"{public_origin.rstrip('/')}{route_url.path}"


def _absolute_api_url(request: Request, route_name: str, ticket: str) -> str:
    public_origin = os.environ.get("CRATE_PUBLIC_API_BASE_URL") or _request_base_origin(
        request
    )
    return _absolute_url(
        request,
        route_name,
        ticket,
        public_origin=public_origin,
    )


def _absolute_cast_url(request: Request, route_name: str, ticket: str) -> str:
    public_origin = (
        os.environ.get("CRATE_CAST_PUBLIC_BASE_URL")
        or os.environ.get("CRATE_PUBLIC_API_BASE_URL")
        or _request_base_origin(request)
    )
    return _absolute_url(
        request,
        route_name,
        ticket,
        public_origin=public_origin,
    )


def _absolute_cast_route_url(
    request: Request,
    route_name: str,
    **path_params: str,
) -> str:
    public_origin = (
        os.environ.get("CRATE_CAST_PUBLIC_BASE_URL")
        or os.environ.get("CRATE_PUBLIC_API_BASE_URL")
        or _request_base_origin(request)
    )
    route_url = request.url_for(route_name, **path_params)
    return f"{public_origin.rstrip('/')}{route_url.path}"


def _track_for_ticket(ticket_payload: dict) -> dict | None:
    track_id = ticket_payload.get("track_id")
    if track_id is not None:
        return get_track_delivery_row_by_id(int(track_id))
    entity_uid = ticket_payload.get("track_entity_uid")
    if entity_uid:
        return get_track_delivery_row_by_entity_uid(str(entity_uid))
    track_path = ticket_payload.get("track_path")
    if track_path:
        return get_track_delivery_row_by_path(str(track_path))
    return None


def _track_from_request(body: CastTicketRequest) -> dict | None:
    if body.track_id is not None:
        return get_track_delivery_row_by_id(body.track_id)
    if body.track_entity_uid is not None:
        return get_track_delivery_row_by_entity_uid(str(body.track_entity_uid))
    if body.track_path:
        return get_track_delivery_row_by_path(body.track_path)
    return None


def _track_from_queue_reference(body: CastSessionQueueItemRequest) -> dict | None:
    if body.track_id is not None:
        return get_track_delivery_row_by_id(body.track_id)
    if body.track_entity_uid is not None:
        return get_track_delivery_row_by_entity_uid(str(body.track_entity_uid))
    if body.track_path:
        return get_track_delivery_row_by_path(body.track_path)
    return None


def _track_from_session_item(item: dict) -> dict | None:
    track_id = item.get("track_id")
    if track_id is not None:
        return get_track_delivery_row_by_id(int(track_id))
    entity_uid = item.get("track_entity_uid")
    if entity_uid:
        return get_track_delivery_row_by_entity_uid(str(entity_uid))
    track_path = item.get("track_path")
    if track_path:
        return get_track_delivery_row_by_path(str(track_path))
    return None


def _resolved_queue_item(body: CastSessionQueueItemRequest) -> dict:
    track = _track_from_queue_reference(body)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return {
        "item_id": body.item_id,
        "track_id": track.get("id"),
        "track_entity_uid": str(track.get("entity_uid"))
        if track.get("entity_uid") is not None
        else None,
        "track_path": track.get("path"),
        "title": track.get("title") or "",
        "artist": track.get("artist") or "",
        "album": track.get("album") or "",
        "duration": float(track["duration"])
        if track.get("duration") is not None
        else None,
        "format": track.get("format"),
        "quality": track.get("quality"),
        "artwork_url": body.artwork_url,
    }


def _resolve_session_queue(items: list[CastSessionQueueItemRequest]) -> list[dict]:
    return [_resolved_queue_item(item) for item in items]


def _session_item_or_404(session: dict, item_id: str) -> dict:
    item = next(
        (item for item in session.get("queue") or [] if item.get("item_id") == item_id),
        None,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Cast item not found")
    return item


def _session_by_lease_or_404(lease: str) -> dict:
    session = touch_cast_session(lease)
    if session is None:
        raise HTTPException(status_code=404, detail="Cast session not found")
    return session


def _session_item_and_track_or_404(lease: str, item_id: str) -> tuple[dict, dict, dict]:
    session = _session_by_lease_or_404(lease)
    item = _session_item_or_404(session, item_id)
    track = _track_from_session_item(item)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return session, item, track


def _content_type_hint(item: dict, session: dict) -> str:
    source_format = _normalize_receiver_format(item.get("format"))
    if _receiver_supports_source_format(item, session):
        source_path = str(item.get("track_path") or "").lower()
        if source_path.endswith(".m4a"):
            return "audio/mp4"
        return {
            "aac": "audio/aac",
            "flac": "audio/flac",
            "m4a": "audio/mp4",
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
        }.get(source_format, "audio/mpeg")
    if source_format == "mp3":
        return "audio/mpeg"
    return "audio/mp4"


def _serialise_session_item(
    request: Request,
    item: dict,
    *,
    lease: str | None,
    session: dict,
) -> dict:
    result = dict(item)
    if lease:
        item_id = str(item["item_id"])
        result.update(
            {
                "artwork_url": _absolute_cast_route_url(
                    request,
                    "get_cast_session_item_artwork",
                    lease=lease,
                    item_id=item_id,
                ),
                "content_type": _content_type_hint(item, session),
                "metadata_url": _absolute_cast_route_url(
                    request,
                    "get_cast_session_item",
                    lease=lease,
                    item_id=item_id,
                ),
                "spectrum_url": _absolute_cast_route_url(
                    request,
                    "get_cast_session_item_spectrum",
                    lease=lease,
                    item_id=item_id,
                ),
                "stream_url": _absolute_cast_route_url(
                    request,
                    "get_cast_session_item_stream",
                    lease=lease,
                    item_id=item_id,
                ),
            }
        )
    return result


def _serialise_cast_session(
    request: Request,
    session: dict,
    *,
    lease: str | None = None,
) -> dict:
    queue_items = [
        _serialise_session_item(request, item, lease=lease, session=session)
        for item in session.get("queue") or []
    ]
    return {
        "session_id": session["session_id"],
        "target_device_id": session.get("target_device_id"),
        "protocol_version": session.get("protocol_version") or 1,
        "receiver_capabilities": session.get("receiver_capabilities") or {},
        "appearance": session.get("appearance") or {},
        "queue": {
            "revision": int(session.get("revision") or 0),
            "state_seq": int(session.get("state_seq") or 0),
            "current_index": int(session.get("current_index") or 0),
            "current_time": float(session.get("current_time") or 0),
            "repeat_mode": session.get("repeat_mode") or "off",
            "shuffle": bool(session.get("shuffle")),
            "items": queue_items,
        },
        "expires_at": session.get("expires_at"),
    }


def _valid_ticket_or_404(ticket: str) -> dict:
    ticket_payload = get_cast_ticket(ticket)
    if ticket_payload is None:
        raise HTTPException(status_code=404, detail="Cast ticket not found")
    return ticket_payload


def _normalize_receiver_format(value: object) -> str:
    normalized = str(value or "").strip().lower().lstrip(".")
    aliases = {
        "audio/aac": "aac",
        "audio/mp4": "aac",
        "m4a": "aac",
        "mp4": "aac",
        "audio/mpeg": "mp3",
        "mpeg": "mp3",
        "audio/flac": "flac",
        "x-flac": "flac",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
    }
    return aliases.get(normalized, normalized)


def _source_format_for_track(track: dict) -> str:
    return _normalize_receiver_format(
        infer_format(track.get("format"), str(track.get("path") or ""))
    )


def _receiver_capability_formats(capabilities: dict) -> set[str]:
    formats: set[str] = set()
    for key in _RECEIVER_CAPABILITY_FORMAT_KEYS:
        value = capabilities.get(key)
        if isinstance(value, str):
            formats.add(_normalize_receiver_format(value))
        elif isinstance(value, (list, tuple, set)):
            formats.update(_normalize_receiver_format(item) for item in value)
    return {fmt for fmt in formats if fmt}


def _receiver_supports_source_format(track: dict, ticket_payload: dict) -> bool:
    source_format = _source_format_for_track(track)
    if source_format in _RECEIVER_SAFE_SOURCE_FORMATS:
        return True
    capabilities = ticket_payload.get("receiver_capabilities") or {}
    if not isinstance(capabilities, dict):
        return False
    return source_format in _receiver_capability_formats(capabilities)


def _cast_delivery_policy_for_track(track: dict, ticket_payload: dict) -> str:
    requested = str(ticket_payload.get("delivery_policy") or CAST_AUTO_POLICY)
    requested = requested.strip().lower().replace("-", "_")
    if requested in {BALANCED_POLICY, DATA_SAVER_POLICY}:
        return requested
    if _receiver_supports_source_format(track, ticket_payload):
        return ORIGINAL_POLICY
    return BALANCED_POLICY


def _resolve_cast_playback(track: dict, ticket_payload: dict):
    delivery_policy = _cast_delivery_policy_for_track(track, ticket_payload)
    resolution = resolve_playback(track, delivery_policy, enqueue=True)
    if resolution is None:
        raise HTTPException(status_code=404, detail="Track not found")
    unsafe_source_fallback = (
        resolution.effective_policy == "original"
        and delivery_policy != ORIGINAL_POLICY
        and not _receiver_supports_source_format(track, ticket_payload)
    )
    if unsafe_source_fallback:
        raise HTTPException(
            status_code=425,
            detail="Cast playback variant is preparing",
            headers={"Retry-After": "5"},
        )
    return resolution


def _prepare_initial_cast_items(
    queue: list[dict], current_index: int, session: dict
) -> None:
    for index in dict.fromkeys((current_index, current_index + 1)):
        if index >= len(queue):
            continue
        track = _track_from_session_item(queue[index])
        if not track:
            continue
        try:
            _resolve_cast_playback(track, session)
        except HTTPException as exc:
            if exc.status_code != 425:
                raise


@router.post(
    "/api/me/cast/sessions",
    responses=_CAST_TICKET_RESPONSES,
    summary="Create an autonomous Cast playback session",
)
def post_cast_session(
    request: Request,
    body: CastSessionCreateRequest,
):
    user_id = _require_persisted_user_id(request)
    queue = _resolve_session_queue(body.items)
    appearance = body.appearance.model_dump(mode="json")
    _prepare_initial_cast_items(
        queue,
        body.current_index,
        {"receiver_capabilities": body.receiver_capabilities},
    )
    session = create_cast_session(
        user_id,
        target_device_id=body.target_device_id,
        protocol_version=body.protocol_version,
        receiver_capabilities=body.receiver_capabilities,
        appearance=appearance,
        queue=queue,
        current_index=body.current_index,
        current_time=body.current_time,
        repeat_mode=body.repeat_mode,
        shuffle=body.shuffle,
        revision=body.revision,
    )
    lease = session["lease"]
    payload = _serialise_cast_session(request, session, lease=lease)
    return {
        **payload,
        "lease": lease,
        "bootstrap_url": _absolute_cast_route_url(
            request,
            "get_cast_session",
            lease=lease,
        ),
        "receiver_application_id": os.environ.get(
            "CRATE_CAST_RECEIVER_APP_ID", "CC1AD845"
        ),
    }


@router.get(
    "/api/cast/sessions/{lease}",
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Bootstrap a scoped Cast playback session",
)
def get_cast_session(request: Request, lease: str):
    session = _session_by_lease_or_404(lease)
    return _serialise_cast_session(request, session, lease=lease)


@router.get(
    "/api/cast/sessions/{lease}/items/{item_id}",
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Resolve scoped Cast item metadata",
)
def get_cast_session_item(request: Request, lease: str, item_id: str):
    session, item, track = _session_item_and_track_or_404(lease, item_id)
    resolution = _resolve_cast_playback(track, session)
    duration = track.get("duration")
    return {
        **_serialise_session_item(request, item, lease=lease, session=session),
        "track_id": track.get("id"),
        "track_entity_uid": track.get("entity_uid"),
        "title": track.get("title") or item.get("title") or "",
        "artist": track.get("artist") or item.get("artist") or "",
        "album": track.get("album") or item.get("album") or "",
        "duration_ms": round(float(duration) * 1000) if duration else None,
        "content_type": resolution.media_type
        or media_type_for_path(resolution.file_path),
        "requested_policy": resolution.requested_policy,
        "effective_policy": resolution.effective_policy,
        "preparing": resolution.preparing,
        "transcoded": resolution.transcoded,
        "delivery": resolution.delivery,
        "source": resolution.source,
        "expires_at": session.get("expires_at"),
    }


@router.api_route(
    "/api/cast/sessions/{lease}/items/{item_id}/artwork",
    methods=["GET", "HEAD"],
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Get scoped artwork for one Cast session item",
)
def get_cast_session_item_artwork(lease: str, item_id: str):
    _session, _item, track = _session_item_and_track_or_404(lease, item_id)
    return api_cover(str(track.get("artist") or ""), str(track.get("album") or ""))


@router.api_route(
    "/api/cast/sessions/{lease}/items/{item_id}/stream",
    methods=["GET", "HEAD"],
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Stream one scoped Cast session item",
)
def get_cast_session_item_stream(lease: str, item_id: str):
    session, _item, track = _session_item_and_track_or_404(lease, item_id)
    resolution = _resolve_cast_playback(track, session)
    return _stream_resolved_file(
        None,
        resolution.file_path,
        media_type=resolution.media_type or media_type_for_path(resolution.file_path),
        extra_headers=_playback_headers(resolution),
        require_auth=False,
    )


def _etag_matches(request: Request, etag: str) -> bool:
    candidates = request.headers.get("if-none-match", "")
    expected = f'"{etag}"'
    for candidate in candidates.split(","):
        normalized = candidate.strip()
        if normalized == "*":
            return True
        if normalized.startswith("W/"):
            normalized = normalized[2:].strip()
        if normalized == expected:
            return True
    return False


def _spectrum_pending_response(*, queued: bool) -> JSONResponse:
    retry_after = 2
    status = "pending" if queued else "generating"
    return JSONResponse(
        status_code=202 if queued else 425,
        content={"status": status, "retry_after": retry_after},
        headers={"Retry-After": str(retry_after), "Cache-Control": "no-store"},
    )


@router.api_route(
    "/api/cast/sessions/{lease}/items/{item_id}/spectrum",
    methods=["GET", "HEAD"],
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Get or lazily prepare a scoped Cast spectrum artefact",
    name="get_cast_session_item_spectrum",
)
def get_cast_session_item_spectrum(request: Request, lease: str, item_id: str):
    _session, _item, track = _session_item_and_track_or_404(lease, item_id)
    track_id = track.get("id")
    source_path = resolve_source_path(track)
    if (
        not isinstance(track_id, int)
        or source_path is None
        or not source_path.is_file()
    ):
        raise HTTPException(status_code=404, detail="Spectrum source not found")

    fingerprint = source_fingerprint(track, source_path)
    artifact = ensure_cast_spectrum_request(track_id, fingerprint)
    if artifact["status"] == "ready":
        artifact_path = resolve_data_file(artifact.get("artifact_path"))
        if artifact_path is not None and artifact_path.is_file():
            etag = str(artifact["artifact_etag"])
            headers = {
                "Cache-Control": "private, max-age=31536000, immutable",
                "Content-Encoding": "gzip",
                "ETag": f'"{etag}"',
                "Vary": "Accept-Encoding",
            }
            if _etag_matches(request, etag):
                return Response(status_code=304, headers=headers)
            return FileResponse(
                artifact_path,
                media_type=CAST_SPECTRUM_MEDIA_TYPE,
                headers=headers,
            )
        mark_cast_spectrum_missing(track_id, fingerprint)
        artifact = {"status": "pending", "should_enqueue": True}

    if artifact["status"] == "failed":
        raise HTTPException(status_code=404, detail="Spectrum artefact unavailable")

    if artifact.get("should_enqueue"):
        task_id = create_task_dedup(
            "generate_cast_spectrum",
            {"track_id": track_id, "source_fingerprint": fingerprint},
            f"{track_id}:{fingerprint}",
        )
        return _spectrum_pending_response(queued=task_id is not None)
    return _spectrum_pending_response(queued=False)


@router.patch(
    "/api/me/cast/sessions/{session_id}",
    responses=merge_responses(
        _CAST_TICKET_RESPONSES,
        {409: error_response("The Cast queue revision is stale.")},
    ),
    summary="Edit an active Cast session queue",
)
def patch_cast_session(
    request: Request,
    session_id: str,
    body: CastSessionQueueUpdateRequest,
):
    user_id = _require_persisted_user_id(request)
    queue = _resolve_session_queue(body.items)
    session = update_cast_session_queue(
        user_id,
        session_id,
        expected_revision=body.expected_revision,
        mutation_id=body.mutation_id,
        queue=queue,
        repeat_mode=body.repeat_mode,
        shuffle=body.shuffle,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Cast session not found")
    payload = {
        **_serialise_cast_session(request, session),
        "mutation_status": session.get("mutation_status"),
    }
    if session.get("mutation_status") == "conflict":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "QUEUE_REVISION_CONFLICT",
                "queue": payload["queue"],
            },
        )
    return payload


@router.delete(
    "/api/me/cast/sessions/{session_id}",
    responses=_CAST_TICKET_RESPONSES,
    summary="Revoke a Cast playback session",
)
def delete_cast_session(request: Request, session_id: str):
    user_id = _require_persisted_user_id(request)
    if not revoke_cast_session(user_id, session_id):
        raise HTTPException(status_code=404, detail="Cast session not found")
    return {"ok": True}


@router.post(
    "/api/cast/sessions/{lease}/state",
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Publish receiver-authoritative Cast playback state",
)
def post_cast_session_state(
    request: Request,
    lease: str,
    body: CastReceiverStateRequest,
):
    session = update_cast_session_state(
        lease,
        state_seq=body.state_seq,
        current_index=body.current_index,
        current_time=body.current_time,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Cast session not found")
    return _serialise_cast_session(request, session, lease=lease)


@router.post(
    "/api/cast/sessions/{lease}/checkpoints",
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Record an idempotent receiver-owned play checkpoint",
)
def post_cast_session_checkpoint(
    lease: str,
    body: CastPlayCheckpointRequest,
):
    session = _session_by_lease_or_404(lease)
    item = _session_item_or_404(session, body.item_id)
    event_id = record_play_event(
        session["user_id"],
        client_event_id=(f"cast:{session['session_id']}:{body.client_event_id}"),
        track_id=item.get("track_id"),
        track_entity_uid=item.get("track_entity_uid"),
        track_path=item.get("track_path"),
        title=item.get("title") or "",
        artist=item.get("artist") or "",
        album=item.get("album") or "",
        started_at=body.started_at.isoformat(),
        ended_at=body.ended_at.isoformat(),
        played_seconds=body.played_seconds,
        track_duration_seconds=body.track_duration_seconds,
        completion_ratio=body.completion_ratio,
        was_skipped=body.was_skipped,
        was_completed=body.was_completed,
        play_source_type="cast",
        play_source_id=session["session_id"],
        play_source_name="Google Cast",
        device_type="cast_receiver",
        app_platform="cast_receiver",
    )
    return {"ok": True, "id": event_id}


@router.post(
    "/api/me/cast/tickets",
    response_model=CastTicketResponse,
    responses=_CAST_TICKET_RESPONSES,
    summary="Create a short-lived cast stream ticket",
)
def post_cast_ticket(request: Request, body: CastTicketRequest):
    user_id = _require_persisted_user_id(request)
    track = _track_from_request(body)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    delivery_policy = receiver_safe_delivery_policy(body.delivery)
    ticket_payload = create_cast_ticket(
        user_id,
        track_id=track.get("id"),
        track_entity_uid=str(track.get("entity_uid"))
        if track.get("entity_uid") is not None
        else None,
        track_path=track.get("path"),
        purpose=body.purpose,
        target_device_id=body.target_device_id,
        expires_in_seconds=body.expires_in_seconds,
        delivery_policy=delivery_policy,
        receiver_capabilities=body.receiver_capabilities,
    )

    ticket = ticket_payload["ticket"]
    return {
        "stream_url": _absolute_cast_url(request, "get_cast_stream", ticket),
        "metadata_url": _absolute_api_url(request, "get_cast_media", ticket),
        "expires_at": ticket_payload["expires_at"],
        "delivery_policy": ticket_payload["delivery_policy"],
    }


@router.get(
    "/api/cast/media/{ticket}",
    response_model=CastMediaResponse,
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Resolve receiver-safe media metadata for a cast ticket",
)
def get_cast_media(request: Request, ticket: str):
    ticket_payload = _valid_ticket_or_404(ticket)
    track = _track_for_ticket(ticket_payload)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    resolution = _resolve_cast_playback(track, ticket_payload)
    mark_cast_ticket_used(ticket)
    duration = track.get("duration")
    return {
        "stream_url": _absolute_cast_url(request, "get_cast_stream", ticket),
        "track_id": track.get("id"),
        "track_entity_uid": track.get("entity_uid"),
        "title": track.get("title") or "",
        "artist": track.get("artist") or "",
        "album": track.get("album") or "",
        "duration_ms": round(float(duration) * 1000) if duration else None,
        "content_type": resolution.media_type
        or media_type_for_path(resolution.file_path),
        "expires_at": ticket_payload["expires_at"],
        "purpose": ticket_payload["purpose"],
        "requested_policy": resolution.requested_policy,
        "effective_policy": resolution.effective_policy,
        "preparing": resolution.preparing,
        "transcoded": resolution.transcoded,
        "delivery": resolution.delivery,
        "source": resolution.source,
    }


@router.get(
    "/api/cast/stream/{ticket}",
    responses=_CAST_PUBLIC_RESPONSES,
    summary="Stream receiver-safe audio for a cast ticket",
)
def get_cast_stream(ticket: str):
    ticket_payload = _valid_ticket_or_404(ticket)
    track = _track_for_ticket(ticket_payload)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    resolution = _resolve_cast_playback(track, ticket_payload)
    mark_cast_ticket_used(ticket)
    return _stream_resolved_file(
        None,
        resolution.file_path,
        media_type=resolution.media_type or media_type_for_path(resolution.file_path),
        extra_headers=_playback_headers(resolution),
        require_auth=False,
    )
