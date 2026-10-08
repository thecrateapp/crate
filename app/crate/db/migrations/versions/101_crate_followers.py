"""Allow users to follow public Crates."""

from alembic import op


revision = "101"
down_revision = "100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS crate_followers (
            crate_id UUID NOT NULL REFERENCES crates(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            followed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (crate_id, user_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_crate_followers_user_followed
        ON crate_followers(user_id, followed_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS crate_followers")
