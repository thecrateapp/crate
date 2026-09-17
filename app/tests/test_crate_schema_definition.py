"""Contract tests for the Crates schema DDL source."""

from importlib import import_module

from crate.db.schema_sections.curation_crates import create_crates_schema


class RecordingExecutor:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(" ".join(statement.split()))


def test_crate_migration_uses_the_bootstrap_schema_definition(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.090_listen_crates")
    migration_executor = RecordingExecutor()
    bootstrap_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    create_crates_schema(bootstrap_executor)

    assert migration_executor.statements == bootstrap_executor.statements
