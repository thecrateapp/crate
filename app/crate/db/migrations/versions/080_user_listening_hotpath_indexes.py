"""Index deterministic global-track metadata fallbacks."""

from alembic import op


revision = "080"
down_revision = "079"
branch_labels = None
depends_on = None


INDEX_NAME = "idx_global_tracks_lower_artist_title_album"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            f"""
            CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX_NAME}
            ON global_catalog_tracks (
                LOWER(artist_name),
                LOWER(canonical_title),
                LOWER(COALESCE(album_name, ''))
            )
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX IF EXISTS idx_global_tracks_lower_artist_title_album")
