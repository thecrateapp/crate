from __future__ import annotations

from pathlib import Path

from sqlalchemy import text

from crate.db.tx import read_scope


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT / "app/crate/db/migrations/versions/072_reusable_federation_stream_sessions.py"
)


def test_stream_session_migration_replaces_one_shot_ticket_state():
    source = MIGRATION.read_text()

    assert 'revision = "072"' in source
    assert 'down_revision = "071"' in source
    assert "ADD COLUMN IF NOT EXISTS first_authorized_at TIMESTAMPTZ" in source
    assert "last_authorized_at TIMESTAMPTZ" in source
    assert "authorization_count INTEGER NOT NULL DEFAULT 0" in source


def test_stream_session_schema_tracks_reusable_authorizations(pg_db):
    del pg_db
    with read_scope() as session:
        columns = {
            row["column_name"]
            for row in session.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'federation_stream_tickets'
                    """
                )
            )
            .mappings()
            .all()
        }

    assert {
        "used_at",
        "first_authorized_at",
        "last_authorized_at",
        "authorization_count",
    } <= columns
