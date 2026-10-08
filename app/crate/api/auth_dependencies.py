"""Shared request authentication helpers for API routers."""

from fastapi import HTTPException, Request


def require_auth(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user
