"""Add case-folded global catalog lookup indexes.

Revision ID: 075
Revises: 074
"""

from collections.abc import Sequence

from alembic import op


revision = "075"
down_revision = "074"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_catalog_artists_lower_canonical_name
        ON global_catalog_artists (LOWER(canonical_name))
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_catalog_albums_lower_artist_name
        ON global_catalog_albums (LOWER(artist_name), LOWER(canonical_name))
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_global_catalog_albums_lower_artist_name")
    op.execute("DROP INDEX IF EXISTS idx_global_catalog_artists_lower_canonical_name")
