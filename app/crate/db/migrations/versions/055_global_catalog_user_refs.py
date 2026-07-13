"""Global catalog user references.

Revision ID: 055
Revises: 054
"""

from collections.abc import Sequence

from alembic import op


revision = "055"
down_revision = "054"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_global_artist_follows (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            global_artist_uid UUID NOT NULL
                REFERENCES global_catalog_artists(global_artist_uid)
                ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, global_artist_uid)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_global_artist_follows_artist
        ON user_global_artist_follows(global_artist_uid)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_global_album_saves (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            global_album_uid UUID NOT NULL
                REFERENCES global_catalog_albums(global_album_uid)
                ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, global_album_uid)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_global_album_saves_album
        ON user_global_album_saves(global_album_uid)
        """
    )

    op.execute(
        "ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS global_track_uid UUID"
    )
    op.execute("ALTER TABLE playlist_tracks ALTER COLUMN track_path DROP NOT NULL")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_global_track_uid
        ON playlist_tracks(global_track_uid)
        WHERE global_track_uid IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_playlist_tracks_global_track_uid")
    op.execute("ALTER TABLE playlist_tracks DROP COLUMN IF EXISTS global_track_uid")
    op.execute("UPDATE playlist_tracks SET track_path = '' WHERE track_path IS NULL")
    op.execute("ALTER TABLE playlist_tracks ALTER COLUMN track_path SET NOT NULL")
    op.execute("DROP INDEX IF EXISTS idx_user_global_album_saves_album")
    op.execute("DROP TABLE IF EXISTS user_global_album_saves")
    op.execute("DROP INDEX IF EXISTS idx_user_global_artist_follows_artist")
    op.execute("DROP TABLE IF EXISTS user_global_artist_follows")
