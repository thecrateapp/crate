from types import SimpleNamespace

import crate.db.engine as engine_module


class _URL:
    @staticmethod
    def render_as_string(*, hide_password: bool) -> str:
        assert hide_password is True
        return "postgresql://crate:***@db/crate"


def test_engine_applies_pool_connect_lock_and_statement_budgets(monkeypatch):
    captured: dict = {}

    def fake_create_engine(dsn: str, **kwargs):
        captured["dsn"] = dsn
        captured.update(kwargs)
        return SimpleNamespace(url=_URL(), dispose=lambda: None)

    monkeypatch.setenv("CRATE_SQLALCHEMY_POOL_TIMEOUT_SECONDS", "7")
    monkeypatch.setenv("CRATE_POSTGRES_CONNECT_TIMEOUT_SECONDS", "4")
    monkeypatch.setenv("CRATE_POSTGRES_STATEMENT_TIMEOUT_MS", "12000")
    monkeypatch.setenv("CRATE_POSTGRES_LOCK_TIMEOUT_MS", "2500")
    monkeypatch.setattr(engine_module, "create_engine", fake_create_engine)
    engine_module.reset_engine()

    engine_module.get_engine()

    assert captured["pool_timeout"] == 7
    assert captured["connect_args"]["connect_timeout"] == 4
    assert "statement_timeout=12000" in captured["connect_args"]["options"]
    assert "lock_timeout=2500" in captured["connect_args"]["options"]


def test_engine_invalid_or_non_positive_budgets_use_safe_defaults(monkeypatch):
    captured: dict = {}

    def fake_create_engine(_dsn: str, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(url=_URL(), dispose=lambda: None)

    monkeypatch.setenv("CRATE_SQLALCHEMY_POOL_TIMEOUT_SECONDS", "invalid")
    monkeypatch.setenv("CRATE_POSTGRES_CONNECT_TIMEOUT_SECONDS", "0")
    monkeypatch.setenv("CRATE_POSTGRES_STATEMENT_TIMEOUT_MS", "-1")
    monkeypatch.setenv("CRATE_POSTGRES_LOCK_TIMEOUT_MS", "bad")
    monkeypatch.setattr(engine_module, "create_engine", fake_create_engine)
    engine_module.reset_engine()

    engine_module.get_engine()

    assert captured["pool_timeout"] == 5
    assert captured["connect_args"]["connect_timeout"] == 3
    assert "statement_timeout=15000" in captured["connect_args"]["options"]
    assert "lock_timeout=3000" in captured["connect_args"]["options"]


def test_worker_statement_budget_does_not_inherit_interactive_timeout(monkeypatch):
    captured: dict = {}

    def fake_create_engine(_dsn: str, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(url=_URL(), dispose=lambda: None)

    monkeypatch.setenv("CRATE_RUNTIME", "worker")
    monkeypatch.delenv("CRATE_POSTGRES_STATEMENT_TIMEOUT_MS", raising=False)
    monkeypatch.setattr(engine_module, "create_engine", fake_create_engine)
    engine_module.reset_engine()

    engine_module.get_engine()

    assert "statement_timeout=900000" in captured["connect_args"]["options"]
