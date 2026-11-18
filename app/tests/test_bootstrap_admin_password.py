import logging
import stat
from contextlib import contextmanager
from importlib import import_module
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value


class _EmptyUsersSession:
    def __init__(self):
        self.added = []
        self.results = iter([0, None])

    def execute(self, _statement):
        return _Result(next(self.results))

    def add(self, user):
        self.added.append(user)


def _seed(monkeypatch, *, password=None, dev_seed=None):
    from crate.db.repositories.auth_user_accounts import _seed_admin

    for name, value in (
        ("DEFAULT_ADMIN_PASSWORD", password),
        ("CRATE_DEV_ADMIN_SEED", dev_seed),
    ):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    session = _EmptyUsersSession()
    with patch("crate.auth.hash_password", side_effect=lambda value: f"hash:{value}"):
        returned = _seed_admin(session)
    (user,) = session.added
    return returned, user


@pytest.mark.parametrize("configured", [None, "", "admin", "Admin", "short"])
def test_seed_generates_a_random_password_when_unset_or_weak(
    monkeypatch, caplog, configured
):
    caplog.set_level(logging.DEBUG)

    generated, user = _seed(monkeypatch, password=configured)

    assert generated and len(generated) >= 16
    assert generated != configured
    assert user.password_hash == f"hash:{generated}"
    assert user.password_change_required is True
    assert generated not in caplog.text


def test_seed_keeps_a_strong_configured_password_but_requires_a_change(monkeypatch):
    generated, user = _seed(monkeypatch, password="a-long-installer-password")

    assert generated is None
    assert user.password_hash == "hash:a-long-installer-password"
    assert user.password_change_required is True


def test_dev_seed_keeps_the_local_admin_login(monkeypatch):
    generated, user = _seed(monkeypatch, password="admin", dev_seed="true")

    assert generated is None
    assert user.email == "admin@cratemusic.app"
    assert user.password_hash == "hash:admin"
    assert user.password_change_required is False


def test_init_db_writes_the_generated_password_to_an_owner_only_file(
    monkeypatch, tmp_path, caplog
):
    init_db = import_module("crate.db.init_db")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    caplog.set_level(logging.DEBUG)

    @contextmanager
    def fake_scope():
        yield object()

    with (
        patch.object(init_db, "run_alembic_upgrade"),
        patch.object(init_db, "ensure_optional_superuser_extension"),
        patch("crate.db.tx.transaction_scope", fake_scope),
        patch("crate.genre_taxonomy.seed_genre_taxonomy"),
        patch(
            "crate.db.repositories.auth._seed_admin",
            return_value="generated-initial-secret",
        ),
    ):
        init_db._init_db_inner()

    path = tmp_path / init_db.INITIAL_ADMIN_PASSWORD_FILE
    assert path.read_text(encoding="utf-8") == "generated-initial-secret\n"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert "generated-initial-secret" not in caplog.text
    assert str(path) in caplog.text


def test_migration_167_replays_its_schema_section(monkeypatch):
    migration = import_module(
        "crate.db.migrations.versions.167_user_password_change_required"
    )
    section = import_module("crate.db.schema_sections.auth_v167")
    statements: list[str] = []

    class Recorder:
        def execute(self, statement: str) -> None:
            statements.append(" ".join(statement.split()))

    monkeypatch.setattr(migration, "op", Recorder())
    migration.upgrade()
    section_statements = list(statements)
    statements.clear()
    section.create_users_password_change_required_v167_schema(Recorder())

    assert migration.revision == "167"
    assert migration.down_revision == "166"
    assert (
        section_statements
        == statements
        == [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_required "
            "BOOLEAN NOT NULL DEFAULT FALSE"
        ]
    )


def _flagged_session_user(self, user_id, session_id):
    return {
        "id": user_id,
        "email": "admin@cratemusic.app",
        "role": "admin",
        "session_id": session_id,
        "password_change_required": user_id == 1,
    }


