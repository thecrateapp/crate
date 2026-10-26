"""Human cookie provenance and CSRF checks for integration administration."""

import os
from urllib.parse import urlsplit

from fastapi import HTTPException, Request

from crate.auth import verify_jwt
from crate.db.repositories.agent_human_sessions import get_agent_human_session


def _origins() -> set[str]:
    domain = os.environ.get("DOMAIN", "localhost")
    candidates = {
        f"https://admin.{domain}",
        f"https://api.{domain}",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8585",
        "http://127.0.0.1:8585",
    }
    candidates.update(os.environ.get("CRATE_MCP_ADMIN_ORIGINS", "").split(","))
    candidates.update(
        (
            os.environ.get("CRATE_MCP_OAUTH_ISSUER", ""),
            os.environ.get("CRATE_PUBLIC_API_BASE_URL", ""),
        )
    )
    return {
        f"{value.scheme}://{value.netloc}"
        for raw in candidates
        if raw
        and (value := urlsplit(raw.strip())).scheme in {"http", "https"}
        and value.netloc
        and not value.username
        and not value.password
    }


def require_agent_admin_session(
    request: Request, capability: str | None = None
) -> dict:
    if (
        request.headers.get("authorization")
        or any(key.lower().startswith("remote-") for key in request.headers)
        or any(key in request.query_params for key in ("token", "media_ticket"))
    ):
        raise HTTPException(401, "A human cookie session is required")
    token = request.cookies.get("crate_session")
    payload = verify_jwt(token) if token else None
    if not payload or not payload.get("sid"):
        raise HTTPException(401, "A human cookie session is required")
    try:
        user_id = int(payload["user_id"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(401, "Invalid human session") from None
    user = get_agent_human_session(user_id, str(payload["sid"]))
    if user is None:
        raise HTTPException(401, "Human session has expired or been revoked")
    if capability and capability not in user["capabilities"]:
        raise HTTPException(403, "Permission denied")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin not in _origins():
            raise HTTPException(403, "A configured same-origin request is required")
    return user


__all__ = ["require_agent_admin_session"]
