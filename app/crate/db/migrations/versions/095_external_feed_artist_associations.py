"""Track deterministic and AI-reviewed artist associations for feed items."""

from collections.abc import Sequence

from alembic import op


revision = "095"
down_revision = "094"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE external_feed_enrichments
            DROP CONSTRAINT IF EXISTS external_feed_enrichments_operation_check,
            ADD CONSTRAINT external_feed_enrichments_operation_check
                CHECK (operation IN (
                    'summary', 'cluster', 'classify', 'extract_show',
                    'associate_artist'
                ))
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_items
            ADD COLUMN IF NOT EXISTS artist_association_method TEXT
                CHECK (artist_association_method IN (
                    'source_artist',
                    'deterministic_title_match',
                    'deterministic_author_match',
                    'deterministic_excerpt_match',
                    'deterministic_url_match',
                    'deterministic_fuzzy_title_match',
                    'ai_review',
                    'manual'
                )),
            ADD COLUMN IF NOT EXISTS artist_association_confidence
                DOUBLE PRECISION CHECK (
                    artist_association_confidence IS NULL
                    OR artist_association_confidence BETWEEN 0 AND 1
                ),
            ADD COLUMN IF NOT EXISTS artist_associated_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS artist_associated_by_user_id BIGINT
                REFERENCES users(id) ON DELETE SET NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_external_feed_items_artist_state_date
        ON external_feed_items (
            artist_id, state, published_at DESC NULLS LAST, id DESC
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_external_feed_items_artist_state_date")
    op.execute(
        """
        ALTER TABLE external_feed_items
            DROP COLUMN IF EXISTS artist_associated_by_user_id,
            DROP COLUMN IF EXISTS artist_associated_at,
            DROP COLUMN IF EXISTS artist_association_confidence,
            DROP COLUMN IF EXISTS artist_association_method
        """
    )
    op.execute(
        """
        DELETE FROM external_feed_enrichments
        WHERE operation = 'associate_artist'
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_enrichments
            DROP CONSTRAINT IF EXISTS external_feed_enrichments_operation_check,
            ADD CONSTRAINT external_feed_enrichments_operation_check
                CHECK (operation IN ('summary', 'cluster', 'classify', 'extract_show'))
        """
    )
