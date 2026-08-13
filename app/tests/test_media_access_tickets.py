from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.websockets import WebSocket

from crate import media_access


class _FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    def set(self, key: str, value: str, *, ex: int) -> bool:
        self.values[key] = value
        self.ttls[key] = ex
        return True

    def get(self, key: str) -> str | None:
        return self.values.get(key)


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    redis = _FakeRedis()
    monkeypatch.setattr(media_access, "_redis_client", lambda: redis)
    return redis


def test_media_ticket_is_hashed_bounded_and_audience_scoped(
    fake_redis: _FakeRedis,
) -> None:
    issued = media_access.issue_media_access_ticket(
        user_id=7,
        session_id="session-1",
        audience="artwork",
        path="/api/albums/12/cover",
    )

    digest = hashlib.sha256(issued.ticket.encode()).hexdigest()
    key = f"media-access:v1:{digest}"
    assert key in fake_redis.values
    assert issued.ticket not in fake_redis.values
    assert fake_redis.ttls[key] == 60
    assert json.loads(fake_redis.values[key])["session_id"] == "session-1"
    assert json.loads(fake_redis.values[key])["path"] == "/api/albums/12/cover"

    validated = media_access.validate_media_access_ticket(
        issued.ticket,
        audience="artwork",
        request_path="/api/albums/12/cover",
    )
    assert validated is not None
    assert validated.user_id == 7
    assert validated.session_id == "session-1"
    assert (
        media_access.validate_media_access_ticket(
            issued.ticket,
            audience="stream",
            request_path="/api/tracks/12/stream",
        )
        is None
    )
    assert (
        media_access.validate_media_access_ticket(
            issued.ticket,
            audience="artwork",
            request_path="/api/me",
        )
        is None
    )


def test_media_ticket_cannot_be_reused_for_another_path_in_the_same_audience(
    fake_redis: _FakeRedis,
) -> None:
    issued = media_access.issue_media_access_ticket(
        user_id=7,
        session_id="session-1",
        audience="artwork",
        path="/api/albums/12/cover",
    )

    assert (
        media_access.validate_media_access_ticket(
            issued.ticket,
            audience="artwork",
            request_path="/api/artists/99/photo",
        )
        is None
    )


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/albums/12/cover", "artwork"),
        ("/api/auth/users/7/avatar", "artwork"),
        ("/api/artists/12/photo", "artwork"),
        ("/api/artists/12/background", "artwork"),
        ("/api/artists/12/hero?composition=mobile", "artwork"),
        ("/api/me/contributions/4/export", "artwork"),
        ("/api/tracks/12/stream", "stream"),
        ("/api/stream/Band/Album/Song.flac", "stream"),
        ("/api/federation/remote/streams/abc", "stream"),
        ("/api/events", "sse"),
        ("/api/cache/events", "sse"),
        ("/api/me/connect/events", "sse"),
        ("/api/me/home/discovery-stream", "sse"),
        ("/api/jam/rooms/room-1/ws", "ws"),
        ("/api/me", None),
    ],
)
def test_media_path_audience_is_fail_closed(path: str, expected: str | None) -> None:
    assert media_access.media_audience_for_path(path) == expected


def test_sensitive_url_redaction_covers_legacy_and_scoped_credentials() -> None:
    redacted = media_access.redact_media_credentials(
        "https://api.example/api/cover?token=secret&media_ticket=short&size=256"
    )
    assert "secret" not in redacted
    assert "short" not in redacted
    assert "size=256" in redacted


def test_ticket_store_fails_closed_as_a_typed_service_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = MagicMock()
    redis.set.side_effect = ConnectionError("redis unavailable")
    monkeypatch.setattr(media_access, "_redis_client", lambda: redis)

    with pytest.raises(media_access.MediaAccessUnavailable):
        media_access.issue_media_access_ticket(
            user_id=7,
            session_id="session-1",
            audience="stream",
            path="/api/tracks/12/stream",
        )


def test_ticket_validation_fails_closed_when_redis_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = MagicMock()
    redis.get.side_effect = ConnectionError("redis unavailable")
    monkeypatch.setattr(media_access, "_redis_client", lambda: redis)

    assert (
        media_access.validate_media_access_ticket(
            "opaque-ticket",
            audience="stream",
            request_path="/api/tracks/12/stream",
        )
        is None
    )


def test_ticket_endpoint_issues_requested_browser_media_paths(
    fake_redis: _FakeRedis,
) -> None:
    from crate.api.media_access import (
        MediaAccessTargetRequest,
        MediaAccessTicketsRequest,
        create_media_access_tickets,
    )

    request = MagicMock()
    request.state = SimpleNamespace(
        user={"id": 7, "session_id": "session-1", "role": "user"}
    )

    response = create_media_access_tickets(
        request,
        MediaAccessTicketsRequest(
            targets=[
                MediaAccessTargetRequest(
                    audience="artwork",
                    path="/api/albums/12/cover",
                ),
                MediaAccessTargetRequest(
                    audience="artwork",
                    path="/api/artists/12/hero?composition=mobile",
                ),
                MediaAccessTargetRequest(
                    audience="stream",
                    path="/api/tracks/12/stream",
                ),
            ]
        ),
    )

    assert [(item.audience, item.path) for item in response.tickets] == [
        ("artwork", "/api/albums/12/cover"),
        ("artwork", "/api/artists/12/hero"),
        ("stream", "/api/tracks/12/stream"),
    ]
    assert all(item.ticket for item in response.tickets)
    assert all(item.expires_at.tzinfo is not None for item in response.tickets)


