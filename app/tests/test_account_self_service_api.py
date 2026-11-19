"""M10: self-service data export and account deletion through the HTTP API."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from crate.auth import create_jwt, hash_password
from crate.db.repositories.access_tokens import (
    create_access_token,
    resolve_access_token,
)
from crate.db.repositories.auth_sessions import (
    create_session,
    list_sessions,
    touch_session,
)
from crate.db.repositories.auth_user_accounts import (
    create_user,
    get_user_by_email,
    get_user_by_id,
)
from crate.db.tx import transaction_scope
from crate.worker_handlers.user_data_export import _handle_export_user_data
from tests.conftest import PG_AVAILABLE

pg = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

PASSWORD = "Correct-Horse-9"


@pytest.fixture
def dispatched(monkeypatch):
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task",
        lambda task_type, task_id: calls.append((task_type, task_id)),
    )
    return calls


@pytest.fixture
def client(pg_db, tmp_path, monkeypatch, dispatched):
    from fastapi.testclient import TestClient

    del pg_db
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_DIR", str(tmp_path / "download-cache"))
    monkeypatch.setenv("CRATE_LOGIN_RATE_LIMIT_ENABLED", "0")
    config = {"library_path": str(tmp_path), "audio_extensions": [], "exclude_dirs": []}
    with patch("crate.api._deps.load_config", return_value=config):
        from crate.api import create_app

        with TestClient(create_app()) as test_client:
            yield test_client


def _password_user(client, email: str, *, role: str = "user") -> tuple[dict, dict]:
    user = create_user(email, password_hash=hash_password(PASSWORD), role=role)
    login = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return user, {"Authorization": f"Bearer {login.json()['token']}"}


def _oauth_user(email: str, *, signed_in_minutes_ago: int) -> tuple[dict, dict]:
    user = create_user(email, password_hash=None, google_id=f"google-{email}")
    session_id = f"oauth-{user['id']}"
    create_session(
        session_id, user["id"], datetime.now(timezone.utc) + timedelta(days=7)
    )
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE sessions SET authenticated_at = now() - make_interval(mins => :mins)"
                " WHERE id = :id"
            ),
            {"id": session_id, "mins": signed_in_minutes_ago},
        )
    token = create_jwt(user["id"], email, "user", session_id=session_id)
    return user, {"Authorization": f"Bearer {token}"}


@pg
def test_account_routes_require_authentication(client):
    assert client.delete("/api/me").status_code == 401
    assert client.post("/api/me/export").status_code == 401
    assert client.get("/api/me/export").status_code == 401
    assert client.get("/api/me/account/deletion").status_code == 401
    assert client.get(f"/api/me/export/{'a' * 32}/download").status_code == 401


@pg
def test_access_tokens_cannot_export_or_delete_accounts(client):
    user, _headers = _password_user(client, "token-holder@account.test")
    secret = create_access_token(
        user_id=user["id"], name="Decks", scopes=["vdj.catalog.read"]
    )["token"]
    headers = {"Authorization": f"Bearer {secret}"}

    assert client.post("/api/me/export", headers=headers).status_code in {401, 403}
    deleted = client.request(
        "DELETE", "/api/me", json={"password": PASSWORD}, headers=headers
    )
    assert deleted.status_code in {401, 403}
    assert get_user_by_id(user["id"])["status"] == "active"


@pg
def test_wrong_password_does_not_delete_the_account(client):
    user, headers = _password_user(client, "wrong-password@account.test")

    missing = client.request("DELETE", "/api/me", json={}, headers=headers)
    wrong = client.request(
        "DELETE", "/api/me", json={"password": "nope"}, headers=headers
    )

    assert missing.status_code == 403
    assert wrong.status_code == 403
    assert get_user_by_id(user["id"])["status"] == "active"


@pg
def test_password_user_deletes_own_account_and_loses_every_credential(
    client, dispatched
):
    user, headers = _password_user(client, "leaving@account.test")
    _other, other_headers = _password_user(client, "staying@account.test")
    token = create_access_token(
        user_id=user["id"], name="Decks", scopes=["vdj.catalog.read"]
    )["token"]

    requirements = client.get("/api/me/account/deletion", headers=headers)
    assert requirements.json()["requires_password"] is True
    assert requirements.json()["recent_sign_in"] is True

    response = client.request(
        "DELETE", "/api/me", json={"password": PASSWORD}, headers=headers
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True}
    stored = get_user_by_id(user["id"])
    assert stored["status"] == "deleted"
    assert stored["deleted_by"] == user["id"]
    assert all(
        session["revoked_at"] is not None
        for session in list_sessions(user["id"], include_revoked=True)
    )
    assert resolve_access_token(token) is None
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.get("/api/me/export", headers=other_headers).status_code == 200
    assert dispatched[-1][0] == "cleanup_user_data_exports"


@pg
def test_last_admin_cannot_delete_their_account(client):
    admin = get_user_by_email("admin@cratemusic.app")
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@cratemusic.app", "password": "admin"},
    )
    headers = {"Authorization": f"Bearer {login.json()['token']}"}

    response = client.request(
        "DELETE", "/api/me", json={"password": "admin"}, headers=headers
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "At least one owner or admin must remain"
    assert get_user_by_id(admin["id"])["status"] == "active"


@pg
def test_an_admin_can_leave_when_another_admin_remains(client):
    user, headers = _password_user(client, "second-admin@account.test", role="admin")

    response = client.request(
        "DELETE", "/api/me", json={"password": PASSWORD}, headers=headers
    )

    assert response.status_code == 200
    assert get_user_by_id(user["id"])["status"] == "deleted"


@pg
def test_oauth_only_account_requires_a_recent_sign_in(client):
    stale_user, stale_headers = _oauth_user(
        "stale-oauth@account.test", signed_in_minutes_ago=30
    )
    fresh_user, fresh_headers = _oauth_user(
        "fresh-oauth@account.test", signed_in_minutes_ago=1
    )

    requirements = client.get("/api/me/account/deletion", headers=stale_headers).json()
    assert requirements == {
        "requires_password": False,
        "recent_sign_in": False,
        "recent_sign_in_window_seconds": 600,
    }
    stale = client.request("DELETE", "/api/me", json={}, headers=stale_headers)
    fresh = client.request("DELETE", "/api/me", json={}, headers=fresh_headers)

    assert stale.status_code == 403
    assert get_user_by_id(stale_user["id"])["status"] == "active"
    assert fresh.status_code == 200
    assert get_user_by_id(fresh_user["id"])["status"] == "deleted"


@pg
def test_refreshing_a_session_does_not_count_as_a_new_sign_in(client):
    user = create_user("refresh-oauth@account.test", password_hash=None)
    now = datetime.now(timezone.utc)
    session = create_session("refresh-oauth", user["id"], now + timedelta(days=7))
    with transaction_scope() as current:
        current.execute(
            text(
                "UPDATE sessions SET authenticated_at = now() - interval '1 hour'"
                " WHERE id = 'refresh-oauth'"
            )
        )
    touch_session(session["id"], user_agent="refreshed")
    token = create_jwt(user["id"], user["email"], "user", session_id=session["id"])

    response = client.request(
        "DELETE", "/api/me", json={}, headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 403


@pg
def test_export_request_status_and_download_are_bound_to_the_owner(client, dispatched):
    owner, owner_headers = _password_user(client, "exporter@account.test")
    _intruder, intruder_headers = _password_user(client, "intruder@account.test")

    assert client.get("/api/me/export", headers=owner_headers).json() == {
        "export": None
    }
    requested = client.post("/api/me/export", headers=owner_headers)
    assert requested.status_code == 202
    export = requested.json()
    assert export["status"] == "pending" and export["download_url"] is None
    assert dispatched[-1][0] == "export_user_data"
    again = client.post("/api/me/export", headers=owner_headers).json()
    assert again["id"] == export["id"]

    _handle_export_user_data(
        dispatched[-1][1], {"export_id": export["id"], "user_id": owner["id"]}, {}
    )
    status = client.get("/api/me/export", headers=owner_headers).json()["export"]
    assert status["status"] == "ready"
    assert status["download_url"] == f"/api/me/export/{export['id']}/download"

    assert (
        client.get(status["download_url"], headers=intruder_headers).status_code == 404
    )
    assert client.get("/api/me/export", headers=intruder_headers).json() == {
        "export": None
    }
    download = client.get(status["download_url"], headers=owner_headers)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"
    assert download.headers["cache-control"] == "no-store"
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        profile = json.loads(archive.read("profile.json"))
    assert profile[0]["email"] == "exporter@account.test"


@pg
def test_expired_exports_are_not_downloadable(client, dispatched):
    owner, headers = _password_user(client, "expired-export@account.test")
    export = client.post("/api/me/export", headers=headers).json()
    _handle_export_user_data(
        dispatched[-1][1], {"export_id": export["id"], "user_id": owner["id"]}, {}
    )
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE user_data_exports SET expires_at = now() - interval '1 second'"
                " WHERE id = :id"
            ),
            {"id": export["id"]},
        )

    status = client.get("/api/me/export", headers=headers).json()["export"]
    download = client.get(f"/api/me/export/{export['id']}/download", headers=headers)

    assert status["status"] == "expired" and status["download_url"] is None
    assert download.status_code == 404


def test_session_guard_rejects_access_token_identities():
    from crate.api.me_account import _require_session_user

    request = MagicMock()
    request.state.user = {"id": 5, "auth_type": "access_token", "access_token_id": 9}

    with pytest.raises(HTTPException) as exc:
        _require_session_user(request)

    assert exc.value.status_code == 403


def test_export_request_is_unavailable_without_the_download_cache(monkeypatch):
    from crate.api import me_account

    monkeypatch.setattr(me_account, "download_cache_enabled", lambda: False)
    request = MagicMock()
    request.state.user = {"id": 5, "email": "a@b.test", "session_id": "s"}

    with pytest.raises(HTTPException) as exc:
        me_account.request_my_data_export(request)

    assert exc.value.status_code == 503


def test_openapi_types_account_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    secured = [{"cookieAuth": []}, {"bearerAuth": []}]

    delete_operation = data["paths"]["/api/me"]["delete"]
    request_operation = data["paths"]["/api/me/export"]["post"]
    status_operation = data["paths"]["/api/me/export"]["get"]
    requirements_operation = data["paths"]["/api/me/account/deletion"]["get"]
    download_operation = data["paths"]["/api/me/export/{export_id}/download"]["get"]

    for operation in (
        delete_operation,
        request_operation,
        status_operation,
        requirements_operation,
        download_operation,
    ):
        assert operation["security"] == secured
        assert operation["tags"] == ["me"]
    assert delete_operation["requestBody"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("/DeleteAccountRequest")
    assert "409" in delete_operation["responses"]
    assert request_operation["responses"]["202"]["content"]["application/json"][
        "schema"
    ]["$ref"].endswith("/UserDataExportResponse")
    assert status_operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ]["$ref"].endswith("/UserDataExportStatusResponse")
    assert requirements_operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ]["$ref"].endswith("/AccountDeletionRequirementsResponse")
    assert "application/zip" in download_operation["responses"]["200"]["content"]
