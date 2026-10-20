from importlib import import_module

import pytest
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.ai_configuration_v120 import (
    create_ai_configuration_v120_schema,
)
from crate.db.schema_sections.ai_configuration_v121 import (
    create_ai_default_model_v121_schema,
)
from crate.db.tx import transaction_scope
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from tests.test_agent_access_migration import RecordingExecutor, SessionExecutor


def test_ai_migration_bootstrap_idempotency_and_roundtrip(pg_db, monkeypatch):
    migration = import_module("crate.db.migrations.versions.130_ai_configuration")
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_ai_configuration_v120_schema(section)
    create_schema(bootstrap)
    assert migrated.statements == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    assert migration.down_revision == "129"
    joined = "\n".join(bootstrap.statements)
    assert joined.index("CREATE TABLE IF NOT EXISTS credential_secrets") < joined.index(
        "CREATE TABLE IF NOT EXISTS ai_provider_connections"
    )
    with transaction_scope() as session:
        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        session.execute(
            text(
                "INSERT INTO credential_secrets(secret_ref,scope,ciphertext,created_at,updated_at) VALUES('migration:test','test','cipher',NOW(),NOW())"
            )
        )
        migration.downgrade()
        assert (
            session.execute(
                text(
                    "SELECT ciphertext FROM credential_secrets WHERE secret_ref='migration:test'"
                )
            ).scalar_one()
            == "cipher"
        )
        assert (
            session.execute(text("SELECT to_regclass('ai_profiles')")).scalar_one()
            is None
        )
        migration.upgrade()
        migration.upgrade()
        assert (
            session.execute(
                text("SELECT active FROM ai_configuration_state")
            ).scalar_one()
            is False
        )
        assert (
            session.execute(
                text("SELECT count(*) FROM ai_action_bindings")
            ).scalar_one()
            == 0
        )


def test_default_model_migration_is_idempotent_and_bootstrapped(pg_db, monkeypatch):
    migration = import_module("crate.db.migrations.versions.131_ai_default_model")
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_ai_default_model_v121_schema(section)
    create_schema(bootstrap)
    assert migrated.statements == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    assert migration.down_revision == "130"

    with transaction_scope() as session:
        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        migration.upgrade()
        migration.upgrade()
        migration.downgrade()
        assert (
            session.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name='ai_configuration_state' AND column_name='default_model'"
                )
            ).first()
            is None
        )
        migration.upgrade()
        assert (
            session.execute(
                text("SELECT default_model FROM ai_configuration_state")
            ).scalar_one()
            is None
        )

    with pytest.raises(IntegrityError), transaction_scope() as session:
        session.execute(
            text("UPDATE ai_configuration_state SET default_model='[]'::jsonb")
        )


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO ai_provider_connections(label,provider,max_concurrent) VALUES('bad','ollama',9)",
        "INSERT INTO ai_provider_connections(label,provider,daily_calls) VALUES('bad','ollama',0)",
        "INSERT INTO ai_action_bindings(action_id,profile_id,profile_version) VALUES('unknown',gen_random_uuid(),1)",
    ],
)
def test_ai_schema_rejects_invalid_values(pg_db, sql):
    with pytest.raises(IntegrityError), transaction_scope() as session:
        session.execute(text(sql))
