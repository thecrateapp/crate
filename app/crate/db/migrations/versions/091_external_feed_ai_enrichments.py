"""Store reviewable AI enrichments for external feed items."""

from collections.abc import Sequence

from alembic import op


revision = "091"
down_revision = "090"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS external_feed_enrichments (
            id BIGSERIAL PRIMARY KEY,
            item_id BIGINT NOT NULL REFERENCES
                external_feed_items(id) ON DELETE CASCADE,
            operation TEXT NOT NULL
                CHECK (operation IN ('summary', 'cluster', 'classify', 'extract_show')),
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'ready', 'failed', 'rejected', 'stale')),
            review_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (review_status IN ('pending', 'accepted', 'rejected')),
            source_content_hash TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT 'English',
            result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            model TEXT,
            prompt_version TEXT NOT NULL,
            error TEXT,
            reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMPTZ,
            rejection_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (item_id, operation, source_content_hash, language)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_external_feed_enrichments_review
        ON external_feed_enrichments (
            status, review_status, updated_at DESC, id DESC
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_external_feed_enrichments_item
        ON external_feed_enrichments (item_id, operation, id DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_external_feed_enrichments_item")
    op.execute("DROP INDEX IF EXISTS idx_external_feed_enrichments_review")
    op.execute("DROP TABLE IF EXISTS external_feed_enrichments")
