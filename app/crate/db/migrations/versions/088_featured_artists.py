"""Add editorial featured-artist state and immutable catalog ordering."""

from alembic import op


revision = "088"
down_revision = "087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE library_artists
        ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE
        """
    )
    op.execute(
        """
        ALTER TABLE library_artists
        ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ
        """
    )

    # Existing rows do not have an authoritative insertion timestamp. Prefer
    # the oldest filesystem timestamp available from the artist's albums, then
    # fall back to the artist timestamps. New rows use the database default.
    op.execute(
        """
        UPDATE library_artists AS artist
        SET first_seen_at = to_timestamp(
            COALESCE(
                (
                    SELECT MIN(
                        COALESCE(
                            album.dir_mtime,
                            EXTRACT(EPOCH FROM album.updated_at)
                        )
                    )
                    FROM library_albums AS album
                    WHERE album.artist = artist.name
                ),
                artist.dir_mtime,
                EXTRACT(EPOCH FROM artist.updated_at),
                EXTRACT(EPOCH FROM NOW())
            )
        )
        WHERE artist.first_seen_at IS NULL
        """
    )
    op.execute(
        """
        ALTER TABLE library_artists
        ALTER COLUMN first_seen_at SET DEFAULT NOW()
        """
    )
    op.execute(
        """
        ALTER TABLE library_artists
        ALTER COLUMN first_seen_at SET NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_library_artists_first_seen
        ON library_artists(first_seen_at DESC, id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_library_artists_featured
        ON library_artists(is_featured)
        WHERE is_featured IS TRUE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_library_artists_featured")
    op.execute("DROP INDEX IF EXISTS idx_library_artists_first_seen")
    op.execute("ALTER TABLE library_artists DROP COLUMN IF EXISTS first_seen_at")
    op.execute("ALTER TABLE library_artists DROP COLUMN IF EXISTS is_featured")
