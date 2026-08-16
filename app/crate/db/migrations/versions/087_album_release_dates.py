"""Store canonical public release dates for local albums."""

from alembic import op


revision = "087"
down_revision = "086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE library_albums ADD COLUMN IF NOT EXISTS release_date TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE library_albums DROP COLUMN IF EXISTS release_date")
