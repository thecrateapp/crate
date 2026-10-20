"""The additive command migration bootstraps and downgrades real PostgreSQL."""

from importlib import import_module

import pytest
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.agent_commands_v111 import (
    create_agent_commands_v111_schema,
)
from crate.db.tx import transaction_scope
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.test_agent_access_migration import (
    RecordingExecutor,
    SessionExecutor,
    migration_context,
)


def test_commands_migration_matches_bootstrap_and_is_idempotent(pg_db, monkeypatch):
    migration = import_module("crate.db.migrations.versions.121_agent_commands")
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_agent_commands_v111_schema(section)
    create_schema(bootstrap)
    assert migrated.statements == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    assert (migration.revision, migration.down_revision) == ("121", "120")
    with transaction_scope() as session:
        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        migration.upgrade()
        migration.upgrade()
        for table in (
            "agent_requests",
            "agent_jobs",
            "agent_photo_observations",
            "agent_repair_plans",
        ):
            assert (
                session.execute(
                    text("SELECT to_regclass(:table)"), {"table": table}
                ).scalar_one()
                == table
            )


def test_commands_downgrade_preserves_identity_disables_removed_scopes_and_reupgrades(
    pg_db, monkeypatch
):
    from crate.db.engine import get_engine

    migration = import_module("crate.db.migrations.versions.121_agent_commands")
    oauth = import_module("crate.db.migrations.versions.122_mcp_oauth")
    admin = import_module("crate.db.migrations.versions.123_agent_admin")
    library = import_module("crate.db.migrations.versions.124_agent_library_operations")
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO agent_principals (id,name,grants) VALUES
            ('10000000-0000-0000-0000-000000000001','Reader',ARRAY['library.health.read']),
            ('10000000-0000-0000-0000-000000000002','Mixed',ARRAY['library.health.read','library.health.run']),
            ('10000000-0000-0000-0000-000000000003','Writer',ARRAY['library.health.run'])
        """)
        )
    with get_engine().connect() as connection:
        context = migration_context(
            connection, monkeypatch, [migration, oauth, admin, library]
        )
        with context.begin_transaction():
            library.downgrade()
            admin.downgrade()
            oauth.downgrade()
            migration.downgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_requests')")
            ).scalar_one()
            is None
        )
        rows = {
            row["name"]: row
            for row in connection.execute(
                text("SELECT name,enabled,grants FROM agent_principals")
            ).mappings()
        }
        assert rows["Reader"]["enabled"]
        assert not rows["Mixed"]["enabled"] and not rows["Writer"]["enabled"]
        assert (
            rows["Mixed"]["grants"]
            == rows["Writer"]["grants"]
            == ["library.health.read"]
        )
        connection.rollback()
        with context.begin_transaction():
            migration.upgrade()
            oauth.upgrade()
            admin.upgrade()
            library.upgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_requests')")
            ).scalar_one()
            is not None
        )
        assert (
            connection.execute(
                text("SELECT enabled FROM agent_principals WHERE name='Writer'")
            ).scalar_one()
            is False
        )


def test_command_schema_rejects_unbounded_grants(pg_db):
    with pytest.raises(IntegrityError), transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO agent_principals (id,name,grants)
            VALUES ('10000000-0000-0000-0000-000000000001','Bad',ARRAY['library.repair.any'])
        """)
        )
