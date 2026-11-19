"""Self-service account controls: personal data export and account deletion."""

from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse

from crate.api.auth import (
    _clear_cookies_for_context,
    _clear_failed_login,
    _delete_user_account,
    _ensure_admin_remains,
    _ensure_user_active,
    _enforce_login_rate_limit,
    _record_failed_login,
)
from crate.api.auth_dependencies import require_auth as _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.account import (
    AccountDeletionRequirementsResponse,
    DeleteAccountRequest,
    UserDataExportResponse,
    UserDataExportStatusResponse,
)
from crate.api.schemas.common import OkResponse
from crate.auth import verify_password
from crate.db.queries.user_data_export import (
    get_latest_user_data_export,
    get_user_data_export,
)
from crate.db.repositories.auth import get_session, get_user_by_id
from crate.db.repositories.user_data_exports import queue_user_data_export
from crate.download_cache import cached_download_artifact_path, download_cache_enabled
from crate.user_data_export import (
    USER_DATA_EXPORT_KIND,
    is_user_data_export_id,
    user_data_export_download_url,
)

router = APIRouter(prefix="/api/me", tags=["me"])

ACCOUNT_REAUTH_WINDOW_SECONDS = 600

_ACCOUNT_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {403: error_response("A signed-in session or re-authentication is required.")},
)


def _require_session_user(request: Request) -> dict:
    user = _require_auth(request)
    if user.get("auth_type") == "access_token" or not isinstance(user.get("id"), int):
        raise HTTPException(
            status_code=403, detail="Account changes require a signed-in session"
        )
    return user


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _export_payload(export: dict, *, now: datetime) -> dict:
    expires_at = _as_aware(export.get("expires_at"))
    downloadable = (
        export["status"] == "ready" and expires_at is not None and expires_at > now
    )
    status_value = (
        "expired"
        if export["status"] == "ready" and not downloadable
        else export["status"]
    )
    return {
        "id": export["id"],
        "status": status_value,
        "created_at": export["created_at"],
        "completed_at": export.get("completed_at"),
        "expires_at": expires_at,
        "filename": export.get("filename") if downloadable else None,
        "bytes": export.get("bytes") if downloadable else None,
        "download_url": (
            user_data_export_download_url(export["id"]) if downloadable else None
        ),
    }


def _recent_sign_in(user: dict, *, now: datetime) -> bool:
    session_id = user.get("session_id")
    if not session_id:
        return False
    session = get_session(str(session_id))
    if not session or int(session.get("user_id") or 0) != user["id"]:
        return False
    if session.get("revoked_at") is not None:
        return False
    authenticated_at = _as_aware(
        session.get("authenticated_at") or session.get("created_at")
    )
    if authenticated_at is None:
        return False
    return (now - authenticated_at).total_seconds() <= ACCOUNT_REAUTH_WINDOW_SECONDS


def _verify_reauthentication(
    request: Request, user: dict, db_user: dict, password: str | None
) -> None:
    password_hash = db_user.get("password_hash")
    if password_hash:
        email = str(db_user.get("email") or "")
        _enforce_login_rate_limit(email, request)
        if not password or not verify_password(password, str(password_hash)):
            _record_failed_login(email, request)
            raise HTTPException(status_code=403, detail="Password is incorrect")
        _clear_failed_login(email, request)
        return
    if not _recent_sign_in(user, now=datetime.now(timezone.utc)):
        raise HTTPException(
            status_code=403,
            detail="Sign in again to confirm this account deletion",
        )


@router.post(
    "/export",
    response_model=UserDataExportResponse,
    status_code=status.HTTP_202_ACCEPTED,
    responses=merge_responses(
        _ACCOUNT_RESPONSES,
        {503: error_response("The download cache is disabled.")},
    ),
    summary="Request an export of the current user's data",
)
def request_my_data_export(request: Request):
    user = _require_session_user(request)
    if not download_cache_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Data exports are unavailable",
        )
    export, _created = queue_user_data_export(user["id"])
    return _export_payload(export, now=datetime.now(timezone.utc))


@router.get(
    "/export",
    response_model=UserDataExportStatusResponse,
    responses=_ACCOUNT_RESPONSES,
    summary="Get the current user's latest data export",
)
def get_my_data_export(request: Request):
    user = _require_session_user(request)
    export = get_latest_user_data_export(user["id"])
    if export is None:
        return {"export": None}
    return {"export": _export_payload(export, now=datetime.now(timezone.utc))}


@router.get(
    "/export/{export_id}/download",
    responses=merge_responses(
        _ACCOUNT_RESPONSES,
        {
            200: {
                "description": "ZIP archive of the current user's data.",
                "content": {"application/zip": {}},
            },
            404: error_response("The export does not exist or has expired."),
        },
    ),
    summary="Download the current user's data export",
)
def download_my_data_export(request: Request, export_id: str):
    user = _require_session_user(request)
    if not is_user_data_export_id(export_id):
        raise HTTPException(status_code=404, detail="Export not found")
    export = get_user_data_export(export_id, user_id=user["id"])
    if export is None:
        raise HTTPException(status_code=404, detail="Export not found")
    payload = _export_payload(export, now=datetime.now(timezone.utc))
    if payload["download_url"] is None or not export.get("filename"):
        raise HTTPException(status_code=404, detail="Export not found")
    path = cached_download_artifact_path(
        USER_DATA_EXPORT_KIND, export["id"], str(export["filename"])
    )
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Export not found")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=str(export["filename"]),
        headers={"Cache-Control": "no-store"},
    )


@router.get(
    "/account/deletion",
    response_model=AccountDeletionRequirementsResponse,
    responses=_ACCOUNT_RESPONSES,
    summary="Describe how the current user confirms account deletion",
)
def get_my_account_deletion_requirements(request: Request):
    user = _require_session_user(request)
    db_user = get_user_by_id(user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "requires_password": bool(db_user.get("password_hash")),
        "recent_sign_in": _recent_sign_in(user, now=datetime.now(timezone.utc)),
        "recent_sign_in_window_seconds": ACCOUNT_REAUTH_WINDOW_SECONDS,
    }


@router.delete(
    "",
    response_model=OkResponse,
    responses=merge_responses(
        _ACCOUNT_RESPONSES,
        {
            409: error_response("The account is the last remaining owner or admin."),
            429: error_response("Too many failed password attempts."),
        },
    ),
    summary="Delete the current user's account",
)
def delete_my_account(
    request: Request,
    body: DeleteAccountRequest = Body(default_factory=DeleteAccountRequest),
) -> Response:
    user = _require_session_user(request)
    db_user = get_user_by_id(user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_user_active(db_user)
    _verify_reauthentication(request, user, db_user, body.password)
    _ensure_admin_remains(db_user, status_code=409)
    updated = _delete_user_account(
        db_user, db_user, source="self", reason="Deleted by the account owner"
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    response = JSONResponse(content={"ok": True})
    _clear_cookies_for_context(response, request)
    return response
