"""Restore the cosine index required by revision 027."""

from alembic import op
from sqlalchemy import text

revision = "139"
down_revision = "138"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        connection = op.get_bind()
        invalid = connection.execute(
            text("""
                SELECT NOT (indisvalid AND indisready)
                FROM pg_index
                WHERE indexrelid = to_regclass(
                    'idx_library_tracks_bliss_embedding_cosine_hnsw'
                )
            """)
        ).scalar()
        if invalid:
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "idx_library_tracks_bliss_embedding_cosine_hnsw"
            )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_tracks_bliss_embedding_cosine_hnsw
            ON library_tracks USING hnsw (bliss_embedding vector_cosine_ops)
            WHERE bliss_embedding IS NOT NULL
            """
        )
        healthy = connection.execute(
            text("""
                SELECT indisvalid AND indisready
                FROM pg_index
                WHERE indexrelid = to_regclass(
                    'idx_library_tracks_bliss_embedding_cosine_hnsw'
                )
            """)
        ).scalar()
        if not healthy:
            raise RuntimeError("The Bliss cosine index is not valid and ready")


def downgrade() -> None:
    # Revision 027 owns the index; rolling back its repair must preserve that schema.
    pass
