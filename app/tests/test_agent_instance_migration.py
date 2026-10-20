"""Revision 124 shares additive frozen DDL with fresh schema bootstrap."""

from importlib import import_module
import re

from alembic.migration import MigrationContext
from alembic.operations import Operations
from crate.agent_access import ALLOWED_GRANTS
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.agent_operations_v115 import (
    create_agent_operations_v115_schema,
)
from crate.db.tx import transaction_scope
from sqlalchemy import text

from tests.test_agent_access_migration import RecordingExecutor


def test_instance_migration_and_bootstrap_use_identical_additive_ddl(monkeypatch):
    migration = import_module(
        "crate.db.migrations.versions.124_agent_instance_operations"
    )
    migrated, section, bootstrap = (RecordingExecutor() for _ in range(3))
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_agent_operations_v115_schema(section)
    create_schema(bootstrap)

    assert (migration.revision, migration.down_revision) == ("124", "123")
    assert migrated.statements == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    ddl = " ".join(section.statements)
    for column in (
        "origin",
        "origin_principal_id",
        "origin_context",
        "required_grants",
        "retry_of",
        "retry_root",
        "retry_depth",
        "schedule_name",
        "cancellation_requested_at",
        "cancellation_acknowledged_at",
    ):
        assert f"ALTER TABLE tasks ADD COLUMN IF NOT EXISTS {column} " in ddl
    assert "CREATE TABLE IF NOT EXISTS agent_runtime_policy" in ddl
    assert "CREATE TABLE IF NOT EXISTS agent_runtime_adoptions" in ddl
    assert "WHERE j.task_id=t.id AND t.origin='unknown'" in ddl
    assert not any(
        statement.startswith(("DELETE", "DROP TABLE"))
        for statement in section.statements
    )


def test_instance_schema_grants_are_frozen_from_runtime_catalog(monkeypatch):
    before = RecordingExecutor()
    create_agent_operations_v115_schema(before)
    phase_five_grants = {
        "library.health.read",
        "ops.status.read",
        "ops.jobs.read",
        "ops.logs.read",
        "library.health.run",
        "library.repair.photo_flag",
        "ops.jobs.retry",
        "ops.jobs.cancel_pending",
        "library.quality.run",
        "library.repair.run",
        "library.metadata.write",
        "library.enrichment.run",
        "library.analysis.run",
        "library.sync.run",
        "library.metadata.export",
        "library.metadata.rehydrate",
        "ops.audit.read",
        "ops.jobs.manage_instance",
        "ops.jobs.cancel",
        "ops.schedules.read",
        "ops.schedules.run",
        "ops.schedules.write",
        "ops.runtime.read",
        "ops.runtime.write",
    }
    constraint = next(
        statement
        for statement in before.statements
        if "ADD CONSTRAINT agent_principals_grants_check" in statement
    )
    assert set(re.findall(r"'([^']+)'", constraint)) == phase_five_grants
    assert phase_five_grants <= ALLOWED_GRANTS

    monkeypatch.setattr(
        "crate.agent_access.ALLOWED_GRANTS", frozenset({"future.scope"})
    )
    monkeypatch.setattr("crate.agent_operation_catalog.OPERATIONS", {})
    after = RecordingExecutor()
    create_agent_operations_v115_schema(after)

    assert before.statements == after.statements
    assert "future.scope" not in " ".join(after.statements)


def test_instance_rollback_removes_dependents_before_restoring_previous_contract(
    monkeypatch,
):
    migration = import_module(
        "crate.db.migrations.versions.124_agent_instance_operations"
    )
    recorded = RecordingExecutor()
    monkeypatch.setattr(migration, "op", recorded)
    migration.downgrade()

    statements = recorded.statements
    cleanup = [statement for statement in statements if statement.startswith("DELETE")]
    assert cleanup[0].startswith("DELETE FROM agent_requests r USING agent_jobs j")
    assert cleanup[1].startswith("DELETE FROM agent_jobs WHERE")
    assert cleanup[2].startswith("DELETE FROM agent_repair_plans WHERE")
    assert (
        statements.index(cleanup[0])
        < statements.index(cleanup[1])
        < statements.index(cleanup[2])
    )
    for operation in (
        "job_retry",
        "job_cancel",
        "schedule_run",
        "schedule_update",
        "runtime_update",
    ):
        assert all(f"'{operation}'" in statement for statement in cleanup)
    quarantine = next(
        statement for statement in statements if statement.startswith("UPDATE tasks")
    )
    assert "manual_reconciliation_required" in quarantine
    assert statements.index(quarantine) < statements.index(cleanup[0])
    assert "DROP TABLE IF EXISTS agent_runtime_adoptions" in statements
    assert "DROP TABLE IF EXISTS agent_runtime_policy" in statements
    assert (
        "ALTER TABLE tasks DROP COLUMN IF EXISTS cancellation_requested_at"
        in statements
    )
    assert (
        "ALTER TABLE tasks DROP COLUMN IF EXISTS cancellation_acknowledged_at"
        in statements
    )
    assert not any(
        statement.startswith(
            (
                "DELETE FROM tasks",
                "DELETE FROM agent_principals",
                "DROP TABLE IF EXISTS agent_credentials",
            )
        )
        for statement in statements
    )
    disabled = next(
        index
        for index, statement in enumerate(statements)
        if "UPDATE agent_principals p SET enabled=FALSE" in statement
    )
    restored_constraint = next(
        index
        for index, statement in enumerate(statements)
        if "ADD CONSTRAINT agent_principals_grants_check" in statement
    )
    assert disabled < restored_constraint
    assert "'ops.runtime.write'" not in statements[restored_constraint]
    assert "'library.metadata.rehydrate'" in statements[restored_constraint]


