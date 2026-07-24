"""Complete trigram coverage for local-library search.

Revision ID: 071
Revises: 070
"""

from collections.abc import Sequence

from alembic import op


revision = "071"
down_revision = "070"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _run_concurrently(statement: str) -> None:
    with op.get_context().autocommit_block():
        op.execute(statement)


def upgrade() -> None:
    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_artists_name_trgm "
        "ON library_artists USING gin(name gin_trgm_ops)"
    )
    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_albums_name_trgm "
        "ON library_albums USING gin(name gin_trgm_ops)"
    )
    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracks_title_trgm "
        "ON library_tracks USING gin(title gin_trgm_ops)"
    )
    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracks_album_trgm "
        "ON library_tracks USING gin(album gin_trgm_ops)"
    )


def downgrade() -> None:
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_tracks_album_trgm")
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_tracks_title_trgm")
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_albums_name_trgm")
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_artists_name_trgm")
