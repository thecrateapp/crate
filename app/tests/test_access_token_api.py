from __future__ import annotations

import pytest
from datetime import datetime, timezone
from unittest.mock import patch


@pytest.fixture(autouse=True)
def _vdj_enabled(monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")


def test_create_access_token_returns_secret_once(test_app):
    created_at = datetime.now(timezone.utc)
    with patch(
        "crate.api.access_tokens.create_access_token",
        return_value={
            "id": 7,
            "name": "VirtualDJ laptop",
            "token_type": "virtualdj",
            "token_prefix": "crv_12345678",
            "scopes": ["vdj.catalog.read"],
            "expires_at": None,
            "revoked_at": None,
            "created_at": created_at,
            "last_used_at": None,
            "token": "crv_secret-returned-once",
        },
    ) as create:
        response = test_app.post(
            "/api/auth/access-tokens",
            json={
                "name": "VirtualDJ laptop",
                "scopes": ["vdj.catalog.read"],
            },
        )

    assert response.status_code == 201
    assert response.json()["token"] == "crv_secret-returned-once"
    assert response.json()["token_prefix"] == "crv_12345678"
    assert create.call_args.kwargs["user_id"] == 1


def test_list_access_tokens_redacts_secret(test_app):
    with patch(
        "crate.api.access_tokens.list_access_tokens",
        return_value=[
            {
                "id": 7,
                "name": "VirtualDJ laptop",
                "token_type": "virtualdj",
                "token_prefix": "crv_12345678",
                "scopes": ["vdj.catalog.read"],
                "expires_at": None,
                "revoked_at": None,
                "created_at": datetime.now(timezone.utc),
                "last_used_at": None,
            }
        ],
    ):
        response = test_app.get("/api/auth/access-tokens")

    assert response.status_code == 200
    assert "token" not in response.json()[0]
    assert response.json()[0]["token_prefix"] == "crv_12345678"


def test_catalog_search_rejects_access_token_without_catalog_scope(test_app):
    async def resolve_user(_middleware, _request):
        return {
            "id": 1,
            "email": "test@test.com",
            "role": "user",
            "auth_type": "access_token",
            "scopes": ["vdj.media.read"],
        }

    with patch("crate.api.auth.AuthMiddleware.resolve_user", resolve_user):
        response = test_app.get("/api/search?q=artist")

    assert response.status_code == 403
    assert "vdj.catalog.read" in response.json()["detail"]
