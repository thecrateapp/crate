from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from crate.api.auth import _require_auth
from crate.media_access import (
    MediaAccessUnavailable,
    MediaAudience,
    issue_media_access_ticket,
    normalize_media_access_path,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class MediaAccessTicketResponse(BaseModel):
    audience: MediaAudience
    path: str
    ticket: str
    expires_at: datetime


class MediaAccessTargetRequest(BaseModel):
    audience: MediaAudience
    path: str = Field(min_length=1, max_length=2048)


class MediaAccessTicketsRequest(BaseModel):
    targets: list[MediaAccessTargetRequest] = Field(min_length=1, max_length=128)


class MediaAccessTicketsResponse(BaseModel):
    tickets: list[MediaAccessTicketResponse]


@router.post("/media-access", response_model=MediaAccessTicketsResponse)
def create_media_access_tickets(
    request: Request,
    payload: MediaAccessTicketsRequest,
) -> MediaAccessTicketsResponse:
    user = _require_auth(request)
    user_id = user.get("id")
    is_access_token = user.get("auth_type") == "access_token"
    session_id = user.get("session_id") if not is_access_token else None
    access_token_id = user.get("access_token_id") if is_access_token else None
    if not isinstance(user_id, int):
        raise HTTPException(
            status_code=401, detail="A valid media identity is required"
        )
    if is_access_token:
        if not isinstance(access_token_id, int):
            raise HTTPException(
                status_code=401, detail="A valid access token is required"
            )
        if "vdj.media.read" not in set(user.get("scopes") or []):
            raise HTTPException(
                status_code=403,
                detail="Access token is missing required scope: vdj.media.read",
            )
        if any(target.audience != "stream" for target in payload.targets):
            raise HTTPException(
                status_code=403,
                detail="VirtualDJ access tokens can only issue stream tickets",
            )
    elif not isinstance(session_id, str):
        raise HTTPException(
            status_code=401,
            detail="A persisted user session is required",
        )

    try:
        normalized_targets: list[tuple[MediaAudience, str]] = []
        seen: set[tuple[MediaAudience, str]] = set()
        for target in payload.targets:
            normalized_path = normalize_media_access_path(target.path)
            key = (target.audience, normalized_path)
            if key not in seen:
                normalized_targets.append(key)
                seen.add(key)
        issued = [
            issue_media_access_ticket(
                user_id=user_id,
                session_id=session_id,
                access_token_id=access_token_id,
                audience=audience,
                path=path,
            )
            for audience, path in normalized_targets
        ]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except MediaAccessUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail="Media access tickets are temporarily unavailable",
        ) from exc

    return MediaAccessTicketsResponse(
        tickets=[
            MediaAccessTicketResponse(
                audience=item.audience,
                path=item.path,
                ticket=item.ticket,
                expires_at=item.expires_at,
            )
            for item in issued
        ]
    )
