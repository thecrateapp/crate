"""OAuth migration parity, repeatable DDL and safe downgrade of delegated identities."""

from importlib import import_module

from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.mcp_oauth_v112 import create_mcp_oauth_v112_schema
from crate.db.tx import transaction_scope
from sqlalchemy import text

from tests.test_agent_access_migration import RecordingExecutor, SessionExecutor
from tests.test_mcp_oauth_integration import _tokens
from tests.test_mcp_oauth_integration import oauth_env as oauth_env  # noqa: PLC0414 — pytest fixture registration.


def test_oauth_migration_matches_bootstrap_and_is_idempotent(pg_db, monkeypatch):
    migration = import_module("crate.db.migrations.versions.121_mcp_oauth")
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_mcp_oauth_v112_schema(section)
    create_schema(bootstrap)
    assert migrated.statements == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    assert (migration.revision, migration.down_revision) == ("121", "120")
    with transaction_scope() as session:
        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        migration.upgrade()
        migration.upgrade()
        for table in [
            "mcp_oauth_clients",
            "mcp_oauth_authorizations",
            "mcp_oauth_consents",
            "mcp_oauth_codes",
            "mcp_oauth_tokens",
        ]:
            assert (
                session.execute(
                    text("SELECT to_regclass(:name)"), {"name": table}
                ).scalar_one()
                == table
            )


def test_oauth_downgrade_revokes_and_preserves_delegated_identity_references(
    oauth_env, monkeypatch
):
    from crate.db.repositories.mcp_oauth import resolve_oauth_access_token

    principal = resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    migration = import_module("crate.db.migrations.versions.121_mcp_oauth")
    with transaction_scope() as session:
        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        migration.downgrade()
        assert (
            session.execute(text("SELECT to_regclass('mcp_oauth_tokens')")).scalar_one()
            is None
        )
        assert (
            session.execute(
                text("SELECT enabled FROM agent_principals WHERE id = :id"),
                {"id": principal.id},
            ).scalar_one()
            is False
        )
        assert (
            session.execute(
                text("SELECT revoked_at FROM agent_credentials WHERE id = :id"),
                {"id": principal.credential_id},
            ).scalar_one()
            is not None
        )
        migration.upgrade()
        assert (
            session.execute(text("SELECT COUNT(*) FROM mcp_oauth_tokens")).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text("SELECT enabled FROM agent_principals WHERE id = :id"),
                {"id": principal.id},
            ).scalar_one()
            is False
        )
