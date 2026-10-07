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
