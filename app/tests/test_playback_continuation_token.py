from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import uuid

import pytest
from starlette.requests import Request


def _request(method: str, path: str, token: str = "crv_continuation") -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [(b"authorization", f"Bearer {token}".encode())],
            "query_string": b"",
            "scheme": "https",
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 443),
        }
    )


_CONTINUATION_TOKEN = {
    "id": 21,
    "user_id": 42,
    "email": "listener@example.com",
    "role": "user",
    "username": "listener",
    "name": "Listener",
    "token_type": "playback_continuation",
    "session_id": "session-1",
    "scopes": ["playback.continuation"],
}


def _resolve(middleware, method: str, path: str, *, session_user):
    with (
        patch(
            "crate.db.repositories.access_tokens.resolve_access_token",
            return_value=dict(_CONTINUATION_TOKEN),
        ),
        patch.object(
            middleware, "_resolve_session_user", return_value=session_user
        ) as session_check,
    ):
        resolved = asyncio.run(middleware.resolve_user(_request(method, path)))
    return resolved, session_check


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/playback/transition-plans"),
        ("GET", f"/api/tracks/by-entity/{uuid.uuid4()}/stream"),
        ("HEAD", f"/api/tracks/by-entity/{uuid.uuid4()}/stream"),
        ("GET", "/api/catalog/tracks/global-track-1/stream"),
    ],
)
def test_continuation_token_resolves_on_its_routes(method, path):
    from crate.api.auth import AuthMiddleware

    middleware = AuthMiddleware(lambda scope, receive, send: None)

    resolved, session_check = _resolve(
        middleware,
        method,
        path,
        session_user={"id": 42},
    )

    assert resolved["auth_type"] == "access_token"
    assert resolved["token_type"] == "playback_continuation"
    assert resolved["scopes"] == ["playback.continuation"]
    session_check.assert_called_once_with(42, "session-1")


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/search"),
        ("POST", "/api/auth/media-access"),
        ("POST", "/api/me/play-events"),
        ("GET", "/api/me"),
        ("POST", "/api/playback/continuation-token"),
        ("PUT", f"/api/tracks/by-entity/{uuid.uuid4()}/stream"),
        ("GET", f"/api/tracks/by-entity/{uuid.uuid4()}/playback"),
        ("GET", f"/api/vdj/tracks/by-entity/{uuid.uuid4()}/stream"),
    ],
)
def test_continuation_token_is_rejected_outside_its_route(method, path):
    from crate.api.auth import AuthMiddleware

    middleware = AuthMiddleware(lambda scope, receive, send: None)

    resolved, _ = _resolve(middleware, method, path, session_user={"id": 42})

    assert resolved is None


def test_continuation_token_dies_with_its_session():
    from crate.api.auth import AuthMiddleware

    middleware = AuthMiddleware(lambda scope, receive, send: None)

    resolved, _ = _resolve(
        middleware,
        "POST",
        "/api/playback/transition-plans",
        session_user=None,
    )

    assert resolved is None


def _continuation_user(scopes=("playback.continuation",)):
    async def _resolve_user(self, request):
        del self, request
        return {
            "id": 42,
            "email": "listener@example.com",
            "role": "user",
            "auth_type": "access_token",
            "access_token_id": 21,
            "token_type": "playback_continuation",
            "session_id": None,
            "scopes": list(scopes),
        }

    return _resolve_user


def _session_user(session_id: str | None):
    async def _resolve_user(self, request):
        del self, request
        return {
            "id": 42,
            "email": "listener@example.com",
            "role": "user",
            "session_id": session_id,
        }

    return _resolve_user


def _plan_request() -> dict:
    return {
        "plannerVersion": "smart-mix-v2",
        "edges": [
            {
                "outgoingTrackEntityUid": str(uuid.uuid4()),
                "incomingTrackEntityUid": str(uuid.uuid4()),
                "context": {
                    "source": "playlist",
                    "automatic": True,
                    "offline": False,
                    "preferredDurationMs": 12000,
                    "userCueProfile": "default",
                    "allowBeatmatch": False,
                    "allowTempoAdjustment": False,
                },
            }
        ],
    }


def test_transition_plans_accept_a_continuation_token_without_vdj(
    test_app, monkeypatch
):
    from crate.api import smart_mix

    monkeypatch.setattr(
        smart_mix,
        "get_track_mix_profiles_by_entity_uids",
        lambda entity_uids, **_kwargs: [None for _ in entity_uids],
    )
    monkeypatch.setattr(smart_mix, "get_smart_mix_plan_caches", lambda _keys: {})
    monkeypatch.setattr(smart_mix, "set_smart_mix_plan_caches", lambda _plans: None)

    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _continuation_user()),
        patch("crate.api.auth.vdj_enabled", return_value=False),
    ):
        response = test_app.post("/api/playback/transition-plans", json=_plan_request())

    assert response.status_code == 200
    assert len(response.json()["plans"]) == 1


def test_transition_plans_reject_a_continuation_token_without_its_scope(test_app):
    with patch(
        "crate.api.auth.AuthMiddleware.resolve_user",
        _continuation_user(scopes=()),
    ):
        response = test_app.post("/api/playback/transition-plans", json=_plan_request())

    assert response.status_code == 403


