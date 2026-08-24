"""Track reversible applications of reviewed external-feed clusters."""

from collections.abc import Sequence

from alembic import op


revision = "093"
down_revision = "092"
branch_labels: Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE external_feed_enrichments
            ADD COLUMN IF NOT EXISTS cluster_applied_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS cluster_applied_by_user_id BIGINT
                REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS cluster_applied_item_ids JSONB NOT NULL
                DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS cluster_reverted_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS cluster_reverted_by_user_id BIGINT
                REFERENCES users(id) ON DELETE SET NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE external_feed_enrichments
            DROP COLUMN IF EXISTS cluster_reverted_by_user_id,
            DROP COLUMN IF EXISTS cluster_reverted_at,
            DROP COLUMN IF EXISTS cluster_applied_item_ids,
            DROP COLUMN IF EXISTS cluster_applied_by_user_id,
            DROP COLUMN IF EXISTS cluster_applied_at
        """
    )
