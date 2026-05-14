from __future__ import annotations

import importlib

from sqlalchemy.exc import OperationalError


class _FakeConnection:
    def __init__(self):
        self.statements: list[object] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, statement, params=None):
        self.statements.append((statement, params))

    def commit(self):
        return None


class _FakeEngine:
    def __init__(self):
        self.attempts = 0
        self.connection = _FakeConnection()

    def connect(self):
        self.attempts += 1
        if self.attempts == 1:
            raise OperationalError("SELECT 1", {}, Exception("starting"))
        return self.connection


def test_init_db_retries_until_database_accepts_connections(monkeypatch):
    db_init = importlib.import_module("crate.db.init_db")

    engine = _FakeEngine()
    calls: list[str] = []

    monkeypatch.setenv("CRATE_DB_INIT_RETRY_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("CRATE_DB_INIT_RETRY_INTERVAL_SECONDS", "0.01")
    monkeypatch.setattr(db_init, "ensure_database", lambda: calls.append("ensure"))
    monkeypatch.setattr(db_init, "get_engine", lambda: engine)
    monkeypatch.setattr(db_init, "_init_db_inner", lambda: calls.append("inner"))
    monkeypatch.setattr(db_init.time, "sleep", lambda _: None)

    db_init.init_db()

    assert engine.attempts == 2
    assert calls == ["ensure", "ensure", "inner"]


def test_ensure_database_retries_after_failed_provisioning(monkeypatch):
    import crate.db.core_provisioning as core_provisioning

    calls: list[str] = []

    monkeypatch.setattr(core_provisioning, "_db_provisioned", False)
    monkeypatch.setenv("POSTGRES_SUPERUSER_USER", "postgres")
    monkeypatch.setenv("POSTGRES_SUPERUSER_PASSWORD", "postgres")
    monkeypatch.setattr(
        core_provisioning,
        "get_pg_connection_settings",
        lambda: ("crate", "crate", "postgres", 5432, "crate"),
    )

    def fail_connect(**_kwargs):
        calls.append("connect")
        raise RuntimeError("database is still starting")

    monkeypatch.setattr(core_provisioning.psycopg2, "connect", fail_connect)

    core_provisioning.ensure_database()
    core_provisioning.ensure_database()

    assert calls == ["connect", "connect"]
