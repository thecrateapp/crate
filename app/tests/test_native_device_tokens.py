"""AA2: native device tokens (scope device.native) minted from a session."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from starlette.requests import Request

from crate.api.auth import AuthMiddleware

# test_app and other fixtures patch resolve_user; keep the real one for the
# end-to-end tests below.
_REAL_RESOLVE_USER = AuthMiddleware.resolve_user

_TRACK_UID = "0b5d2c8e-6f1a-4d3b-9c7e-2a1f4e8d6b90"
_DEVICE_ID = "android-1f4e8d6b90"

_DEVICE_TOKEN = {
    "id": 31,
    "user_id": 42,
    "email": "listener@example.com",
    "role": "user",
    "username": "listener",
    "name": "Listener",
    "token_type": "native_device",
    "session_id": "session-1",
    "device_id": _DEVICE_ID,
    "scopes": ["device.native"],
}


def _request(method: str, path: str, token: str = "crv_device") -> Request:
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


def _resolve(method: str, path: str, *, session_user=None):
    middleware = AuthMiddleware(lambda scope, receive, send: None)
    with (
        patch(
            "crate.db.repositories.access_tokens.resolve_access_token",
            return_value=dict(_DEVICE_TOKEN),
        ),
        patch.object(
            middleware,
            "_resolve_session_user",
            return_value={"id": 42} if session_user is None else session_user,
        ) as session_check,
    ):
        resolved = asyncio.run(middleware.resolve_user(_request(method, path)))
    return resolved, session_check


_ALLOWED = [
    ("GET", "/api/auth/me"),
    ("GET", "/api/capabilities"),
    ("GET", "/api/me/device/browse/root"),
    ("GET", "/api/me/device/browse/playlist:7"),
    ("GET", "/api/me/device/search"),
    ("POST", "/api/me/device/queue"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/stream"),
    ("HEAD", f"/api/tracks/by-entity/{_TRACK_UID}/stream"),
    ("GET", "/api/catalog/tracks/global-track-1/stream"),
    ("GET", "/api/tracks/7/stream"),
    ("GET", "/api/stream/Artist/Album/01 Song.flac"),
    ("GET", "/api/playback/variants/variant-1/stream"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/playback"),
    ("GET", "/api/tracks/7/playback"),
    ("GET", "/api/catalog/tracks/global-track-1/playback"),
    ("GET", "/api/albums/7/cover"),
    ("GET", f"/api/albums/by-entity/{_TRACK_UID}/cover"),
    ("GET", "/api/catalog/albums/global-album-1/cover"),
    ("GET", "/api/artists/7/photo"),
    ("GET", "/api/artists/7/background"),
    ("HEAD", f"/api/artists/by-entity/{_TRACK_UID}/photo"),
    ("GET", "/api/catalog/artists/global-artist-1/background"),
    ("POST", "/api/me/play-events"),
    ("POST", "/api/playback/transition-plans"),
    ("POST", "/api/playback/continuation"),
    ("POST", "/api/me/cast/tickets"),
]

_DENIED = [
    # Token and session management.
    ("POST", "/api/auth/device-tokens"),
    ("GET", "/api/auth/device-tokens"),
    ("DELETE", "/api/auth/device-tokens/1"),
    ("POST", "/api/auth/access-tokens"),
    ("POST", "/api/playback/continuation-token"),
    ("POST", "/api/auth/media-access"),
    ("POST", "/api/auth/logout"),
    ("DELETE", "/api/auth/sessions/s-1"),
    # Settings, profile and preferences writes.
    ("PUT", "/api/auth/profile"),
    ("PUT", "/api/settings/worker"),
    ("PUT", "/api/me/scrobble/preferences"),
    ("POST", "/api/me/likes"),
    # Library writes and admin.
    ("PUT", "/api/albums/7/tags"),
    ("POST", "/api/albums/7/fetch-cover"),
    ("GET", "/api/admin/auth/users"),
    ("GET", "/api/admin/ops-stream"),
    # Reads outside the device surface.
    ("GET", "/api/me"),
    ("GET", "/api/me/likes"),
    ("GET", "/api/search"),
    ("GET", "/api/me/play-events"),
    ("POST", "/api/me/device/browse/root"),
    ("POST", "/api/me/device/search"),
    ("POST", "/api/me/device/queue/extra"),
    ("PUT", "/api/me/device/queue"),
    ("DELETE", "/api/me/device/queue"),
    ("GET", "/api/me/device"),
    ("GET", "/api/me/device/../likes"),
    ("GET", "/api/me/device/./browse"),
    ("GET", f"/api/vdj/tracks/by-entity/{_TRACK_UID}/stream"),
    ("PUT", f"/api/tracks/by-entity/{_TRACK_UID}/stream"),
    ("GET", f"/api/tracks/by-entity/{_TRACK_UID}/mix-profile"),
    ("GET", "/api/albums/7/cover/extra"),
    ("GET", "/api/tracks/7/download"),
    ("GET", "/api/users/7/avatar"),
]


@pytest.mark.parametrize(("method", "path"), _ALLOWED)
def test_device_token_resolves_on_its_allowlist(method, path):
    resolved, session_check = _resolve(method, path)

    assert resolved["auth_type"] == "access_token"
    assert resolved["token_type"] == "native_device"
    assert resolved["scopes"] == ["device.native"]
    session_check.assert_called_once_with(42, "session-1")


@pytest.mark.parametrize(("method", "path"), _DENIED)
def test_device_token_does_not_resolve_outside_its_allowlist(method, path):
    resolved, _ = _resolve(method, path)

    assert resolved is None


@pytest.mark.parametrize(("method", "path"), _DENIED)
def test_middleware_refuses_device_token_outside_its_allowlist_with_403(method, path):
    reached: list[dict] = []
    sent: list[dict] = []

    async def app(scope, receive, send):
        reached.append(scope)

    async def send(message):
        sent.append(message)

    middleware = AuthMiddleware(app)
    with (
        patch(
            "crate.db.repositories.access_tokens.resolve_access_token",
            return_value=dict(_DEVICE_TOKEN),
        ),
        patch.object(AuthMiddleware, "_resolve_session_user", return_value={"id": 42}),
    ):
        asyncio.run(middleware(_request(method, path).scope, None, send))

    assert reached == []
    assert sent[0]["status"] == 403


def test_middleware_still_drops_other_access_tokens_to_anonymous():
    seen: dict = {}

    async def app(scope, receive, send):
        seen["user"] = scope["state"]["user"]

    async def vdj_user(_self, _request):
        return {"id": 42, "auth_type": "access_token", "token_type": "virtualdj"}

    middleware = AuthMiddleware(app)
    with patch.object(AuthMiddleware, "resolve_user", vdj_user):
        asyncio.run(middleware(_request("PUT", "/api/auth/profile").scope, None, None))

    assert seen["user"] is None


def test_device_token_dies_with_its_session():
    resolved, _ = _resolve("GET", "/api/auth/me", session_user={})

    assert resolved is None


def _device_user_request(path: str = "/api/tracks/7/playback") -> Request:
    request = _request("GET", path)
    request.state.user = {
        "id": 42,
        "auth_type": "access_token",
        "token_type": "native_device",
        "scopes": ["device.native"],
    }
    return request


def test_device_token_passes_handler_scope_checks_with_vdj_disabled(monkeypatch):
    from crate.api import auth

    monkeypatch.setenv("CRATE_VDJ_ENABLED", "false")
    request = _device_user_request()

    for guard in (
        auth._require_stream_access,
        auth._require_transition_plan_access,
        lambda r: auth._require_vdj_scope_or_native_device(r, "vdj.media.read"),
        lambda r: auth._require_vdj_scope_or_native_device(r, "vdj.play_events.write"),
    ):
        assert guard(request)["id"] == 42


def test_device_token_without_its_scope_is_refused():
    from crate.api import auth

    request = _device_user_request()
    request.state.user["scopes"] = []

    with pytest.raises(HTTPException) as exc:
        auth._require_stream_access(request)

    assert exc.value.status_code == 403
    assert "device.native" in exc.value.detail


def test_vdj_scope_checks_are_unchanged_for_virtualdj_tokens(monkeypatch):
    from crate.api import auth

    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")
    request = _request("GET", "/api/tracks/7/playback")
    request.state.user = {
        "id": 42,
        "auth_type": "access_token",
        "token_type": "virtualdj",
        "scopes": ["vdj.catalog.read"],
    }

    with pytest.raises(HTTPException) as exc:
        auth._require_vdj_scope_or_native_device(request, "vdj.media.read")

    assert exc.value.status_code == 403
    assert "vdj.media.read" in exc.value.detail


def test_continuation_endpoint_still_requires_a_continuation_token():
    from crate.api import auth

    with pytest.raises(HTTPException) as exc:
        auth._require_continuation_token(_device_user_request())

    assert exc.value.status_code == 403


# ── Migration 170 ─────────────────────────────────────────────────────────


class _Recorder:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(" ".join(statement.split()))


def test_v170_migration_adds_device_id_and_one_active_token_per_device(monkeypatch):
    migration = import_module("crate.db.migrations.versions.170_native_device_tokens")
    schema = import_module("crate.db.schema_sections.native_device_tokens_v170")
    migration_recorder = _Recorder()
    schema_recorder = _Recorder()
    monkeypatch.setattr(migration, "op", migration_recorder)

    migration.upgrade()
    schema.create_native_device_tokens_v170_schema(schema_recorder)

    assert migration.revision == "170"
    assert migration.down_revision == "169"
    assert migration_recorder.statements == schema_recorder.statements
    assert migration_recorder.statements == [
        "ALTER TABLE user_access_tokens ADD COLUMN IF NOT EXISTS device_id TEXT",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_access_tokens_native_device "
        "ON user_access_tokens(session_id, device_id) "
        "WHERE token_type = 'native_device' AND revoked_at IS NULL",
    ]


def test_v170_downgrade_removes_device_tokens_index_and_column(monkeypatch):
    migration = import_module("crate.db.migrations.versions.170_native_device_tokens")
    recorder = _Recorder()
    monkeypatch.setattr(migration, "op", recorder)

    migration.downgrade()

    assert recorder.statements == [
        "DROP INDEX IF EXISTS uq_user_access_tokens_native_device",
        "DELETE FROM user_access_tokens WHERE token_type = 'native_device'",
        "ALTER TABLE user_access_tokens DROP COLUMN IF EXISTS device_id",
    ]


def test_v170_migration_downgrades_and_reapplies(pg_db):
    from alembic import command
    from alembic.config import Config

    from crate.db.tx import read_scope

    app_dir = Path(__file__).resolve().parents[1]
    config = Config(str(app_dir / "alembic.ini"))
    config.set_main_option("script_location", str(app_dir / "crate/db/migrations"))

    def _has_device_id() -> bool:
        with read_scope() as session:
            return bool(
                session.execute(
                    text(
                        """
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'user_access_tokens'
                          AND column_name = 'device_id'
                        """
                    )
                ).scalar_one_or_none()
            )

    try:
        command.downgrade(config, "169")
        assert not _has_device_id()
        command.upgrade(config, "170")
        assert _has_device_id()
    finally:
        command.upgrade(config, "head")


# ── Repository (PostgreSQL) ───────────────────────────────────────────────


def _session_for(user_id: int, *, days: int = 30) -> tuple[str, datetime]:
    from crate.db.repositories.auth_sessions import create_session

    session_id = f"session-{uuid.uuid4()}"
    expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).replace(
        microsecond=0
    )
    create_session(session_id, user_id, expires_at)
    return session_id, expires_at


def _user(email: str) -> dict:
    from crate.db.repositories.auth_user_accounts import create_user

    return create_user(email, password_hash=None)


def test_issue_device_token_expires_with_its_session(pg_db):
    from crate.db.repositories.access_tokens import (
        issue_native_device_token,
        resolve_access_token,
    )

    user = _user("device-expiry@test.com")
    session_id, expires_at = _session_for(user["id"], days=12)

    issued = issue_native_device_token(
        user_id=user["id"],
        session_id=session_id,
        device_id=_DEVICE_ID,
        label="  Android:   Pixel 8 ",
    )

    assert issued["token"].startswith("crv_")
    assert issued["token_type"] == "native_device"
    assert issued["scopes"] == ["device.native"]
    assert issued["session_id"] == session_id
    assert issued["device_id"] == _DEVICE_ID
    assert issued["name"] == "Android: Pixel 8"
    assert issued["expires_at"] == expires_at
    resolved = resolve_access_token(issued["token"])
    assert resolved["token_type"] == "native_device"
    assert resolved["session_id"] == session_id


def test_minting_again_replaces_only_the_same_session_and_device(pg_db):
    from crate.db.repositories.access_tokens import (
        issue_native_device_token,
        list_native_device_tokens,
        resolve_access_token,
    )

    user = _user("device-replace@test.com")
    session_id, _ = _session_for(user["id"])
    other_session_id, _ = _session_for(user["id"])

    def _mint(session: str, device: str) -> dict:
        return issue_native_device_token(
            user_id=user["id"], session_id=session, device_id=device, label="Phone"
        )

    first = _mint(session_id, _DEVICE_ID)
    tablet = _mint(session_id, "android-tablet-0001")
    elsewhere = _mint(other_session_id, _DEVICE_ID)
    second = _mint(session_id, _DEVICE_ID)

    assert resolve_access_token(first["token"]) is None
    for live in (second, tablet, elsewhere):
        assert resolve_access_token(live["token"]) is not None
    listed = list_native_device_tokens(user["id"])
    assert sorted(item["id"] for item in listed) == sorted(
        [second["id"], tablet["id"], elsewhere["id"]]
    )


@pytest.mark.parametrize(
    ("device_id", "label"),
    [
        ("short", "Phone"),
        ("x" * 129, "Phone"),
        ("android/../1234", "Phone"),
        ("android 12345", "Phone"),
        (_DEVICE_ID, "   "),
        (_DEVICE_ID, "x" * 81),
    ],
)
def test_issue_device_token_validates_device_id_and_label(pg_db, device_id, label):
    from crate.db.repositories.access_tokens import issue_native_device_token

    user = _user(f"device-validate-{uuid.uuid4().hex[:8]}@test.com")
    session_id, _ = _session_for(user["id"])

    with pytest.raises(ValueError):
        issue_native_device_token(
            user_id=user["id"], session_id=session_id, device_id=device_id, label=label
        )


def test_issue_device_token_requires_an_active_session_of_the_user(pg_db):
    from crate.db.repositories.access_tokens import issue_native_device_token
    from crate.db.repositories.auth_sessions import revoke_session

    owner = _user("device-owner@test.com")
    stranger = _user("device-stranger@test.com")
    session_id, _ = _session_for(owner["id"])
    revoked_id, _ = _session_for(owner["id"])
    revoke_session(revoked_id)

    for user_id, sid in (
        (stranger["id"], session_id),
        (owner["id"], revoked_id),
        (owner["id"], "missing-session"),
    ):
        with pytest.raises(LookupError):
            issue_native_device_token(
                user_id=user_id, session_id=sid, device_id=_DEVICE_ID, label="Phone"
            )


def test_list_device_tokens_is_scoped_to_the_user_and_live_sessions(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        issue_native_device_token,
        issue_playback_continuation_token,
        list_native_device_tokens,
        revoke_native_device_token,
    )
    from crate.db.repositories.auth_sessions import revoke_session

    user = _user("device-list@test.com")
    stranger = _user("device-list-stranger@test.com")
    live_session, _ = _session_for(user["id"])
    dead_session, _ = _session_for(user["id"])
    stranger_session, _ = _session_for(stranger["id"])

    live = issue_native_device_token(
        user_id=user["id"], session_id=live_session, device_id=_DEVICE_ID, label="A"
    )
    revoked = issue_native_device_token(
        user_id=user["id"],
        session_id=live_session,
        device_id="android-revoked-01",
        label="B",
    )
    issue_native_device_token(
        user_id=user["id"], session_id=dead_session, device_id=_DEVICE_ID, label="C"
    )
    issue_native_device_token(
        user_id=stranger["id"],
        session_id=stranger_session,
        device_id=_DEVICE_ID,
        label="D",
    )
    create_access_token(user_id=user["id"], name="VDJ", scopes=["vdj.catalog.read"])
    issue_playback_continuation_token(user_id=user["id"], session_id=live_session)
    assert revoke_native_device_token(user["id"], revoked["id"]) is True
    revoke_session(dead_session)

    listed = list_native_device_tokens(user["id"])

    assert [item["id"] for item in listed] == [live["id"]]
    assert set(listed[0]) == {
        "id",
        "device_id",
        "label",
        "created_at",
        "last_used_at",
        "expires_at",
        "session_id",
    }


def test_revoke_device_token_only_touches_the_owners_device_tokens(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        issue_native_device_token,
        resolve_access_token,
        revoke_native_device_token,
    )

    owner = _user("device-revoke@test.com")
    stranger = _user("device-revoke-stranger@test.com")
    session_id, _ = _session_for(owner["id"])
    token = issue_native_device_token(
        user_id=owner["id"], session_id=session_id, device_id=_DEVICE_ID, label="A"
    )
    vdj = create_access_token(
        user_id=owner["id"], name="VDJ", scopes=["vdj.catalog.read"]
    )

    assert revoke_native_device_token(stranger["id"], token["id"]) is False
    assert revoke_native_device_token(owner["id"], vdj["id"]) is False
    assert resolve_access_token(token["token"]) is not None
    assert revoke_native_device_token(owner["id"], token["id"]) is True
    assert revoke_native_device_token(owner["id"], token["id"]) is False
    assert resolve_access_token(token["token"]) is None
    assert resolve_access_token(vdj["token"]) is not None


# ── HTTP end to end (PostgreSQL, real middleware) ─────────────────────────


@pytest.fixture
def client(pg_db, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from crate.api import auth_cache

    del pg_db
    monkeypatch.setattr(AuthMiddleware, "resolve_user", _REAL_RESOLVE_USER)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task",
        lambda task_type, task_id: None,
    )
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "false")
    # Cloned test databases reuse ids; never serve a cached row from another test.
    auth_cache._session_cache.clear()
    auth_cache._user_cache.clear()
    config = {"library_path": str(tmp_path), "audio_extensions": [], "exclude_dirs": []}
    with (
        patch("crate.api._deps.load_config", return_value=config),
        patch("crate.api.cache_events.broadcast_invalidation"),
    ):
        from crate.api import create_app

        with TestClient(create_app()) as test_client:
            yield test_client


def _signed_in(email: str) -> tuple[dict, str, dict]:
    from crate.auth import create_jwt

    user = _user(email)
    session_id, _ = _session_for(user["id"])
    token = create_jwt(user["id"], email, "user", session_id=session_id)
    return user, session_id, {"Authorization": f"Bearer {token}"}


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _mint(client, headers: dict, device_id: str = _DEVICE_ID):
    return client.post(
        "/api/auth/device-tokens",
        json={"device_id": device_id, "label": "Android: Pixel 8"},
        headers=headers,
    )


def _play_event() -> dict:
    started = datetime.now(timezone.utc) - timedelta(minutes=4)
    return {
        "client_event_id": f"car-{uuid.uuid4()}",
        "title": "Song",
        "artist": "Band",
        "album": "Record",
        "started_at": started.isoformat(),
        "ended_at": (started + timedelta(minutes=3)).isoformat(),
        "played_seconds": 180,
        "track_duration_seconds": 181,
        "was_completed": True,
        "device_type": "car",
        "app_platform": "android",
    }


def test_session_mints_lists_and_revokes_device_tokens(client):
    user, session_id, headers = _signed_in("device-http@test.com")

    response = _mint(client, headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == {
        "id",
        "token",
        "device_id",
        "label",
        "created_at",
        "expires_at",
    }
    assert body["token"].startswith("crv_")
    assert body["device_id"] == _DEVICE_ID
    assert body["label"] == "Android: Pixel 8"

    listed = client.get("/api/auth/device-tokens", headers=headers)
    assert listed.status_code == 200
    assert listed.json() == [
        {
            "id": body["id"],
            "device_id": _DEVICE_ID,
            "label": "Android: Pixel 8",
            "created_at": body["created_at"],
            "last_used_at": None,
            "expires_at": body["expires_at"],
            "current_session": True,
        }
    ]
    assert body["token"] not in listed.text

    deleted = client.delete(f"/api/auth/device-tokens/{body['id']}", headers=headers)
    assert deleted.status_code == 204
    assert client.get("/api/auth/device-tokens", headers=headers).json() == []
    assert client.get("/api/auth/me", headers=_bearer(body["token"])).status_code == 401


def test_device_token_list_marks_other_sessions_and_hides_other_users(client):
    from crate.auth import create_jwt

    user, _, headers = _signed_in("device-sessions@test.com")
    other_session_id, _ = _session_for(user["id"])
    other_headers = _bearer(
        create_jwt(user["id"], user["email"], "user", session_id=other_session_id)
    )
    _, _, stranger_headers = _signed_in("device-sessions-stranger@test.com")
    mine = _mint(client, headers).json()
    elsewhere = _mint(client, other_headers).json()
    stranger = _mint(client, stranger_headers).json()

    listed = client.get("/api/auth/device-tokens", headers=headers).json()

    assert {item["id"]: item["current_session"] for item in listed} == {
        mine["id"]: True,
        elsewhere["id"]: False,
    }
    response = client.delete(
        f"/api/auth/device-tokens/{stranger['id']}", headers=headers
    )
    assert response.status_code == 404
    assert (
        client.get("/api/auth/me", headers=_bearer(stranger["token"])).status_code
        == 200
    )


def test_minting_twice_for_one_device_replaces_the_token(client):
    _, _, headers = _signed_in("device-http-replace@test.com")
    first = _mint(client, headers).json()
    second = _mint(client, headers).json()

    assert client.get("/api/auth/me", headers=_bearer(first["token"])).status_code == (
        401
    )
    assert client.get("/api/auth/me", headers=_bearer(second["token"])).status_code == (
        200
    )
    listed = client.get("/api/auth/device-tokens", headers=headers).json()
    assert [item["id"] for item in listed] == [second["id"]]


def test_device_token_management_refuses_every_access_token(client):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        issue_playback_continuation_token,
    )

    user, session_id, headers = _signed_in("device-http-refuse@test.com")
    device = _mint(client, headers).json()["token"]
    vdj = create_access_token(
        user_id=user["id"], name="VDJ", scopes=["vdj.catalog.read"]
    )["token"]
    continuation = issue_playback_continuation_token(
        user_id=user["id"], session_id=session_id
    )["token"]

    for token in (device, vdj, continuation):
        for method, path in (
            ("POST", "/api/auth/device-tokens"),
            ("GET", "/api/auth/device-tokens"),
            ("DELETE", "/api/auth/device-tokens/1"),
        ):
            response = client.request(
                method,
                path,
                json={"device_id": "android-other-01", "label": "X"}
                if method == "POST"
                else None,
                headers=_bearer(token),
            )
            assert response.status_code == 403, (token[:8], method, path)


def test_device_token_management_requires_authentication(client):
    response = client.post(
        "/api/auth/device-tokens",
        json={"device_id": _DEVICE_ID, "label": "Phone"},
    )
    assert response.status_code == 401


def test_device_token_rejects_an_invalid_body(client):
    _, _, headers = _signed_in("device-http-invalid@test.com")

    for payload in (
        {"device_id": "short", "label": "Phone"},
        {"device_id": "bad/device/id", "label": "Phone"},
        {"device_id": _DEVICE_ID, "label": "   "},
        {"device_id": _DEVICE_ID, "label": "x" * 81},
    ):
        response = client.post("/api/auth/device-tokens", json=payload, headers=headers)
        assert response.status_code == 422, payload


def test_device_token_reaches_its_allowlisted_routes(client):
    user, _, headers = _signed_in("device-http-allowed@test.com")
    device = _bearer(_mint(client, headers).json()["token"])

    me = client.get("/api/auth/me", headers=device)
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]
    assert me.json()["auth_type"] == "access_token"
    assert me.json()["scopes"] == ["device.native"]

    assert client.get("/api/capabilities", headers=device).status_code == 200
    # 404 proves the stream and playback guards accepted the token.
    for path in (
        f"/api/tracks/by-entity/{uuid.uuid4()}/stream",
        f"/api/tracks/by-entity/{uuid.uuid4()}/playback",
        "/api/tracks/999999/stream",
    ):
        response = client.get(path, headers=device)
        assert response.status_code == 404, path
        assert response.json()["detail"] == "Track not found"

    played = client.post("/api/me/play-events", json=_play_event(), headers=device)
    assert played.status_code == 200, played.text
    from crate.db.tx import read_scope

    with read_scope() as session:
        owner = session.execute(
            text("SELECT user_id FROM user_play_events WHERE id = :id"),
            {"id": played.json()["id"]},
        ).scalar_one()
    assert owner == user["id"]

    cast = client.post(
        "/api/me/cast/tickets", json={"track_id": 999999}, headers=device
    )
    assert cast.status_code == 404


def test_device_token_is_refused_outside_its_allowlist(client):
    _, _, headers = _signed_in("device-http-denied@test.com")
    device = _bearer(_mint(client, headers).json()["token"])

    for method, path, payload in (
        ("PUT", "/api/auth/profile", {"name": "Hijacked"}),
        ("PUT", "/api/me/scrobble/preferences", {"enabled": True}),
        ("PUT", "/api/settings/worker", {}),
        ("GET", "/api/admin/auth/users", None),
        ("PUT", "/api/albums/1/tags", {"artist": "X"}),
        (
            "POST",
            "/api/auth/access-tokens",
            {"name": "x", "scopes": ["vdj.media.read"]},
        ),
        ("POST", "/api/playback/continuation-token", None),
        ("GET", "/api/me/likes", None),
    ):
        response = client.request(method, path, json=payload, headers=device)
        assert response.status_code == 403, (method, path, response.text)
        assert response.json()["detail"] == (
            "This device token cannot be used on this route"
        )


def test_device_token_dies_with_logout(client):
    _, _, headers = _signed_in("device-http-logout@test.com")
    device = _bearer(_mint(client, headers).json()["token"])
    assert client.get("/api/auth/me", headers=device).status_code == 200

    assert client.post("/api/auth/logout", headers=headers).status_code == 200

    assert client.get("/api/auth/me", headers=device).status_code == 401
    assert (
        client.get(f"/api/tracks/by-entity/{uuid.uuid4()}/stream", headers=device)
    ).status_code == 401


def test_device_token_dies_when_its_session_is_revoked(client):
    from crate.auth import create_jwt

    user, session_id, headers = _signed_in("device-http-revoke@test.com")
    device = _bearer(_mint(client, headers).json()["token"])
    other_session_id, _ = _session_for(user["id"])
    other_headers = _bearer(
        create_jwt(user["id"], user["email"], "user", session_id=other_session_id)
    )

    revoked = client.delete(f"/api/auth/sessions/{session_id}", headers=other_headers)

    assert revoked.status_code == 200, revoked.text
    assert client.get("/api/auth/me", headers=device).status_code == 401


def test_device_token_dies_when_its_session_expires(client):
    from crate.api.auth_cache import invalidate_session
    from crate.db.tx import transaction_scope

    _, session_id, headers = _signed_in("device-http-expire@test.com")
    device = _bearer(_mint(client, headers).json()["token"])
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE sessions SET expires_at = now() - interval '1 minute'"
                " WHERE id = :id"
            ),
            {"id": session_id},
        )
    invalidate_session(session_id)

    assert client.get("/api/auth/me", headers=device).status_code == 401


def test_device_token_dies_when_another_session_revokes_all_others(client):
    from crate.auth import create_jwt

    user, _, headers = _signed_in("device-http-revoke-all@test.com")
    device = _bearer(_mint(client, headers).json()["token"])
    other_session_id, _ = _session_for(user["id"])
    other_headers = _bearer(
        create_jwt(user["id"], user["email"], "user", session_id=other_session_id)
    )
    assert client.get("/api/auth/me", headers=device).status_code == 200

    response = client.post("/api/auth/sessions/revoke-all", headers=other_headers)

    assert response.status_code == 200, response.text
    assert response.json()["revoked"] == 1
    assert client.get("/api/auth/me", headers=device).status_code == 401
    assert client.get("/api/auth/me", headers=other_headers).status_code == 200
