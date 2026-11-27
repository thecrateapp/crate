"""FED2: migration 169 creates and drops the federation summary tables."""

from __future__ import annotations

from importlib import import_module

from crate.db.schema_sections.federation_catalog_summaries_v169 import (
    create_federation_catalog_summaries_v169_schema,
    drop_federation_catalog_summaries_v169_schema,
)
from tests.test_agent_access_migration import RecordingExecutor

MIGRATION = "crate.db.migrations.versions.169_federation_catalog_summaries"


def test_migration_uses_the_immutable_schema_section(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_federation_catalog_summaries_v169_schema(section)

    assert migration.revision == "169" and migration.down_revision == "168"
    assert migrated.statements == section.statements
    assert any(
        "CREATE TABLE IF NOT EXISTS federation_catalog_summaries" in s
        for s in migrated.statements
    )
    assert any(
        "CREATE TABLE IF NOT EXISTS federation_peer_summaries" in s
        for s in migrated.statements
    )

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_federation_catalog_summaries_v169_schema(expected)
    assert downgrade.statements == expected.statements
    assert downgrade.statements == [
        "DROP TABLE IF EXISTS federation_peer_summaries",
        "DROP TABLE IF EXISTS federation_catalog_summaries",
    ]
