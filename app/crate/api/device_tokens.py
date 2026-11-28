"""Native device credentials (Android Auto phase AA2).

A native device token lets the Android media service browse, stream, report
plays and request Cast tickets while the WebView is frozen. JS mints it from an
interactive session; it expires with that session and dies when the session is
revoked, logged out or expired. Its route allowlist lives in `auth.py`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.device_tokens import (
    DeviceTokenCreatedResponse,
    DeviceTokenCreateRequest,
    DeviceTokenResponse,
)
from crate.db.repositories.access_tokens import (
    ACCESS_TOKEN_PREFIX,
    issue_native_device_token,
    list_native_device_tokens,
    revoke_native_device_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

INTERACTIVE_SESSION_REQUIRED = "An interactive session is required"

_DEVICE_TOKEN_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {403: error_response(INTERACTIVE_SESSION_REQUIRED)},
)


def _require_interactive_session(request: Request) -> tuple[dict, str]:
    # The middleware drops VirtualDJ and continuation tokens outside their
    # allowlists, so look at the header too: any crv_ credential is refused
    # with 403 rather than treated as anonymous.
    if request.headers.get("Authorization", "").startswith(
        f"Bearer {ACCESS_TOKEN_PREFIX}"
    ):
        raise HTTPException(status_code=403, detail=INTERACTIVE_SESSION_REQUIRED)
    user = _require_auth(request)
    session_id = user.get("session_id")
    if user.get("auth_type") == "access_token" or not session_id:
        raise HTTPException(status_code=403, detail=INTERACTIVE_SESSION_REQUIRED)
    if not isinstance(user.get("id"), int):
        raise HTTPException(status_code=401, detail="A persisted user is required")
    return user, str(session_id)


@router.post(
    "/device-tokens",
    response_model=DeviceTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    responses=merge_responses(
        _DEVICE_TOKEN_RESPONSES,
        {422: error_response("Invalid device id or label")},
    ),
    summary="Mint the native device token of this session",
)
def create_device_token(
    request: Request,
    payload: DeviceTokenCreateRequest,
) -> DeviceTokenCreatedResponse:
    user, session_id = _require_interactive_session(request)
    try:
        issued = issue_native_device_token(
            user_id=user["id"],
            session_id=session_id,
            device_id=payload.device_id,
            label=payload.label,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(
            status_code=401, detail="The session is no longer active"
        ) from exc
    return DeviceTokenCreatedResponse(
        id=issued["id"],
        token=issued["token"],
        device_id=issued["device_id"],
        label=issued["name"],
        created_at=issued["created_at"],
        expires_at=issued["expires_at"],
    )


@router.get(
    "/device-tokens",
    response_model=list[DeviceTokenResponse],
    responses=_DEVICE_TOKEN_RESPONSES,
    summary="List the native device tokens of the current user",
)
def get_device_tokens(request: Request) -> list[DeviceTokenResponse]:
    user, session_id = _require_interactive_session(request)
    return [
        DeviceTokenResponse(
            id=item["id"],
            device_id=item["device_id"],
            label=item["label"],
            created_at=item["created_at"],
            last_used_at=item.get("last_used_at"),
            expires_at=item["expires_at"],
            current_session=item.get("session_id") == session_id,
        )
        for item in list_native_device_tokens(user["id"])
    ]


@router.delete(
    "/device-tokens/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=merge_responses(
        _DEVICE_TOKEN_RESPONSES,
        {404: error_response("Device token not found")},
    ),
    summary="Revoke a native device token",
)
def delete_device_token(request: Request, token_id: int) -> None:
    user, _ = _require_interactive_session(request)
    if not revoke_native_device_token(user["id"], token_id):
        raise HTTPException(status_code=404, detail="Device token not found")