def test_stream_accepts_a_continuation_token_without_vdj(test_app, monkeypatch):
    from fastapi.responses import Response

    from crate.api import browse_media

    monkeypatch.setattr(
        browse_media,
        "get_track_delivery_row_by_entity_uid",
        lambda entity_uid: {"entity_uid": entity_uid},
    )
    monkeypatch.setattr(
        browse_media,
        "_stream_track",
        lambda request, track, delivery: Response(b"audio", media_type="audio/flac"),
    )

    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _continuation_user()),
        patch("crate.api.auth.vdj_enabled", return_value=False),
    ):
        response = test_app.get(f"/api/tracks/by-entity/{uuid.uuid4()}/stream")

    assert response.status_code == 200
    assert response.content == b"audio"


def test_stream_rejects_a_continuation_token_without_its_scope(test_app):
    with patch(
        "crate.api.auth.AuthMiddleware.resolve_user",
        _continuation_user(scopes=()),
    ):
        response = test_app.get(f"/api/tracks/by-entity/{uuid.uuid4()}/stream")

    assert response.status_code == 403


def test_continuation_token_is_issued_for_the_current_session(test_app, monkeypatch):
    from crate.api import smart_mix

    expires_at = datetime(2026, 10, 17, 2, 0, tzinfo=timezone.utc)
    issued = []

    def _issue(**kwargs):
        issued.append(kwargs)
        return {"token": "crv_issued", "expires_at": expires_at}

    monkeypatch.setattr(smart_mix, "issue_playback_continuation_token", _issue)

    with patch(
        "crate.api.auth.AuthMiddleware.resolve_user", _session_user("session-7")
    ):
        response = test_app.post("/api/playback/continuation-token")

    assert response.status_code == 200
    assert response.json() == {
        "token": "crv_issued",
        "expiresAt": "2026-10-17T02:00:00Z",
    }
    assert issued == [{"user_id": 42, "session_id": "session-7", "descriptor": None}]


@pytest.mark.parametrize(
    "resolve_user",
    [_session_user(None), _continuation_user()],
    ids=["no-session", "access-token"],
)
def test_continuation_token_requires_an_interactive_session(
    test_app, monkeypatch, resolve_user
):
    from crate.api import smart_mix

    monkeypatch.setattr(
        smart_mix,
        "issue_playback_continuation_token",
        lambda **_kwargs: pytest.fail("token must not be issued"),
    )

    with patch("crate.api.auth.AuthMiddleware.resolve_user", resolve_user):
        response = test_app.post("/api/playback/continuation-token")

    assert response.status_code in {401, 403}


def _create_session(user_id: int) -> str:
    from crate.db.repositories.auth_sessions import create_session

    session_id = f"session-{uuid.uuid4()}"
    create_session(
        session_id,
        user_id,
        datetime.now(timezone.utc) + timedelta(days=7),
    )
    return session_id


def test_issuing_a_continuation_token_replaces_the_previous_one(pg_db):
    from crate.db.repositories.access_tokens import (
        get_access_token_by_secret,
        issue_playback_continuation_token,
    )

    user = pg_db.create_user("continuation-owner@test.com")
    session_id = _create_session(user["id"])

    first = issue_playback_continuation_token(user_id=user["id"], session_id=session_id)
    second = issue_playback_continuation_token(
        user_id=user["id"], session_id=session_id
    )

    assert get_access_token_by_secret(first["token"]) is None
    current = get_access_token_by_secret(second["token"])
    assert current["token_type"] == "playback_continuation"
    assert current["session_id"] == session_id
    assert current["scopes"] == ["playback.continuation"]
    lifetime = second["expires_at"] - second["created_at"]
    assert lifetime == timedelta(hours=12)


def test_continuation_tokens_stay_out_of_the_settings_token_list(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        get_access_token,
        issue_playback_continuation_token,
        list_access_tokens,
        rotate_access_token,
    )

    user = pg_db.create_user("continuation-settings@test.com")
    session_id = _create_session(user["id"])
    vdj = create_access_token(
        user_id=user["id"], name="VirtualDJ", scopes=["vdj.catalog.read"]
    )
    continuation = issue_playback_continuation_token(
        user_id=user["id"], session_id=session_id
    )

    assert [token["id"] for token in list_access_tokens(user["id"])] == [vdj["id"]]
    assert get_access_token(user["id"], continuation["id"]) is None
    with pytest.raises(LookupError):
        rotate_access_token(user["id"], continuation["id"])


def test_deleting_the_session_deletes_its_continuation_token(pg_db):
    from crate.db.repositories.access_tokens import (
        get_access_token_by_secret,
        issue_playback_continuation_token,
    )
    from crate.db.repositories.auth_sessions import delete_session

    user = pg_db.create_user("continuation-cascade@test.com")
    session_id = _create_session(user["id"])
    issued = issue_playback_continuation_token(
        user_id=user["id"], session_id=session_id
    )

    delete_session(session_id)

    assert get_access_token_by_secret(issued["token"]) is None


def test_v115_schema_binds_tokens_to_sessions_with_cascade():
    from crate.db.schema_sections.access_tokens_v115 import (
        create_playback_continuation_token_v115_schema,
    )

    statements: list[str] = []

    class _Recorder:
        def execute(self, statement: str) -> None:
            statements.append(" ".join(statement.split()))

    create_playback_continuation_token_v115_schema(_Recorder())

    assert (
        "ADD COLUMN IF NOT EXISTS session_id TEXT REFERENCES sessions(id) "
        "ON DELETE CASCADE"
    ) in statements[0]
    assert "WHERE session_id IS NOT NULL" in statements[1]
