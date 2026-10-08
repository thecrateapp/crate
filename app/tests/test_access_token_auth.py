from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from starlette.requests import Request


def _request_with_bearer(token: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/search",
            "headers": [(b"authorization", f"Bearer {token}".encode())],
            "query_string": b"",
            "scheme": "https",
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 443),
        }
    )


def _request_with_path(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [(b"authorization", b"Bearer crv_test-token")],
            "query_string": b"",
            "scheme": "https",
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 443),
        }
    )


def test_bearer_access_token_resolves_to_scoped_user():
    from crate.api.auth import AuthMiddleware

    middleware = AuthMiddleware(lambda scope, receive, send: None)
    with patch(
        "crate.db.repositories.access_tokens.resolve_access_token",
        return_value={
            "id": 11,
            "user_id": 42,
            "email": "dj@example.com",
            "role": "user",
            "username": "dj",
            "name": "DJ",
            "scopes": ["vdj.catalog.read"],
        },
    ):
        resolved = asyncio.run(
            middleware.resolve_user(_request_with_bearer("crv_test-token"))
        )

    assert resolved["id"] == 42
    assert resolved["auth_type"] == "access_token"
    assert resolved["access_token_id"] == 11
    assert resolved["scopes"] == ["vdj.catalog.read"]


def test_non_vdj_bearer_tokens_still_use_jwt_resolution():
    from crate.api.auth import AuthMiddleware

    middleware = AuthMiddleware(lambda scope, receive, send: None)
    with (
        patch.object(middleware, "_resolve_token_user", return_value={"id": 42}) as jwt,
        patch("crate.db.repositories.access_tokens.resolve_access_token") as access,
    ):
        resolved = asyncio.run(
            middleware.resolve_user(_request_with_bearer("ey.jwt.token"))
        )

    assert resolved == {"id": 42}
    jwt.assert_called_once_with("ey.jwt.token")
    access.assert_not_called()


def test_access_token_is_not_accepted_on_unlisted_routes():
    from crate.api.auth import AuthMiddleware

    middleware = AuthMiddleware(lambda scope, receive, send: None)
    with patch(
        "crate.db.repositories.access_tokens.resolve_access_token",
        return_value={
            "id": 11,
            "user_id": 42,
            "email": "dj@example.com",
            "role": "user",
            "scopes": ["vdj.catalog.read"],
        },
    ):
        resolved = asyncio.run(middleware.resolve_user(_request_with_path("/api/me")))

    assert resolved is None


_TRACK_UID = "0b5d2c8e-6f1a-4d3b-9c7e-2a1f4e8d6b90"

_ALLOWED_ACCESS_TOKEN_REQUESTS = [
    ("GET", "/api/search"),
    ("GET", "/api/vdj/catalog/folders"),
    ("GET", "/api/vdj/catalog/folders/crate:playlists"),
    ("POST", "/api/auth/media-access"),
    ("POST", "/api/playback/transition-plans"),
    ("POST", "/api/me/play-events"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/mix-profile"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/compatible"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/playback"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/stream"),
    ("HEAD", f"/api/tracks/by-entity/{_TRACK_UID}/stream"),
    ("GET", f"/api/vdj/tracks/by-entity/{_TRACK_UID}/playback"),
    ("GET", f"/api/vdj/tracks/by-entity/{_TRACK_UID}/stream"),
    ("HEAD", f"/api/vdj/tracks/by-entity/{_TRACK_UID}/stream"),
]

_DENIED_ACCESS_TOKEN_REQUESTS = [
    ("GET", "/api/me"),
    ("GET", "/api/me/play-events"),
    ("DELETE", "/api/me/play-events"),
    ("POST", "/api/search"),
    ("GET", "/api/searchable"),
    ("GET", "/api/vdj/catalog/foldersx"),
    ("DELETE", "/api/vdj/catalog/folders/crate:playlists"),
    ("GET", "/api/auth/media-access"),
    ("GET", "/api/auth/media-access/extra"),
    ("PUT", f"/api/tracks/by-entity/{_TRACK_UID}/stream"),
    ("HEAD", f"/api/tracks/by-entity/{_TRACK_UID}/playback"),
    ("POST", f"/api/tracks/by-entity/{_TRACK_UID}/compatible"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/lyrics/stream"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/similar/compatible"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/mix-profile/extra"),
    ("GET", f"/api/vdj/tracks/by-entity/{_TRACK_UID}/download/stream"),
    ("GET", f"/api/vdj/tracks/by-entity/{_TRACK_UID}/mix-profile"),
]


def _request_with_method(method: str, path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [(b"authorization", b"Bearer crv_test-token")],
            "query_string": b"",
            "scheme": "https",
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 443),
        }
    )


def _resolve_with_access_token(method: str, path: str):
    from crate.api.auth import AuthMiddleware

    middleware = AuthMiddleware(lambda scope, receive, send: None)
    with patch(
        "crate.db.repositories.access_tokens.resolve_access_token",
        return_value={
            "id": 11,
            "user_id": 42,
            "email": "dj@example.com",
            "role": "user",
            "scopes": ["vdj.catalog.read"],
        },
    ):
        return asyncio.run(middleware.resolve_user(_request_with_method(method, path)))


@pytest.mark.parametrize(("method", "path"), _ALLOWED_ACCESS_TOKEN_REQUESTS)
def test_access_token_is_accepted_on_allowlisted_method_and_route(method, path):
    resolved = _resolve_with_access_token(method, path)

    assert resolved is not None
    assert resolved["auth_type"] == "access_token"


@pytest.mark.parametrize(("method", "path"), _DENIED_ACCESS_TOKEN_REQUESTS)
def test_access_token_is_denied_on_neighbouring_routes_and_methods(method, path):
    assert _resolve_with_access_token(method, path) is None


@pytest.mark.parametrize(("method", "path"), _DENIED_ACCESS_TOKEN_REQUESTS)
def test_middleware_drops_access_token_user_outside_the_allowlist(method, path):
    from crate.api.auth import AuthMiddleware

    seen: dict = {}

    async def app(scope, receive, send):
        seen["user"] = scope["state"]["user"]

    async def access_token_user(_self, _request):
        return {"id": 42, "auth_type": "access_token", "scopes": []}

    middleware = AuthMiddleware(app)
    scope = _request_with_method(method, path).scope
    with patch.object(AuthMiddleware, "resolve_user", access_token_user):
        asyncio.run(middleware(scope, None, None))

    assert seen["user"] is None
