"""The diagnostic migration preserves data through real PostgreSQL upgrades."""

from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text


def test_diagnostic_migration_round_trip_preserves_snapshots(pg_db, monkeypatch):
    from crate.db.engine import get_engine
    from crate.db.tx import transaction_scope

    migration = import_module("crate.db.migrations.versions.110_agent_diagnostic_reads")
    assert migration.revision == "110"
    assert migration.down_revision == "109"
    with transaction_scope() as session:
        session.execute(
            text("""
                INSERT INTO ui_snapshots (scope, subject_key, payload_json)
                VALUES ('ops', 'dashboard', '{"tracks": 42}'),
                       ('ops:health', 'agent:diagnostics:v1', '{"issues": []}'),
                       ('home:discovery', 'test-user', '{"albums": []}')
                ON CONFLICT (scope, subject_key) DO NOTHING
            """)
        )

    with get_engine().connect() as connection:
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))
        with context.begin_transaction():
            migration.downgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('idx_worker_logs_diagnostic_time')")
            ).scalar_one()
            is None
        )
        assert (
            connection.execute(
                text("SELECT to_regclass('idx_tasks_diagnostic_time')")
            ).scalar_one()
            is None
        )
        assert (
            connection.execute(
                text("""
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_name = 'ui_snapshots' AND column_name = 'invalidated_at'
            """)
            ).scalar_one()
            == 0
        )
        connection.rollback()

        for _ in range(2):
            with context.begin_transaction():
                migration.upgrade()
        rows = (
            connection.execute(
                text("""
                SELECT scope, payload_json, invalidated_at FROM ui_snapshots
                WHERE scope IN ('ops', 'ops:health', 'home:discovery')
            """)
            )
            .mappings()
            .all()
        )
        by_scope = {row["scope"]: row for row in rows}
        assert by_scope["ops"]["payload_json"] == {"tracks": 42}
        assert by_scope["ops"]["invalidated_at"] is not None
        assert by_scope["ops:health"]["invalidated_at"] is not None
        assert by_scope["home:discovery"]["invalidated_at"] is None
        indexes = connection.execute(
            text("""
                SELECT c.relname, i.indisvalid FROM pg_index i
                JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname IN ('idx_worker_logs_diagnostic_time', 'idx_tasks_diagnostic_time')
            """)
        ).all()
        assert dict(indexes) == {
            "idx_worker_logs_diagnostic_time": True,
            "idx_tasks_diagnostic_time": True,
        }


def test_snapshot_rebuild_clears_explicit_invalidation(pg_db):
    from crate.db.tx import read_scope
    from crate.db.ui_snapshot_writes import mark_ui_snapshots_stale, upsert_ui_snapshot

    first = upsert_ui_snapshot(
        "ops:health",
        "agent:diagnostics:v1",
        {"issues": []},
        source_seq=42,
        publish_snapshot=lambda *_args: None,
    )
    assert mark_ui_snapshots_stale(scope="ops:health") == 1
    with read_scope() as session:
        invalidated = session.execute(
            text("SELECT invalidated_at FROM ui_snapshots WHERE scope = 'ops:health'")
        ).scalar_one()
    assert invalidated is not None

    rebuilt = upsert_ui_snapshot(
        "ops:health",
        "agent:diagnostics:v1",
        {"issues": [{"id": 1}]},
        source_seq=43,
        publish_snapshot=lambda *_args: None,
    )
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT invalidated_at, source_seq, payload_json FROM ui_snapshots WHERE scope = 'ops:health'"
                )
            )
            .mappings()
            .one()
        )
    assert row["invalidated_at"] is None
    assert row["source_seq"] == 43
    assert row["payload_json"]["issues"] == [{"id": 1}]
    assert rebuilt["version"] == first["version"] + 1
