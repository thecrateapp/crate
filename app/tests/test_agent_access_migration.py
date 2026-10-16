from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.agent_access_v109 import create_agent_access_v109_schema
from crate.db.tx import transaction_scope
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


class RecordingExecutor:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(" ".join(statement.split()))


class SessionExecutor:
    def __init__(self, session):
        self.session = session

    def execute(self, statement):
        return self.session.execute(text(statement))


def migration_context(connection, monkeypatch, migrations):
    context = MigrationContext.configure(connection)
    for migration in migrations:
        monkeypatch.setattr(migration, "op", Operations(context))
    return context


def test_agent_migration_and_bootstrap_use_same_schema(monkeypatch):
    migration = import_module("crate.db.migrations.versions.109_agent_access")
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_agent_access_v109_schema(section)
    create_schema(bootstrap)
    assert migrated.statements == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    assert migration.revision == "109"
    assert migration.down_revision == "108"


def test_agent_schema_real_downgrade_upgrade_and_idempotency(pg_db, monkeypatch):
    from crate.db.engine import get_engine

    migrations = [
        import_module(f"crate.db.migrations.versions.{name}")
        for name in (
            "109_agent_access",
            "110_agent_diagnostic_reads",
            "111_agent_commands",
            "112_mcp_oauth",
            "113_agent_admin",
        )
    ]
    migration = migrations[0]
    with get_engine().connect() as connection:
        context = migration_context(connection, monkeypatch, migrations)
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_credentials')")
            ).scalar_one()
            is not None
        )
        connection.rollback()
        with context.begin_transaction():
            for dependent in reversed(migrations):
                dependent.downgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_credentials')")
            ).scalar_one()
            is None
        )
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_principals')")
            ).scalar_one()
            is None
        )
        connection.rollback()
        with context.begin_transaction():
            migration.upgrade()
            migration.upgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_credentials')")
            ).scalar_one()
            is not None
        )
        columns = (
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_credentials'"
                )
            )
            .scalars()
            .all()
        )
        assert "token_digest" in columns
        assert "token" not in columns
        connection.rollback()
        with context.begin_transaction():
            for dependent in migrations[1:]:
                dependent.upgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_plan_approvals')")
            ).scalar_one()
            == "agent_plan_approvals"
        )


@pytest.mark.parametrize(
    "grants", ["ARRAY['ops.tasks.manage']", "ARRAY[]::TEXT[]", "ARRAY[NULL]::TEXT[]"]
)
def test_schema_forbids_unbounded_or_empty_grants(pg_db, grants):
    with (
        pytest.raises(IntegrityError, match="agent_principals_grants_check"),
        transaction_scope() as session,
    ):
        # SQL_SAFE: parameterized fixed fixtures; no request-controlled SQL.
        session.execute(
            text(
                f"INSERT INTO agent_principals (id, name, grants) VALUES ('10000000-0000-0000-0000-000000000001', 'Invalid scope', {grants})"
            )
        )
