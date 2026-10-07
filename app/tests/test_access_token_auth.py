from __future__ import annotations

import asyncio
from unittest.mock import patch

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
