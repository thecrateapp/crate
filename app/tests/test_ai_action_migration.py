"""Migration 145 admits the error inbox AI actions and keeps the existing ones."""

import re
from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.ai.actions import ACTIONS
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.ai_action_error_inbox_v145 import (
    V145_ACTIONS_SQL,
    V145_NEW_ACTIONS,
    create_ai_action_error_inbox_v145_schema,
    drop_ai_action_error_inbox_v145_schema,
)
from crate.db.tx import transaction_scope
from tests.test_agent_access_migration import RecordingExecutor, SessionExecutor

MIGRATION = "crate.db.migrations.versions.145_ai_action_error_inbox"
TABLES = (
    "ai_action_bindings",
    "ai_invocations",
    "ai_usage_daily",
    "ai_legacy_invocation_receipts",
)
EXISTING = sorted(set(ACTIONS) - set(V145_NEW_ACTIONS))
# The list revision 145 wrote; later revisions widen it (151: Smart Mix refinement).
V145_ACTIONS = re.findall(r"'([^']+)'", V145_ACTIONS_SQL)


def _action_checks(session) -> dict[str, tuple[str, bool]]:
    rows = session.execute(
        text(
            """
            SELECT conrelid::regclass::text AS table_name, conname, convalidated
            FROM pg_constraint
            WHERE contype = 'c'
              AND conrelid = ANY(CAST(:tables AS regclass[]))
              AND position('action_id' in pg_get_constraintdef(oid)) > 0
            """
        ),
        {"tables": list(TABLES)},
    ).mappings()
    checks: dict[str, tuple[str, bool]] = {}
    for row in rows:
        assert row["table_name"] not in checks, "one action CHECK per table"
        checks[row["table_name"]] = (row["conname"], row["convalidated"])
    return checks


def _check_count(session, table: str) -> int:
    return session.execute(
        text(
            "SELECT count(*) FROM pg_constraint "
            "WHERE contype = 'c' AND conrelid = CAST(:table AS regclass)"
        ),
        {"table": table},
    ).scalar_one()


def _profile(session) -> tuple[str, str]:
    connection = session.execute(
        text(
            "INSERT INTO ai_provider_connections(label, provider) "
            "VALUES ('Migration test', 'ollama') RETURNING id::text"
        )
    ).scalar_one()
    profile = session.execute(
        text(
            "INSERT INTO ai_profiles(label) VALUES ('Migration test') RETURNING id::text"
        )
    ).scalar_one()
    session.execute(
        text(
            """
            INSERT INTO ai_profile_versions
                (profile_id, version, connection_id, model_id, config, fingerprint)
            VALUES (CAST(:profile AS uuid), 1, CAST(:connection AS uuid), 'model',
                    '{}'::jsonb, repeat('a', 64))
            """
        ),
        {"profile": profile, "connection": connection},
    )
    return connection, profile


def _use(session, action_id: str, connection: str, profile: str, key: str) -> None:
    params = {
        "action": action_id,
        "connection": connection,
        "profile": profile,
        "key": key,
    }
    session.execute(
        text(
            "INSERT INTO ai_action_bindings(action_id, profile_id, profile_version) "
            "VALUES (:action, CAST(:profile AS uuid), 1)"
        ),
        params,
    )
    session.execute(
        text(
            """
            INSERT INTO ai_invocations
                (idempotency_key, connection_id, action_id, model_id,
                 reserved_tokens, charged_tokens)
            VALUES (:key, CAST(:connection AS uuid), :action, 'model', 0, 0)
            """
        ),
        params,
    )
    session.execute(
        text(
            "INSERT INTO ai_usage_daily(day, connection_id, action_id) "
            "VALUES (CURRENT_DATE, CAST(:connection AS uuid), :action)"
        ),
        params,
    )
    session.execute(
        text(
            """
            INSERT INTO ai_legacy_invocation_receipts
                (idempotency_key, action_id, provider, model_id)
            VALUES (:key, :action, 'litellm', 'model')
            """
        ),
        params,
    )