def test_instance_real_rollback_preserves_library_work_and_credentials_then_reupgrades(
    pg_db,
    monkeypatch,
):
    from crate.db.engine import get_engine

    migration = import_module(
        "crate.db.migrations.versions.124_agent_instance_operations"
    )
    principal_id = "10000000-0000-0000-0000-000000000001"
    credential_id = "20000000-0000-0000-0000-000000000001"
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO agent_principals (id,name,grants) VALUES
            (:id,'Mixed operator',ARRAY['library.metadata.write','ops.runtime.write'])"""),
            {"id": principal_id},
        )
        session.execute(
            text("""INSERT INTO agent_credentials
            (id,principal_id,token_digest,expires_at)
            VALUES (:credential,:principal,:digest,NOW()+INTERVAL '1 day')"""),
            {
                "credential": credential_id,
                "principal": principal_id,
                "digest": "a" * 64,
            },
        )
        for task_id, operation, plan_id in (
            ("library-job", "metadata_update", "30000000-0000-0000-0000-000000000001"),
            ("instance-job", "runtime_update", "30000000-0000-0000-0000-000000000002"),
        ):
            session.execute(
                text("""INSERT INTO tasks
                (id,type,status,created_at,updated_at,cancellation_requested_at)
                VALUES (:id,:type,'running',NOW(),NOW(),NOW())"""),
                {
                    "id": task_id,
                    "type": "agent_control"
                    if operation == "runtime_update"
                    else "agent_operation_prepare",
                },
            )
            session.execute(
                text("""INSERT INTO agent_jobs
                (task_id,principal_id,credential_id,operation,payload,payload_hash,required_grants,retry_root)
                VALUES (:id,:principal,:credential,'prepare_operation',
                    jsonb_build_object('domain_operation',CAST(:operation AS text)),:hash,
                    ARRAY['library.metadata.write'],:id)"""),
                {
                    "id": task_id,
                    "principal": principal_id,
                    "credential": credential_id,
                    "operation": operation,
                    "hash": "b" * 64,
                },
            )
            session.execute(
                text("""INSERT INTO agent_requests
                (principal_id,operation,idempotency_key,payload_hash,task_id)
                VALUES (:principal,'prepare_operation',:id,:hash,:id)"""),
                {"principal": principal_id, "id": task_id, "hash": "b" * 64},
            )
            session.execute(
                text("""INSERT INTO agent_repair_plans
                (id,principal_id,version,operation,task_id)
                VALUES (:id,:principal,:version,:operation,:task)"""),
                {
                    "id": plan_id,
                    "principal": principal_id,
                    "version": "c" * 64,
                    "operation": operation,
                    "task": task_id,
                },
            )

    with get_engine().connect() as connection:
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))
        with context.begin_transaction():
            migration.downgrade()
        for table in ("agent_jobs", "agent_requests", "agent_repair_plans"):
            column = "task_id"
            assert connection.execute(
                text(f"SELECT {column} FROM {table}")
            ).scalars().all() == ["library-job"]
        principal = (
            connection.execute(
                text("SELECT enabled,grants FROM agent_principals WHERE id=:id"),
                {"id": principal_id},
            )
            .mappings()
            .one()
        )
        assert principal == {"enabled": False, "grants": ["library.metadata.write"]}
        assert (
            str(
                connection.execute(
                    text("SELECT id FROM agent_credentials")
                ).scalar_one()
            )
            == credential_id
        )
        assert dict(connection.execute(text("SELECT id,status FROM tasks")).all()) == {
            "library-job": "running",
            "instance-job": "failed",
        }
        assert (
            connection.execute(
                text("""SELECT result_json->'verification'->>'status'
            FROM tasks WHERE id='instance-job'""")
            ).scalar_one()
            == "manual_reconciliation_required"
        )
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_runtime_policy')")
            ).scalar_one()
            is None
        )
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_runtime_adoptions')")
            ).scalar_one()
            is None
        )
        assert (
            connection.execute(
                text("""SELECT COUNT(*) FROM information_schema.columns
            WHERE table_name='tasks' AND column_name='cancellation_requested_at'""")
            ).scalar_one()
            == 0
        )
        connection.rollback()
        with context.begin_transaction():
            migration.upgrade()
            migration.upgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_runtime_policy')")
            ).scalar_one()
            == "agent_runtime_policy"
        )
        assert (
            connection.execute(
                text("SELECT enabled FROM agent_principals WHERE id=:id"),
                {"id": principal_id},
            ).scalar_one()
            is False
        )
        assert (
            connection.execute(
                text("SELECT origin FROM tasks WHERE id='library-job'")
            ).scalar_one()
            == "agent"
        )
