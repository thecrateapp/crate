"""Contract tests for the Crates schema DDL source."""

from importlib import import_module

from alembic.script import ScriptDirectory

from crate.db.schema_sections.curation_crates import create_crates_schema


class RecordingExecutor:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(" ".join(statement.split()))


def test_crate_migration_uses_the_bootstrap_schema_definition(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.091_listen_crates")
    migration_executor = RecordingExecutor()
    bootstrap_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    create_crates_schema(bootstrap_executor)

    assert migration_executor.statements == bootstrap_executor.statements


def test_crate_migration_follows_main_without_duplicate_revision_ids() -> None:
    scripts = ScriptDirectory("app/crate/db/migrations")

    assert scripts.get_revision("090").path.endswith(
        "090_dirty_source_retry_backoff.py"
    )
    assert scripts.get_revision("091").down_revision == "090"
    assert scripts.get_heads() == ["091"]
