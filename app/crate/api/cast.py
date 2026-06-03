from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from crate.api.auth import _require_auth
from crate.api.browse_media import _playback_headers, _stream_resolved_file
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.cast import (
    CastMediaResponse,
    CastTicketRequest,
    CastTicketResponse,
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
from crate.streaming.policy import (
    BALANCED_POLICY,
    DATA_SAVER_POLICY,
    ORIGINAL_POLICY,
    infer_format,
)
from crate.streaming.service import media_type_for_path, resolve_playback

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


def _absolute_cast_url(request: Request, route_name: str, ticket: str) -> str:
    return str(request.url_for(route_name, ticket=ticket))


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
        "metadata_url": _absolute_cast_url(request, "get_cast_media", ticket),
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
