"""System Health dashboard: the error inbox tile data (`errors`)."""

from __future__ import annotations

import pytest

from tests.error_inbox_fakes import configure
from tests.test_error_inbox_api import _row, record_sync, seed_issues
from tests.test_metric_api_contracts import summary_sources as summary_sources  # noqa: PLC0414

DASHBOARD = "/api/admin/metrics/dashboard?period=minute&minutes=60"


@pytest.fixture
def dashboard(pg_db, test_app, summary_sources, monkeypatch):
    monkeypatch.setattr("crate.db.cache_store.get_cache", lambda *a, **k: None)
    monkeypatch.setattr("crate.db.cache_store.set_cache", lambda *a, **k: None)
    return test_app


def test_dashboard_includes_error_summary(dashboard):
    ids = seed_issues(_row(1, crate_score=85, service="readplane"), _row(2))
    configure()
    sync = record_sync()

    response = dashboard.get(DASHBOARD)

    assert response.status_code == 200, response.text
    errors = response.json()["errors"]
    assert errors["configured"] is True
    assert (errors["open"], errors["critical_open"]) == (2, 1)
    assert errors["top_critical"] == [
        {
            "id": ids["1"],
            "short_id": "CRATE-API-1",
            "title": "IntegrityError number 1",
            "service": "readplane",
            "crate_score": 85,
        }
    ]
    assert {item["service"] for item in errors["services"]} == {"api", "readplane"}
    assert errors["sync"]["status"] == "ok"
    assert errors["sync"]["last_success_at"] is not None
    assert errors["last_synced_at"] is not None
    assert sync["status"] == "ok"


def test_dashboard_errors_say_not_configured(dashboard):
    response = dashboard.get(DASHBOARD)

    errors = response.json()["errors"]
    assert errors["configured"] is False
    assert errors["open"] == 0
    assert errors["sync"] is None


def test_dashboard_errors_null_when_summary_fails(dashboard, monkeypatch):
    def broken(**kwargs):
        raise RuntimeError("summary unavailable")

    monkeypatch.setattr("crate.error_inbox.views.inbox_summary", broken)

    response = dashboard.get(DASHBOARD)

    assert response.status_code == 200, response.text
    assert response.json()["errors"] is None
    assert response.json()["summary"]


def test_dashboard_drops_titles_without_view_capability(dashboard, monkeypatch):
    ids = seed_issues(_row(1, crate_score=85))
    configure()
    granted = {"value": False}
    monkeypatch.setattr(
        "crate.api.admin_metrics.has_capability",
        lambda user, capability: capability != "ops.errors.view" or granted["value"],
    )

    hidden = dashboard.get(DASHBOARD)

    assert hidden.status_code == 200, hidden.text
    errors = hidden.json()["errors"]
    assert errors["critical_open"] == 1
    assert errors["top_critical"] == [
        {
            "id": ids["1"],
            "short_id": "CRATE-API-1",
            "service": "api",
            "crate_score": 85,
        }
    ]
    assert "IntegrityError" not in hidden.text

    granted["value"] = True
    shown = dashboard.get(DASHBOARD).json()["errors"]
    assert shown["top_critical"][0]["title"] == "IntegrityError number 1"


def test_dashboard_error_summary_is_one_query_without_library_tracks(pg_db):
    from sqlalchemy import event

    from crate.db.engine import get_engine
    from crate.error_inbox.views import inbox_summary

    seed_issues(_row(1))
    configure()
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        summary = inbox_summary()
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert summary["configured"] is True
    assert len(statements) == 1
    assert "library_tracks" not in statements[0]
    assert "error_issues" in statements[0]