def test_ticket_endpoint_issues_only_the_requested_exact_paths(
    fake_redis: _FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from crate.api import media_access as media_access_api

    monkeypatch.setattr(
        media_access_api,
        "_require_auth",
        lambda _request: {"id": 7, "session_id": "session-1", "role": "user"},
    )
    app = FastAPI()
    app.include_router(media_access_api.router)

    response = TestClient(app).post(
        "/api/auth/media-access",
        json={
            "targets": [
                {
                    "audience": "artwork",
                    "path": "/api/albums/12/cover?size=256",
                },
                {
                    "audience": "sse",
                    "path": "/api/events/task/task-1",
                },
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["tickets"], list)
    assert [(item["audience"], item["path"]) for item in payload["tickets"]] == [
        ("artwork", "/api/albums/12/cover"),
        ("sse", "/api/events/task/task-1"),
    ]


def test_auth_middleware_resolves_a_scoped_ticket_without_a_bearer(
    fake_redis: _FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from crate.api.auth import AuthMiddleware
    from crate.api import auth_cache

    monkeypatch.setattr(
        auth_cache,
        "get_cached_session",
        lambda session_id: {
            "id": session_id,
            "user_id": 7,
            "revoked_at": None,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        },
    )
    monkeypatch.setattr(
        auth_cache,
        "get_cached_user",
        lambda user_id: {
            "id": user_id,
            "email": "listener@example.test",
            "role": "user",
            "status": "active",
        },
    )
    issued = media_access.issue_media_access_ticket(
        user_id=7,
        session_id="session-1",
        audience="artwork",
        path="/api/albums/12/cover",
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "https",
            "server": ("api.example.test", 443),
            "client": ("127.0.0.1", 1234),
            "path": "/api/albums/12/cover",
            "query_string": f"media_ticket={issued.ticket}".encode(),
            "headers": [],
        }
    )

    user = __import__("asyncio").run(AuthMiddleware(MagicMock()).resolve_user(request))

    assert user is not None
    assert user["id"] == 7
    assert user["session_id"] == "session-1"


def test_auth_middleware_rejects_a_ticket_bound_to_another_sessions_user(
    fake_redis: _FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from crate.api import auth_cache
    from crate.api.auth import AuthMiddleware

    monkeypatch.setattr(
        auth_cache,
        "get_cached_session",
        lambda session_id: {
            "id": session_id,
            "user_id": 8,
            "revoked_at": None,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        },
    )
    monkeypatch.setattr(
        auth_cache,
        "get_cached_user",
        lambda user_id: {
            "id": user_id,
            "email": "listener@example.test",
            "role": "user",
            "status": "active",
        },
    )
    issued = media_access.issue_media_access_ticket(
        user_id=7,
        session_id="session-1",
        audience="artwork",
        path="/api/albums/12/cover",
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "https",
            "server": ("api.example.test", 443),
            "client": ("127.0.0.1", 1234),
            "path": "/api/albums/12/cover",
            "query_string": f"media_ticket={issued.ticket}".encode(),
            "headers": [],
        }
    )

    user = __import__("asyncio").run(AuthMiddleware(MagicMock()).resolve_user(request))

    assert user is None


def test_jam_websocket_accepts_a_ws_ticket_without_a_bearer(
    fake_redis: _FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from crate.api import jam

    monkeypatch.setattr(
        jam,
        "get_session",
        lambda session_id: {
            "id": session_id,
            "user_id": 7,
            "revoked_at": None,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        },
    )
    issued = media_access.issue_media_access_ticket(
        user_id=7,
        session_id="session-1",
        audience="ws",
        path="/api/jam/rooms/room-1/ws",
    )

    async def receive() -> dict:
        return {"type": "websocket.disconnect"}

    async def send(_message: dict) -> None:
        return None

    websocket = WebSocket(
        {
            "type": "websocket",
            "scheme": "wss",
            "server": ("api.example.test", 443),
            "client": ("127.0.0.1", 1234),
            "path": "/api/jam/rooms/room-1/ws",
            "query_string": f"media_ticket={issued.ticket}".encode(),
            "headers": [],
            "subprotocols": [],
        },
        receive,
        send,
    )

    payload = jam._auth_ws(websocket)

    assert payload["user_id"] == 7
    assert payload["sid"] == "session-1"


@pytest.mark.parametrize(
    "session",
    [
        {
            "id": "session-1",
            "user_id": 8,
            "revoked_at": None,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        {
            "id": "session-1",
            "user_id": 7,
            "revoked_at": None,
            "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
        },
    ],
    ids=["session-user-mismatch", "expired-session"],
)
def test_jam_websocket_rejects_a_ticket_without_an_active_matching_session(
    fake_redis: _FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
    session: dict,
) -> None:
    from crate.api import jam

    monkeypatch.setattr(jam, "get_session", lambda _session_id: session)
    issued = media_access.issue_media_access_ticket(
        user_id=7,
        session_id="session-1",
        audience="ws",
        path="/api/jam/rooms/room-1/ws",
    )

    async def receive() -> dict:
        return {"type": "websocket.disconnect"}

    async def send(_message: dict) -> None:
        return None

    websocket = WebSocket(
        {
            "type": "websocket",
            "scheme": "wss",
            "server": ("api.example.test", 443),
            "client": ("127.0.0.1", 1234),
            "path": "/api/jam/rooms/room-1/ws",
            "query_string": f"media_ticket={issued.ticket}".encode(),
            "headers": [],
            "subprotocols": [],
        },
        receive,
        send,
    )

    with pytest.raises(HTTPException) as exc_info:
        jam._auth_ws(websocket)

    assert exc_info.value.status_code == 401
