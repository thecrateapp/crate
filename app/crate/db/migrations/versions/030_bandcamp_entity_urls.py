"""Persist denormalized Bandcamp entity URLs.

Revision ID: 030
Revises: 029
"""

from typing import Sequence, Union

from alembic import op


revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE library_artists
        ADD COLUMN IF NOT EXISTS bandcamp_url TEXT,
        ADD COLUMN IF NOT EXISTS bandcamp_url_source TEXT,
        ADD COLUMN IF NOT EXISTS bandcamp_url_updated_at TIMESTAMPTZ
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_library_artists_bandcamp_url
        ON library_artists(bandcamp_url)
        WHERE bandcamp_url IS NOT NULL
    """)

    op.execute("""
        ALTER TABLE library_albums
        ADD COLUMN IF NOT EXISTS bandcamp_url TEXT,
        ADD COLUMN IF NOT EXISTS bandcamp_url_source TEXT,
        ADD COLUMN IF NOT EXISTS bandcamp_url_updated_at TIMESTAMPTZ
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_library_albums_bandcamp_url
        ON library_albums(bandcamp_url)
        WHERE bandcamp_url IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_library_albums_bandcamp_url")
    op.execute("DROP INDEX IF EXISTS idx_library_artists_bandcamp_url")
    op.execute("""
        ALTER TABLE library_albums
        DROP COLUMN IF EXISTS bandcamp_url_updated_at,
        DROP COLUMN IF EXISTS bandcamp_url_source,
        DROP COLUMN IF EXISTS bandcamp_url
    """)
    op.execute("""
        ALTER TABLE library_artists
        DROP COLUMN IF EXISTS bandcamp_url_updated_at,
        DROP COLUMN IF EXISTS bandcamp_url_source,
        DROP COLUMN IF EXISTS bandcamp_url
    """)
