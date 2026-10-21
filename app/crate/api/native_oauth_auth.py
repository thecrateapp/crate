"""Shared native OAuth validation and session checks."""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from crate.api.auth_dependencies import require_auth
from crate.db.repositories.auth import get_session
from crate.db.repositories.auth_shared import coerce_datetime

NATIVE_OAUTH_CALLBACK_URL = "cratemusic://oauth/callback"
NATIVE_OAUTH_LINK_CALLBACK_URL = "cratemusic://oauth/link-callback"
NATIVE_OAUTH_DEBUG_CALLBACK_URL = "cratemusic-dbg://oauth/callback"
NATIVE_OAUTH_CALLBACK_URLS = frozenset(
    {NATIVE_OAUTH_CALLBACK_URL, NATIVE_OAUTH_DEBUG_CALLBACK_URL}
)
NATIVE_OAUTH_SCHEMES = ("cratemusic://", "cratemusic-dbg://")
NATIVE_OAUTH_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
NATIVE_OAUTH_STATE_RE = re.compile(r"^[A-Za-z0-9_-]{16,256}$")
NATIVE_OAUTH_VERIFIER_RE = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")


def native_oauth_exchange_enabled() -> bool:
    raw = os.environ.get("NATIVE_OAUTH_EXCHANGE_ENABLED")
    if raw is None:
        return True
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_native_listen_app_id(app_id: str | None) -> bool:
    normalized = (app_id or "").strip().lower()
    return normalized in {
        "listen-android",
        "listen-ios",
        "listen-native",
        "listen-tauri",
    }


def is_native_callback_url(value: str | None) -> bool:
    return (value or "").startswith(NATIVE_OAUTH_SCHEMES)


def validate_native_oauth_start(
    *,
    app_id: str | None,
    mode: str,
    return_to: str | None,
    challenge: str | None,
    state: str | None,
) -> bool:
    native_callback = is_native_callback_url(return_to)
    if native_callback and return_to not in NATIVE_OAUTH_CALLBACK_URLS:
        raise HTTPException(status_code=400, detail="Invalid native OAuth callback")
    requested = challenge is not None or state is not None
    if not requested:
        if native_callback or is_native_listen_app_id(app_id):
            raise HTTPException(status_code=426, detail="Native app upgrade required")
        return False
    if not native_oauth_exchange_enabled():
        raise HTTPException(
            status_code=503,
            detail="Native OAuth exchange is not enabled",
        )
    if mode != "login" or not is_native_listen_app_id(app_id):
        raise HTTPException(status_code=400, detail="Invalid native OAuth client")
    if return_to not in NATIVE_OAUTH_CALLBACK_URLS:
        raise HTTPException(status_code=400, detail="Invalid native OAuth callback")
    if not challenge or not state:
        raise HTTPException(status_code=400, detail="Incomplete native OAuth binding")
    if not NATIVE_OAUTH_CHALLENGE_RE.fullmatch(challenge):
        raise HTTPException(
            status_code=400, detail="Invalid native OAuth code challenge"
        )
    if not NATIVE_OAUTH_STATE_RE.fullmatch(state):
        raise HTTPException(status_code=400, detail="Invalid native OAuth state")
    return True


def validate_native_oauth_link_start(
    *,
    app_id: str | None,
    return_to: str | None,
    challenge: str | None,
    state: str | None,
) -> None:
    if (app_id or "").strip().lower() != "listen-tauri":
        raise HTTPException(status_code=400, detail="Invalid native OAuth link client")
    if not native_oauth_exchange_enabled():
        raise HTTPException(
            status_code=503,
            detail="Native OAuth exchange is not enabled",
        )
    if return_to != NATIVE_OAUTH_LINK_CALLBACK_URL:
        raise HTTPException(
            status_code=400,
            detail="Invalid native OAuth link callback",
        )
    if not challenge or not NATIVE_OAUTH_CHALLENGE_RE.fullmatch(challenge):
        raise HTTPException(
            status_code=400,
            detail="Invalid native OAuth link code challenge",
        )
    if not state or not NATIVE_OAUTH_STATE_RE.fullmatch(state):
        raise HTTPException(status_code=400, detail="Invalid native OAuth link state")


def native_oauth_link_session_is_valid(user_id: int, session_id: str) -> bool:
    session = get_session(session_id)
    if not session or int(session.get("user_id") or 0) != user_id:
        return False
    if session.get("revoked_at") is not None:
        return False
    expires_at = coerce_datetime(session.get("expires_at"))
    if expires_at is None:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > datetime.now(timezone.utc)


def require_native_oauth_link_auth(request: Request) -> tuple[dict, str]:
    if not request.headers.get("authorization", "").startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer authentication required")
    if (request.headers.get("x-crate-app") or "").strip().lower() != "listen-tauri":
        raise HTTPException(status_code=400, detail="Invalid native OAuth link client")
    user = require_auth(request)
    session_id = str(user.get("session_id") or "")
    if not session_id or not native_oauth_link_session_is_valid(
        int(user["id"]), session_id
    ):
        raise HTTPException(status_code=401, detail="Native OAuth link session expired")
    return user, session_id
