"""The API fixture must not leak its mocked authentication after teardown."""

import asyncio

import pytest
from starlette.requests import Request

from crate.api.auth import AuthMiddleware


_REAL_RESOLVE_USER = AuthMiddleware.resolve_user


@pytest.fixture(autouse=True)
def check_restored():
    yield
    assert AuthMiddleware.resolve_user is _REAL_RESOLVE_USER


@pytest.fixture(autouse=True)
def ensure_early_monkeypatch(check_restored, monkeypatch):
    yield


def test_api_authentication_patch_is_restored_with_an_early_monkeypatch(
    test_app, monkeypatch
):
    middleware = AuthMiddleware(lambda scope, receive, send: None)
    request = Request(
        {"type": "http", "method": "GET", "path": "/api/me", "headers": []}
    )
    user = asyncio.run(middleware.resolve_user(request))
    assert user is not None
    assert user["id"] == 1
    assert user["email"] == "test@test.com"

    async def no_user(self, request):
        return None

    monkeypatch.setattr(AuthMiddleware, "resolve_user", no_user)

    assert asyncio.run(middleware.resolve_user(request)) is None
