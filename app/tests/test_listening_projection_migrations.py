"""Migrations 104 and 105 replay their schema sections verbatim."""

from importlib import import_module


class RecordingExecutor:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(" ".join(statement.split()))


def _replay(module_name: str, section_name: str, builder: str, monkeypatch):
    migration = import_module(f"crate.db.migrations.versions.{module_name}")
    section = import_module(f"crate.db.schema_sections.{section_name}")
    migration_executor = RecordingExecutor()
    section_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)
    migration.upgrade()
    getattr(section, builder)(section_executor)
    return migration_executor.statements, section_executor.statements


def test_user_timezone_migration_adds_a_nullable_column(monkeypatch):
    migration, section = _replay(
        "104_user_timezone",
        "auth_v104",
        "create_users_timezone_v104_schema",
        monkeypatch,
    )
    assert migration == section
    assert migration == ["ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT"]


def test_listening_projection_migration_creates_every_projection(monkeypatch):
    migration, section = _replay(
        "105_listening_projections",
        "activity_v105",
        "create_listening_projections_v105_schema",
        monkeypatch,
    )
    assert migration == section
    statements = "\n".join(migration)
    for table in (
        "user_listening_projection_state",
        "user_listening_dirty_days",
        "user_hourly_listening",
        "user_track_daily",
        "user_entity_firsts",
        "user_listening_sessions",
    ):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in statements


def test_pulse_listed_migration_defaults_users_into_the_ranking(monkeypatch):
    migration, section = _replay(
        "106_user_pulse_listed",
        "auth_v106",
        "create_users_pulse_listed_v106_schema",
        monkeypatch,
    )
    assert migration == section
    assert migration == [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS pulse_listed BOOLEAN NOT NULL DEFAULT TRUE"
    ]


def test_health_identity_migration_matches_its_schema_section(monkeypatch):
    migration, section = _replay(
        "107_health_issue_identity",
        "health_v107",
        "create_health_issue_identity_v107_schema",
        monkeypatch,
    )
    assert migration == section
    joined = "\n".join(migration)
    assert "DROP INDEX IF EXISTS idx_health_issues_dedup" in joined
    assert "idx_health_issues_open_identity" in joined
    assert "CREATE TABLE IF NOT EXISTS health_check_runs" in joined


def test_v135_creates_instance_rollups_and_indexes(monkeypatch):
    from contextlib import nullcontext

    migration = import_module(
        "crate.db.migrations.versions.135_instance_listening_rollups"
    )
    assert migration.revision == "135"
    assert migration.down_revision == "134"
    section = import_module("crate.db.schema_sections.activity_v132")
    executor = RecordingExecutor()
    blocks: list[int] = []

    class Context:
        def autocommit_block(self):
            blocks.append(len(executor.statements))
            return nullcontext()

    executor.get_context = lambda: Context()
    monkeypatch.setattr(migration, "op", executor)
    migration.upgrade()
    section_executor = RecordingExecutor()
    section.create_instance_listening_rollups_v132_schema(section_executor)

    # Section (tables + indexes on the new empty tables) replays verbatim first.
    assert executor.statements[: len(section_executor.statements)] == (
        section_executor.statements
    )
    statements = "\n".join(section_executor.statements)
    assert "CREATE TABLE IF NOT EXISTS instance_track_daily" in statements
    assert "PRIMARY KEY (day, entity_key, artist, album)" in statements
    assert "listener_count INTEGER NOT NULL DEFAULT 0" in statements
    assert "user_id" not in section_executor.statements[0]
    assert "CREATE TABLE IF NOT EXISTS instance_entity_firsts" in statements
    assert "PRIMARY KEY (entity_type, entity_key)" in statements
    assert (
        "CREATE INDEX IF NOT EXISTS idx_instance_entity_firsts_recent "
        "ON instance_entity_firsts(entity_type, first_day DESC)"
    ) in section_executor.statements
    # Indexes on the large existing tables are built concurrently, outside a transaction.
    concurrent = executor.statements[len(section_executor.statements) :]
    assert concurrent == [
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_track_daily_day ON user_track_daily(day)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_entity_firsts_key ON user_entity_firsts(entity_type, entity_key)",
    ]
    assert blocks == [len(section_executor.statements)]


def test_instance_rollup_bootstrap_matches_its_schema_section():
    from crate.db.schema_sections.activity import create_activity_schema
    from crate.db.schema_sections.activity_v132 import (
        create_instance_listening_rollups_v132_schema,
    )

    bootstrap = RecordingExecutor()
    section = RecordingExecutor()
    create_activity_schema(bootstrap)
    create_instance_listening_rollups_v132_schema(section)
    assert bootstrap.statements[-len(section.statements) :] == section.statements


def test_v135_downgrade_removes_only_instance_rollups_and_its_indexes(monkeypatch):
    from contextlib import nullcontext

    migration = import_module(
        "crate.db.migrations.versions.135_instance_listening_rollups"
    )
    executor = RecordingExecutor()
    executor.get_context = lambda: type(
        "Context", (), {"autocommit_block": lambda self: nullcontext()}
    )()
    monkeypatch.setattr(migration, "op", executor)
    migration.downgrade()
    assert executor.statements == [
        "DROP INDEX IF EXISTS idx_user_entity_firsts_key",
        "DROP INDEX IF EXISTS idx_user_track_daily_day",
        "DROP TABLE IF EXISTS instance_entity_firsts",
        "DROP TABLE IF EXISTS instance_track_daily",
    ]
