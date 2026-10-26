"""Record each provider's answer on a scrobble dispatch."""

from alembic import op


revision = "137"
down_revision = "136"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE user_scrobble_dispatches
            ADD COLUMN IF NOT EXISTS provider_results JSONB NOT NULL DEFAULT '{}'::jsonb
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE user_scrobble_dispatches DROP COLUMN IF EXISTS provider_results"
    )
