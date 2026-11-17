"""Every statement on the shared engine counts toward crate_db_queries_total."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_each_statement_on_the_engine_is_counted(pg_db, monkeypatch):
    from sqlalchemy import text

    from crate.db import engine

    observed = []
    monkeypatch.setattr(
        engine.prometheus,
        "observe",
        lambda series, value: observed.append((series.definition.name, value)),
    )

    with engine.get_engine().connect() as connection:
        connection.execute(text("SELECT 1"))
        connection.execute(text("SELECT 2"))

    assert observed == [("db.queries", 1.0), ("db.queries", 1.0)]


def test_python_and_readplane_share_one_query_counter():
    from crate.observability.prometheus import EXPORTED_FAMILIES

    family = EXPORTED_FAMILIES["db.queries"]
    assert family.kind == "counter" and family.labels == ()
    readplane = (ROOT / "app/readplane/internal/observability/metrics.go").read_text()
    assert f'"{family.name}_total"' in readplane
