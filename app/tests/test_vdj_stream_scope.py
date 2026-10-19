from __future__ import annotations

import pytest
from unittest.mock import patch


@pytest.fixture(autouse=True)
def _vdj_enabled(monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")


async def _catalog_only_user(_middleware, _request):
    return {
        "id": 1,
        "email": "dj@example.test",
        "role": "user",
        "auth_type": "access_token",
        "access_token_id": 42,
        "scopes": ["vdj.catalog.read"],
    }


async def _unauthenticated(_middleware, _request):
    return None


def test_vdj_playback_and_stream_require_media_scope(test_app) -> None:
    with patch(
        "crate.api.auth.AuthMiddleware.resolve_user",
        _catalog_only_user,
    ):
        playback = test_app.get(
            "/api/vdj/tracks/by-entity/00000000-0000-0000-0000-000000000001/playback"
        )
        stream = test_app.get(
            "/api/vdj/tracks/by-entity/00000000-0000-0000-0000-000000000001/stream"
        )

    assert playback.status_code == 403
    assert stream.status_code == 403
    assert "vdj.media.read" in playback.json()["detail"]


def test_vdj_media_routes_require_authentication(test_app) -> None:
    with patch(
        "crate.api.auth.AuthMiddleware.resolve_user",
        _unauthenticated,
    ):
        response = test_app.get(
            "/api/vdj/tracks/by-entity/00000000-0000-0000-0000-000000000001/stream"
        )

    assert response.status_code == 401
