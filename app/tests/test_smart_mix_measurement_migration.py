from __future__ import annotations

from pathlib import Path

from crate.db.schema_sections.smart_mix_v106 import (
    create_smart_mix_measurement_v106_schema,
)

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "crate/db/migrations/versions/106_smart_mix_measurement_provenance.py"
)
PROVENANCE_COLUMNS = (
    "duration_ms",
    "active_start_ms",
    "active_end_ms",
    "integrated_lufs",
    "measurement_version",
)


class RecordingExecutor:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(" ".join(str(statement).split()))


def test_measurement_migration_follows_access_tokens() -> None:
    source = MIGRATION.read_text()

    assert 'revision = "106"' in source
    assert 'down_revision = "105"' in source
    assert "create_smart_mix_measurement_v106_schema(op)" in source


def test_measurement_columns_are_additive_and_nullable() -> None:
    executor = RecordingExecutor()

    create_smart_mix_measurement_v106_schema(executor)

    ddl = "\n".join(executor.statements)
    for column in PROVENANCE_COLUMNS:
        assert f"ADD COLUMN IF NOT EXISTS {column} " in ddl
    assert "NOT NULL" not in ddl
    assert "UPDATE" not in ddl.upper().split("ALTER TABLE")[0]


def test_bootstrap_schema_creates_the_measurement_columns() -> None:
    source = (
        Path(__file__).resolve().parents[1]
        / "crate/db/schema_sections/library_catalog.py"
    ).read_text()

    assert "create_smart_mix_measurement_v106_schema(cur)" in source
