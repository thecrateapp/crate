"""Migration 151 admits the Smart Mix refinement action (SM4.PR1)."""

from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.ai.actions import ACTIONS
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.ai_action_error_inbox_v145 import (
    create_ai_action_error_inbox_v145_schema,
)
from crate.db.schema_sections.ai_action_smart_mix_refine_v151 import (
    V151_NEW_ACTIONS,
    create_ai_action_smart_mix_refine_v151_schema,
    drop_ai_action_smart_mix_refine_v151_schema,
)
from crate.db.tx import transaction_scope
from tests.test_agent_access_migration import RecordingExecutor, SessionExecutor
from tests.test_ai_action_migration import (
    TABLES,
    _action_checks,
    _check_count,
    _count,
    _profile,
    _use,
)

MIGRATION = "crate.db.migrations.versions.151_ai_action_smart_mix_refine"
REFINE = "smart_mix.transition.refine"


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap, previous = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_ai_action_smart_mix_refine_v151_schema(section)
    create_schema(bootstrap)
    create_ai_action_error_inbox_v145_schema(previous)

    assert V151_NEW_ACTIONS == (REFINE,)
    assert migration.revision == "151" and migration.down_revision == "150"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)
    # Bootstrap widens the CHECKs after revision 145 wrote them.
    assert joined.rindex(previous.statements[-1]) < joined.rindex(
        section.statements[-1]
    )
    added = [s for s in section.statements if "ADD CONSTRAINT" in s]
    assert len(added) == len(TABLES)
    for statement in added:
        for action_id in ACTIONS:
            assert f"'{action_id}'" in statement
        assert "NOT VALID" not in statement

    downgrade = RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    expected = RecordingExecutor()
    drop_ai_action_smart_mix_refine_v151_schema(expected)
    assert downgrade.statements == expected.statements
    for statement in (s for s in downgrade.statements if "ADD CONSTRAINT" in s):
        assert f"'{REFINE}'" not in statement
        assert "'ops.error.triage'" in statement
        assert "'i18n.listen.draft'" in statement


def test_migration_admits_the_refine_action(pg_db):
    with transaction_scope() as session:
        assert all(valid for _, valid in _action_checks(session).values())
        connection, profile = _profile(session)
        _use(session, REFINE, connection, profile, "refine-key")
        for table in TABLES:
            assert _count(session, table, REFINE) == 1

    with pytest.raises(IntegrityError), transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO ai_action_bindings(action_id, profile_id, profile_version) "
                "SELECT 'smart_mix.transition.write', id, 1 FROM ai_profiles LIMIT 1"
            )
        )


def test_downgrade_restores_the_previous_list_and_keeps_history(pg_db, monkeypatch):
    migration = import_module(MIGRATION)
    with transaction_scope() as session:
        before = {table: _check_count(session, table) for table in TABLES}
        connection, profile = _profile(session)
        _use(session, REFINE, connection, profile, "refine-key")
        _use(session, "ops.error.triage", connection, profile, "triage-key")

        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        migration.downgrade()

        assert {table: _check_count(session, table) for table in TABLES} == before
        checks = _action_checks(session)
        assert checks["ai_action_bindings"][1] is True
        assert not any(
            checks[table][1] for table in TABLES if table != "ai_action_bindings"
        )
        assert _count(session, "ai_action_bindings", REFINE) == 0
        assert _count(session, "ai_action_bindings", "ops.error.triage") == 1
        for table in TABLES[1:]:
            assert _count(session, table, REFINE) == 1
        with pytest.raises(IntegrityError), session.begin_nested():
            session.execute(
                text(
                    "INSERT INTO ai_usage_daily(day, connection_id, action_id) "
                    "VALUES (CURRENT_DATE - 1, CAST(:connection AS uuid), :action)"
                ),
                {"connection": connection, "action": REFINE},
            )

        migration.upgrade()
        migration.upgrade()

        assert {table: _check_count(session, table) for table in TABLES} == before
        assert all(valid for _, valid in _action_checks(session).values())
        # The action is admitted again (fresh connection: one usage row per day).
        _use(session, REFINE, *_profile(session), "again-key")
