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


def test_v109_creates_instance_rollups_and_indexes(monkeypatch):
    migration, section = _replay(
        "109_instance_listening_rollups",
        "activity_v109",
        "create_instance_listening_rollups_v109_schema",
        monkeypatch,
    )
    assert migration == section
    assert len(migration) == 4
    statements = "\n".join(migration)
    assert "CREATE TABLE IF NOT EXISTS instance_track_daily" in statements
    assert "PRIMARY KEY (day, entity_key, artist, album)" in statements
    assert "listener_count INTEGER NOT NULL DEFAULT 0" in statements
    assert "user_id" not in migration[0]
    assert "CREATE TABLE IF NOT EXISTS instance_entity_firsts" in statements
    assert "PRIMARY KEY (entity_type, entity_key)" in statements
    assert (
        "CREATE INDEX IF NOT EXISTS idx_user_track_daily_day ON user_track_daily(day)"
        in migration
    )
    assert (
        "CREATE INDEX IF NOT EXISTS idx_user_entity_firsts_key ON user_entity_firsts(entity_type, entity_key)"
        in migration
    )
