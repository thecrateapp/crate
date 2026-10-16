"""Revision 113 preserves existing plans and supports real downgrade/upgrade."""

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.agent_admin_v113 import create_agent_admin_v113_schema
from sqlalchemy import text

from tests.test_agent_access_migration import RecordingExecutor


class MigrationRecorder(RecordingExecutor):
    def __init__(self):
        super().__init__()
        self.autocommit = False
        self.concurrent_statements = []

    def get_context(self):
        return self

    @contextmanager
    def autocommit_block(self):
        self.autocommit = True
        try:
            yield
        finally:
            self.autocommit = False

    def execute(self, statement):
        if "CONCURRENTLY" in statement:
            assert self.autocommit
            self.concurrent_statements.append(statement)
        super().execute(statement)


def test_admin_schema_and_migration_share_bootstrap_ddl(monkeypatch):
    migration = import_module("crate.db.migrations.versions.113_agent_admin")
    migrated, section, bootstrap = (
        MigrationRecorder(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_agent_admin_v113_schema(section, include_index=False)
    create_schema(bootstrap)
    assert (migration.revision, migration.down_revision) == ("113", "112")
    assert migrated.statements[:-1] == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    assert len(migrated.concurrent_statements) == 1
    migration.downgrade()
    assert len(migrated.concurrent_statements) == 2


def test_admin_migration_real_downgrade_upgrade_preserves_credentials(
    pg_db, monkeypatch
):
    from crate.db.engine import get_engine
    from crate.db.repositories.agent_credentials import (
        create_credential,
        resolve_credential,
    )
    from crate.db.tx import transaction_scope

    migration = import_module("crate.db.migrations.versions.113_agent_admin")
    issued = create_credential(
        "Reader", ["library.health.read"], datetime.now(UTC) + timedelta(days=1)
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE agent_principals SET require_approval=TRUE WHERE id=:id"),
            {"id": issued.principal.id},
        )
    with get_engine().connect() as connection:
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))
        with context.begin_transaction():
            migration.downgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_plan_approvals')")
            ).scalar_one()
            is None
        )
        assert (
            connection.execute(
                text("SELECT name FROM agent_principals WHERE id=:id"),
                {"id": issued.principal.id},
            ).scalar_one()
            == "Reader"
        )
        assert (
            connection.execute(
                text("SELECT to_regclass('idx_agent_audit_activity')")
            ).scalar_one()
            is None
        )
        connection.rollback()
        for _ in range(2):
            with context.begin_transaction():
                migration.upgrade()
        row = (
            connection.execute(
                text(
                    "SELECT policy_revision,require_approval FROM agent_principals WHERE id=:id"
                ),
                {"id": issued.principal.id},
            )
            .mappings()
            .one()
        )
        assert row == {"policy_revision": 1, "require_approval": False}
        assert (
            connection.execute(
                text(
                    "SELECT indisvalid FROM pg_index WHERE indexrelid='idx_agent_audit_activity'::regclass"
                )
            ).scalar_one()
            is True
        )
    assert resolve_credential(issued.token).id == issued.principal.id
