"""Persist additive generation warnings for saved Music Paths."""

from alembic import op

revision = "140"
down_revision = "139"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE music_paths ADD COLUMN IF NOT EXISTS generation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE music_paths DROP COLUMN IF EXISTS generation_metadata")
