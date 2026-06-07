"""Add smart playlist track override metadata.

Revision ID: 046
Revises: 045
"""

from typing import Sequence, Union

from alembic import op


revision: str = "046"
down_revision: Union[str, None] = "045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'"
    )
    op.execute(
        "ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_source_locked
        ON playlist_tracks(playlist_id, source, locked)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS playlist_track_exclusions (
            id BIGSERIAL PRIMARY KEY,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_entity_uid UUID,
            track_storage_id UUID,
            track_path TEXT,
            reason TEXT NOT NULL DEFAULT 'removed',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_track_exclusions_identity
        ON playlist_track_exclusions(
            playlist_id,
            COALESCE(track_entity_uid::text, ''),
            COALESCE(track_storage_id::text, ''),
            COALESCE(track_path, ''),
            COALESCE(track_id::text, '')
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_playlist_track_exclusions_identity")
    op.execute("DROP TABLE IF EXISTS playlist_track_exclusions")
    op.execute("DROP INDEX IF EXISTS idx_playlist_tracks_source_locked")
    op.execute("ALTER TABLE playlist_tracks DROP COLUMN IF EXISTS locked")
    op.execute("ALTER TABLE playlist_tracks DROP COLUMN IF EXISTS source")
