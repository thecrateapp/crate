"""Add missing trigram indexes for library search.

Revision ID: 044
Revises: 043
"""

from typing import Sequence, Union

from alembic import op


revision: str = "044"
down_revision: Union[str, None] = "043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _run_concurrently(statement: str) -> None:
    with op.get_context().autocommit_block():
        op.execute(statement)


def upgrade() -> None:
    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_albums_artist_trgm "
        "ON library_albums USING gin(artist gin_trgm_ops)"
    )
    _run_concurrently(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracks_artist_trgm "
        "ON library_tracks USING gin(artist gin_trgm_ops)"
    )


def downgrade() -> None:
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_tracks_artist_trgm")
    _run_concurrently("DROP INDEX CONCURRENTLY IF EXISTS idx_albums_artist_trgm")
