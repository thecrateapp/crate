"""Migration 147 admits openai_compatible connections; its downgrade restores 146."""

import json
from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, InternalError

from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.ai_openai_compatible_v147 import (
    V147_TEMPLATE_ORIGINS,
    create_ai_openai_compatible_v147_schema,
    drop_ai_openai_compatible_v147_schema,
)
from crate.db.tx import transaction_scope
from tests.test_agent_access_migration import RecordingExecutor, SessionExecutor

MIGRATION = "crate.db.migrations.versions.147_ai_openai_compatible"
COLUMNS = {"template", "path_prefix", "model_manifest"}
MANIFEST = [
    {
        "model_id": "kimi-k3.1-pro",
        "context_window": 262144,
        "max_output_tokens": 32768,
        "structured_output": "json_object",
    }
]


def _columns(session) -> set[str]:
    return set(
        session.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'ai_provider_connections'"
            )
        ).scalars()
    )


def _provider_checks(session) -> list[tuple[str, str]]:
    return sorted(
        session.execute(
            text(
                """
                SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
                WHERE conrelid = 'ai_provider_connections'::regclass AND contype = 'c'
                  AND position('provider' in pg_get_constraintdef(oid)) > 0
                """
            )
        ).all()
    )


def _insert(session, **values) -> str:
    row = {
        "label": "Provider",
        "provider": "openai_compatible",
        "endpoint": None,
        "template": None,
        "path_prefix": None,
        "model_manifest": [],
        "secret_source": "none",
        "secret_ref": None,
        **values,
    }
    row["model_manifest"] = json.dumps(row["model_manifest"])
    return session.execute(
        text(
            """
            INSERT INTO ai_provider_connections
                (label, provider, endpoint, template, path_prefix, model_manifest,
                 secret_source, secret_ref)
            VALUES (:label, :provider, :endpoint, :template, :path_prefix,
                    CAST(:model_manifest AS jsonb), :secret_source, :secret_ref)
            RETURNING id::text
            """
        ),
        row,
    ).scalar_one()


def _moonshot(session, **values) -> str:
    origin, prefix = V147_TEMPLATE_ORIGINS["moonshot"]
    return _insert(
        session,
        template="moonshot",
        endpoint=origin,
        path_prefix=prefix,
        model_manifest=MANIFEST,
        **values,
    )


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_ai_openai_compatible_v147_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "147" and migration.down_revision == "146"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)
    assert joined.index("CREATE TABLE IF NOT EXISTS ai_provider_connections") < (
        joined.index(section.statements[0])
    )

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_ai_openai_compatible_v147_schema(expected)
    assert downgrade.statements == expected.statements
    restored = [s for s in downgrade.statements if "ADD CONSTRAINT" in s]
    assert len(restored) == 1 and "openai_compatible" not in restored[0]


def test_up_admits_openai_compatible_and_pins_template_origins(pg_db):
    with transaction_scope() as session:
        assert COLUMNS <= _columns(session)
        assert [name for name, _ in _provider_checks(session)] == [
            "ai_provider_connections_openai_compatible_check",
            "ai_provider_connections_provider_check",
        ]
        for template, (origin, prefix) in V147_TEMPLATE_ORIGINS.items():
            _insert(
                session,
                template=template,
                endpoint=origin,
                path_prefix=prefix,
                model_manifest=MANIFEST,
            )
        _insert(
            session,
            template="custom",
            endpoint="http://10.0.0.5:8000",
            path_prefix="/v1",
            model_manifest=MANIFEST,
        )
        _insert(session, provider="ollama", endpoint="http://10.0.0.5:11434")
        _insert(session, provider="deepseek")

    moonshot, prefix = V147_TEMPLATE_ORIGINS["moonshot"]
    for values in (
        # A predefined template cannot move its origin or prefix.
        {
            "template": "moonshot",
            "endpoint": "https://evil.test",
            "path_prefix": prefix,
        },
        {"template": "moonshot", "endpoint": moonshot, "path_prefix": "/api/v1"},
        # A custom origin only uses the predefined prefixes.
        {"template": "custom", "endpoint": "https://llm.test", "path_prefix": "/x/v1"},
        {"template": "custom", "endpoint": None, "path_prefix": "/v1"},
        {"template": "custom", "endpoint": "https://llm.test", "path_prefix": None},
        {"template": None, "endpoint": "https://llm.test", "path_prefix": "/v1"},
        {"template": "azure", "endpoint": "https://llm.test", "path_prefix": "/v1"},
        # Its key is never an environment key.
        {
            "template": "custom",
            "endpoint": "https://llm.test",
            "path_prefix": "/v1",
            "secret_source": "environment",
        },
        # Other providers have no template, prefix or manifest.
        {"provider": "ollama", "endpoint": "http://h:1", "template": "custom"},
        {"provider": "ollama", "endpoint": "http://h:1", "path_prefix": "/v1"},
        {"provider": "deepseek", "model_manifest": MANIFEST},
        {"provider": "openai", "endpoint": "https://llm.test"},
        {
            "template": "custom",
            "endpoint": "https://llm.test",
            "path_prefix": "/v1",
            "model_manifest": MANIFEST * 51,
        },
    ):
        with pytest.raises(IntegrityError), transaction_scope() as session:
            _insert(session, **values)


def test_down_removes_unused_connections_and_restores_three_providers(
    pg_db, monkeypatch
):
    migration = import_module(MIGRATION)
    with transaction_scope() as session:
        before = _provider_checks(session)
        secret = session.execute(
            text(
                """
                INSERT INTO credential_secrets
                    (secret_ref, scope, ciphertext, created_at, updated_at)
                VALUES ('ai_test_ref', 'ai', 'opaque', NOW(), NOW())
                RETURNING secret_ref
                """
            )
        ).scalar_one()
        _moonshot(session, secret_source="stored", secret_ref=secret)
        kept = _insert(session, provider="ollama", endpoint="http://10.0.0.5:11434")

        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        migration.downgrade()

        assert not COLUMNS & _columns(session)
        checks = _provider_checks(session)
        assert [name for name, _ in checks] == [
            "ai_provider_connections_provider_check"
        ]
        assert "openai_compatible" not in checks[0][1]
        assert session.execute(
            text("SELECT array_agg(id::text) FROM ai_provider_connections")
        ).scalar_one() == [kept]
        assert (
            session.execute(
                text("SELECT count(*) FROM credential_secrets WHERE secret_ref = :ref"),
                {"ref": secret},
            ).scalar_one()
            == 0
        )
        with pytest.raises(IntegrityError), session.begin_nested():
            session.execute(
                text(
                    "INSERT INTO ai_provider_connections(label, provider) "
                    "VALUES ('Again', 'openai_compatible')"
                )
            )

        migration.upgrade()
        migration.upgrade()
        assert _provider_checks(session) == before
        _moonshot(session)


def test_down_refuses_connections_with_history(pg_db, monkeypatch):
    migration = import_module(MIGRATION)
    with transaction_scope() as session:
        connection = _moonshot(session)
        session.execute(
            text(
                "INSERT INTO ai_usage_daily(day, connection_id, invocation_kind, action_id) "
                "VALUES (CURRENT_DATE, CAST(:id AS uuid), 'probe', '')"
            ),
            {"id": connection},
        )
        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        with pytest.raises(InternalError, match="history remain"):
            with session.begin_nested():
                migration.downgrade()
        assert COLUMNS <= _columns(session)
