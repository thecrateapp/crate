"""Revision 124 is additive and has an ordered rollback to the shipped contract."""

from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.agent_library_v114 import create_agent_library_v114_schema

from tests.agent_command_fixtures import observed_plan
from tests.test_agent_access_migration import RecordingExecutor

pytest_plugins = ["tests.agent_command_fixtures"]

LIBRARY_V114_GRANTS = {
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
}


def test_library_migration_and_bootstrap_use_identical_frozen_ddl(monkeypatch):
    migration = import_module(
        "crate.db.migrations.versions.124_agent_library_operations"
    )
    migrated, section, bootstrap = (RecordingExecutor() for _ in range(3))
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_agent_library_v114_schema(section)
    create_schema(bootstrap)

    assert (migration.revision, migration.down_revision) == ("124", "123")
    assert migrated.statements == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    assert any("effect_started_at" in statement for statement in section.statements)
    assert any(
        "to_regclass('track_processing_state')" in statement
        for statement in section.statements
    )
    assert any("agent_artifacts" in statement for statement in section.statements)
    before = list(section.statements)
    monkeypatch.setattr(
        "crate.agent_access.ALLOWED_GRANTS", frozenset({"future.scope"})
    )
    frozen = RecordingExecutor()
    create_agent_library_v114_schema(frozen)
    assert frozen.statements == before
    assert "future.scope" not in " ".join(frozen.statements)
    assert all(
        f"'{scope}'" in " ".join(frozen.statements) for scope in LIBRARY_V114_GRANTS
    )


def test_library_migration_rollback_preserves_legacy_photo_plans_and_removes_new_jobs(
    command_world, monkeypatch
):
    from crate.db.engine import get_engine
    from crate.db.repositories import agent_operation_jobs as jobs
    from crate.db.repositories.tasks_updates import start_task

    world = command_world
    old_job, old_plan = observed_plan(world)
    generic_job = jobs.prepare_operation(
        world["principal"],
        "metadata_update",
        {"entity_uid": "10000000-0000-0000-0000-000000000001"},
        "prepare",
    )
    start_task(generic_job["job_id"])
    prepared = jobs.publish_plan(
        generic_job["job_id"],
        {
            "document": {
                "operation": "metadata_update",
                "targets": [
                    {
                        "entity_type": "artist",
                        "entity_uid": "10000000-0000-0000-0000-000000000001",
                    }
                ],
                "changes": [{"field": "bio", "after": "New"}],
                "risk": "safe",
            },
            "execution": {
                "target_keys": ["artist:10000000-0000-0000-0000-000000000001"]
            },
        },
    )
    migration = import_module(
        "crate.db.migrations.versions.124_agent_library_operations"
    )
    instance_migration = import_module(
        "crate.db.migrations.versions.125_agent_instance_operations"
    )

    with get_engine().connect() as connection:
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))
        monkeypatch.setattr(instance_migration, "op", Operations(context))
        with context.begin_transaction():
            instance_migration.downgrade()
            migration.downgrade()
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM agent_jobs WHERE task_id=:id"),
                {"id": old_job["job_id"]},
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM agent_repair_plans WHERE id=:id"),
                {"id": old_plan["plan_id"]},
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM agent_repair_plans WHERE id=:id"),
                {"id": prepared["plan"]["plan_id"]},
            ).scalar_one()
            == 0
        )
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM agent_jobs WHERE task_id=:id"),
                {"id": generic_job["job_id"]},
            ).scalar_one()
            == 0
        )
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_artifacts')")
            ).scalar_one()
            is None
        )
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='agent_jobs' AND column_name='target_keys'"
                )
            ).scalar_one()
            == 0
        )
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='track_processing_state' AND column_name='generation'"
                )
            ).scalar_one()
            == 0
        )
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM agent_credentials WHERE id=:id"),
                {"id": world["principal"].credential_id},
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text("SELECT enabled FROM agent_principals WHERE id=:id"),
                {"id": world["principal"].id},
            ).scalar_one()
            is False
        )
        assert set(
            connection.execute(
                text("SELECT grants FROM agent_principals WHERE id=:id"),
                {"id": world["principal"].id},
            ).scalar_one()
        ) <= {
            "library.health.read",
            "ops.status.read",
            "ops.jobs.read",
            "ops.logs.read",
            "library.health.run",
            "library.repair.photo_flag",
            "ops.jobs.retry",
            "ops.jobs.cancel_pending",
        }
        connection.rollback()
        for _ in range(2):
            with context.begin_transaction():
                migration.upgrade()
                instance_migration.upgrade()
        assert (
            connection.execute(
                text("SELECT to_regclass('agent_artifacts')")
            ).scalar_one()
            == "agent_artifacts"
        )
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='agent_jobs' AND column_name='effect_started_at'"
                )
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='track_processing_state' AND column_name='generation'"
                )
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text("SELECT operation FROM agent_repair_plans WHERE id=:id"),
                {"id": old_plan["plan_id"]},
            ).scalar_one()
            == "repair_photo_flag"
        )
