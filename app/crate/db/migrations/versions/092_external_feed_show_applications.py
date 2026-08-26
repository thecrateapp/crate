"""Track explicit application of reviewed external-feed show proposals."""

from collections.abc import Sequence

from alembic import op


revision = "092"
down_revision = "091"
branch_labels: Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE external_feed_enrichments
            ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS applied_by_user_id BIGINT
                REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS applied_show_ids JSONB NOT NULL
                DEFAULT '[]'::jsonb
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE external_feed_enrichments
            DROP COLUMN IF EXISTS applied_show_ids,
            DROP COLUMN IF EXISTS applied_by_user_id,
            DROP COLUMN IF EXISTS applied_at
        """
    )
