"""Phase 6 schema uses the next head and shares fresh-install DDL."""

from importlib import import_module
from contextlib import nullcontext

from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.editorial_v116 import create_editorial_v116_schema
from tests.test_agent_access_migration import RecordingExecutor


def test_editorial_migration_matches_fresh_bootstrap(monkeypatch):
    migration = import_module("crate.db.migrations.versions.116_editorial_playlists")
    migrated, section, bootstrap = (RecordingExecutor() for _ in range(3))
    migrated.get_context = lambda: type(
        "Context", (), {"autocommit_block": staticmethod(nullcontext)}
    )()
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_editorial_v116_schema(section)
    create_schema(bootstrap)
    assert (migration.revision, migration.down_revision) == ("116", "115")
    assert migrated.statements[:-1] == section.statements[:-1]
    assert (
        migrated.statements[-1].replace(" CONCURRENTLY", "") == section.statements[-1]
    )
    assert all(statement in bootstrap.statements for statement in section.statements)
    ddl = " ".join(section.statements)
    assert "editorial_revision" in ddl
    assert "playlist_refinement_proposals" in ddl
    assert "editorial.publish" in ddl
    assert "idx_audit_playlist_editorial_history" in ddl