def _count(session, table: str, action_id: str) -> int:
    return session.execute(
        text(f"SELECT count(*) FROM {table} WHERE action_id = :action"),
        {"action": action_id},
    ).scalar_one()


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_ai_action_error_inbox_v145_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "145" and migration.down_revision == "144"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)
    assert joined.index("CREATE TABLE IF NOT EXISTS ai_action_bindings") < (
        joined.index(section.statements[0])
    )
    added = [s for s in section.statements if "ADD CONSTRAINT" in s]
    assert len(added) == len(TABLES)
    for statement in added:
        for action_id in V145_ACTIONS:
            assert f"'{action_id}'" in statement
        assert "NOT VALID" not in statement

    downgrade = RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    expected = RecordingExecutor()
    drop_ai_action_error_inbox_v145_schema(expected)
    assert downgrade.statements == expected.statements
    for statement in (s for s in downgrade.statements if "ADD CONSTRAINT" in s):
        assert "'ops.error.triage'" not in statement
        assert "'ops.error.investigate'" not in statement
        assert "'i18n.listen.draft'" in statement


def test_migration_accepts_new_actions_and_keeps_existing(pg_db):
    with transaction_scope() as session:
        checks = _action_checks(session)
        assert checks == {
            "ai_action_bindings": ("ai_action_bindings_action_id_check", True),
            "ai_invocations": ("ai_invocations_action_id_check", True),
            "ai_usage_daily": ("ai_usage_daily_action_id_check", True),
            "ai_legacy_invocation_receipts": (
                "ai_legacy_invocation_receipts_action_id_check",
                True,
            ),
        }
        connection, profile = _profile(session)
        for index, action_id in enumerate(sorted(ACTIONS)):
            _use(session, action_id, connection, profile, f"key-{index}")
        for table in TABLES:
            assert session.execute(
                text(f"SELECT count(DISTINCT action_id) FROM {table}")
            ).scalar_one() == len(ACTIONS)

    for table, sql in (
        (
            "ai_action_bindings",
            "INSERT INTO ai_action_bindings(action_id, profile_id, profile_version) "
            "SELECT 'ops.error.fix', id, 1 FROM ai_profiles LIMIT 1",
        ),
        (
            "ai_usage_daily",
            "INSERT INTO ai_usage_daily(day, connection_id, action_id) "
            "SELECT CURRENT_DATE, id, 'ops.error.fix' FROM ai_provider_connections LIMIT 1",
        ),
    ):
        with pytest.raises(IntegrityError), transaction_scope() as session:
            session.execute(text(sql))


def test_downgrade_restores_the_previous_list_and_keeps_history(pg_db, monkeypatch):
    migration = import_module(MIGRATION)
    with transaction_scope() as session:
        before = {table: _check_count(session, table) for table in TABLES}
        connection, profile = _profile(session)
        _use(session, "ops.error.triage", connection, profile, "triage-key")
        _use(session, "genres.eq.propose", connection, profile, "eq-key")

        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        migration.downgrade()

        assert {table: _check_count(session, table) for table in TABLES} == before
        checks = _action_checks(session)
        assert checks["ai_action_bindings"][1] is True
        assert not any(
            checks[table][1] for table in TABLES if table != "ai_action_bindings"
        )
        assert _count(session, "ai_action_bindings", "ops.error.triage") == 0
        assert _count(session, "ai_action_bindings", "genres.eq.propose") == 1
        for table in TABLES[1:]:
            assert _count(session, table, "ops.error.triage") == 1
        with pytest.raises(IntegrityError), session.begin_nested():
            session.execute(
                text(
                    "INSERT INTO ai_usage_daily(day, connection_id, action_id) "
                    "VALUES (CURRENT_DATE - 1, CAST(:connection AS uuid), "
                    "'ops.error.investigate')"
                ),
                {"connection": connection},
            )

        migration.upgrade()
        migration.upgrade()

        assert {table: _check_count(session, table) for table in TABLES} == before
        assert all(valid for _, valid in _action_checks(session).values())
        _use(session, "ops.error.investigate", connection, profile, "again-key")
