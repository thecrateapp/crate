from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import PG_AVAILABLE


class RecordingExecutor:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(" ".join(statement.split()))


def test_collaboration_migration_replays_its_schema_section(monkeypatch):
    migration = import_module(
        "crate.db.migrations.versions.108_collaboration_visibility"
    )
    section = import_module("crate.db.schema_sections.collaboration_v108")
    migration_executor = RecordingExecutor()
    section_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    section.create_collaboration_visibility_v108_schema(section_executor)

    assert migration_executor.statements == section_executor.statements
    statements = "\n".join(migration_executor.statements)
    assert "playlists_visibility_check" in statements
    assert "UPDATE playlist_invites SET expires_at = NOW()" in statements
    assert "UPDATE crate_invites SET expires_at = NOW()" in statements


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_playlist_visibility_only_accepts_private_or_public(pg_db):
    from crate.db.tx import transaction_scope

    with pytest.raises(IntegrityError, match="playlists_visibility_check"):
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO playlists (name, user_id, scope, visibility, created_at, updated_at)
                    VALUES ('Bad visibility', 1, 'user', 'unlisted', NOW(), NOW())
                    """
                )
            )
