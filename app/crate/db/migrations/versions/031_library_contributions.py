"""Track user contributions to the shared library.

Revision ID: 031
Revises: 030
"""

from typing import Sequence, Union

from alembic import op


revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS library_contributions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source TEXT NOT NULL,
            source_ref TEXT NOT NULL,
            album_id INTEGER REFERENCES library_albums(id) ON DELETE SET NULL,
            album_entity_uid UUID,
            artist_name TEXT NOT NULL DEFAULT '',
            album_name TEXT NOT NULL DEFAULT '',
            track_entity_uids UUID[] DEFAULT '{}',
            metadata_json JSONB DEFAULT '{}'::jsonb,
            status TEXT NOT NULL DEFAULT 'active',
            imported_at TIMESTAMPTZ NOT NULL,
            withdrawn_at TIMESTAMPTZ,
            UNIQUE(user_id, source, source_ref)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_library_contributions_album
        ON library_contributions(album_id, status)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_library_contributions_user
        ON library_contributions(user_id, status, imported_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_library_contributions_user")
    op.execute("DROP INDEX IF EXISTS idx_library_contributions_album")
    op.execute("DROP TABLE IF EXISTS library_contributions")
