from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, status

from crate.api.auth import _require_auth
from crate.api.schemas.access_tokens import (
    AccessTokenCreateRequest,
    AccessTokenListResponse,
    AccessTokenResponse,
)
from crate.db.repositories.access_tokens import (
    create_access_token,
    list_access_tokens,
    revoke_access_token,
    rotate_access_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _require_interactive_user(request: Request) -> dict:
    user = _require_auth(request)
    if user.get("auth_type") == "access_token":
        raise HTTPException(
            status_code=403,
            detail="A browser or native user session is required for token management",
        )
    if not isinstance(user.get("id"), int):
        raise HTTPException(status_code=401, detail="A persisted user is required")
    return user


@router.post(
    "/access-tokens",
    response_model=AccessTokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a scoped external client access token",
)
def create_token(
    request: Request,
    payload: AccessTokenCreateRequest,
) -> AccessTokenResponse:
    user = _require_interactive_user(request)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days)
        if payload.expires_in_days is not None
        else None
    )
    try:
        created = create_access_token(
            user_id=user["id"],
            name=payload.name,
            scopes=payload.scopes,
            expires_at=expires_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return AccessTokenResponse.model_validate(created)


@router.get(
    "/access-tokens",
    response_model=list[AccessTokenListResponse],
    summary="List external client access tokens",
)
def get_tokens(request: Request) -> list[AccessTokenListResponse]:
    user = _require_interactive_user(request)
    return [
        AccessTokenListResponse.model_validate(item)
        for item in list_access_tokens(user["id"])
    ]


@router.post(
    "/access-tokens/{token_id}/rotate",
    response_model=AccessTokenResponse,
    summary="Rotate an external client access token",
)
def rotate_token(request: Request, token_id: int) -> AccessTokenResponse:
    user = _require_interactive_user(request)
    try:
        rotated = rotate_access_token(user["id"], token_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Access token not found") from exc
    return AccessTokenResponse.model_validate(rotated)


@router.delete(
    "/access-tokens/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke an external client access token",
)
def revoke_token(request: Request, token_id: int) -> None:
    user = _require_interactive_user(request)
    if not revoke_access_token(user["id"], token_id):
        raise HTTPException(status_code=404, detail="Access token not found")