@pytest.fixture
def gated_client(monkeypatch):
    from crate.api.auth import AuthMiddleware

    monkeypatch.setattr(
        "crate.api.auth.verify_jwt",
        lambda token: {"user_id": int(token.removeprefix("user-")), "sid": "s"},
    )
    monkeypatch.setattr(AuthMiddleware, "_resolve_session_user", _flagged_session_user)
    app = FastAPI()

    @app.api_route(
        "/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    )
    def anything(request: Request, path: str):
        return {"user": request.state.user["id"]}

    app.add_middleware(AuthMiddleware)
    return TestClient(app)


@pytest.mark.parametrize(
    ("method", "path", "expected_status"),
    [
        ("GET", "/api/admin/tasks-snapshot", 403),
        ("POST", "/api/auth/tokens", 403),
        ("PUT", "/api/me/profile", 403),
        ("POST", "/api/auth/subsonic-token", 403),
        ("GET", "/api/auth/me", 200),
        ("POST", "/api/auth/change-password", 200),
        ("PUT", "/api/me/password", 200),
        ("POST", "/api/auth/logout", 200),
        ("POST", "/api/auth/heartbeat", 200),
    ],
)
def test_required_password_change_blocks_other_api_actions(
    gated_client, method, path, expected_status
):
    gated_client.cookies.set("crate_session", "user-1")

    response = gated_client.request(method, path)

    assert response.status_code == expected_status
    if expected_status == 403:
        assert response.json() == {"detail": "Password change required"}


def test_users_without_a_required_change_are_not_gated(gated_client):
    gated_client.cookies.set("crate_session", "user-2")

    response = gated_client.get("/api/admin/tasks-snapshot")

    assert response.status_code == 200
    assert response.json() == {"user": 2}


def _flagged_db_user(**overrides):
    return {
        "id": 1,
        "email": "admin@cratemusic.app",
        "name": "Admin",
        "avatar": None,
        "role": "admin",
        "roles": ["admin"],
        "username": "admin",
        "password_hash": "hash:initial-secret",
        "password_change_required": True,
        **overrides,
    }


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        (
            "POST",
            "/api/auth/change-password",
            {"current_password": "initial-secret", "new_password": "a-new-password"},
        ),
        (
            "PUT",
            "/api/me/password",
            {"current_password": "initial-secret", "new_password": "a-new-password"},
        ),
    ],
)
def test_changing_the_password_clears_the_requirement(test_app, method, path, body):
    import bcrypt

    bcrypt_hash = bcrypt.hashpw(b"initial-secret", bcrypt.gensalt(4)).decode()
    db_user = _flagged_db_user(password_hash=bcrypt_hash)
    with (
        patch("crate.api.auth.get_user_by_id", return_value=db_user),
        patch("crate.api.me.get_user_by_id", return_value=db_user),
        patch("crate.api.auth.update_user") as auth_update,
        patch("crate.api.me.update_user") as me_update,
        patch("crate.api.auth_cache.invalidate_user") as invalidate,
    ):
        response = test_app.request(method, path, json=body)

    assert response.status_code == 200, response.text
    update = auth_update if path.startswith("/api/auth") else me_update
    (call,) = update.call_args_list
    assert call.args == (1,)
    assert call.kwargs["password_change_required"] is False
    assert call.kwargs["password_hash"] != bcrypt_hash
    invalidate.assert_called_once_with(1)


def test_required_change_rejects_reusing_the_initial_password(test_app):
    import bcrypt

    bcrypt_hash = bcrypt.hashpw(b"initial-secret", bcrypt.gensalt(4)).decode()
    db_user = _flagged_db_user(password_hash=bcrypt_hash)
    with (
        patch("crate.api.auth.get_user_by_id", return_value=db_user),
        patch("crate.api.auth.update_user") as update,
    ):
        response = test_app.post(
            "/api/auth/change-password",
            json={
                "current_password": "initial-secret",
                "new_password": "initial-secret",
            },
        )

    assert response.status_code == 400
    update.assert_not_called()


@pytest.mark.parametrize("flagged", [True, False])
def test_auth_me_reports_the_requirement_only_when_set(test_app, flagged):
    db_user = _flagged_db_user(password_change_required=flagged)
    with (
        patch("crate.api.auth.get_user_by_id", return_value=db_user),
        patch("crate.api.auth.list_user_external_identities", return_value=[]),
    ):
        payload = test_app.get("/api/auth/me").json()

    if flagged:
        assert payload["password_change_required"] is True
    else:
        assert "password_change_required" not in payload
