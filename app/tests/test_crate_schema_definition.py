"""Contract tests for the Crates schema DDL source."""

from importlib import import_module
from pathlib import Path

from alembic.script import ScriptDirectory

from crate.db.schema_sections.curation_crates import create_crates_schema


class RecordingExecutor:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(" ".join(statement.split()))


def test_crate_migration_uses_the_bootstrap_schema_definition(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.099_listen_crates")
    revision_schema = import_module("crate.db.schema_sections.crates_v099")
    migration_executor = RecordingExecutor()
    revision_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    revision_schema.create_crates_v099_schema(revision_executor)

    assert migration_executor.statements == revision_executor.statements


def test_crate_presentation_migration_uses_its_schema_definition(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.100_crate_presentation")
    revision_schema = import_module("crate.db.schema_sections.crates_v100")
    migration_executor = RecordingExecutor()
    revision_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    revision_schema.create_crates_v100_schema(revision_executor)

    assert migration_executor.statements == revision_executor.statements


def test_crate_followers_migration_creates_follow_table(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.101_crate_followers")
    executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", executor)

    migration.upgrade()

    statements = "\n".join(executor.statements)
    assert "CREATE TABLE IF NOT EXISTS crate_followers" in statements
    assert "followed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" in statements
    assert "PRIMARY KEY (crate_id, user_id)" in statements
    assert "ON crate_followers(user_id, followed_at DESC)" in statements
    assert "crate_likes" not in statements


def test_crate_short_code_migration_uses_its_schema_definition(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.102_crate_short_codes")
    revision_schema = import_module("crate.db.schema_sections.crates_v102")
    migration_executor = RecordingExecutor()
    revision_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    revision_schema.create_crates_v102_schema(revision_executor)

    assert migration_executor.statements == revision_executor.statements
    statements = "\n".join(migration_executor.statements)
    assert "ADD COLUMN IF NOT EXISTS short_code TEXT" in statements
    assert "WHERE short_code IS NULL" in statements
    assert "ALTER COLUMN short_code SET NOT NULL" in statements
    assert "CREATE UNIQUE INDEX IF NOT EXISTS idx_crates_short_code" in statements
    assert statements.index("WHERE short_code IS NULL") < statements.index(
        "SET NOT NULL"
    )


def test_crate_migration_follows_the_current_main_head() -> None:
    migrations_path = (
        Path(__file__).resolve().parents[1] / "crate" / "db" / "migrations"
    )
    scripts = ScriptDirectory(str(migrations_path))

    assert scripts.get_revision("098").down_revision == "097"
    assert scripts.get_revision("099").down_revision == "098"
    assert scripts.get_revision("100").down_revision == "099"
    assert scripts.get_revision("101").down_revision == "100"
    assert scripts.get_revision("102").down_revision == "101"
    assert scripts.get_revision("103").down_revision == "102"
    assert scripts.get_revision("104").down_revision == "103"
    assert scripts.get_revision("105").down_revision == "104"
    assert scripts.get_heads() == ["105"]


def test_crate_bootstrap_includes_presentation_settings() -> None:
    executor = RecordingExecutor()

    create_crates_schema(executor)

    statements = "\n".join(executor.statements)
    assert "is_ordered" in statements
    assert "sort_direction" in statements
    assert "loop_enabled" in statements
