"""Add stable public short codes to Crates."""

from alembic import op

from crate.db.schema_sections.crates_v102 import create_crates_v102_schema


revision = "102"
down_revision = "101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_crates_v102_schema(op)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_crates_short_code")
    op.execute("ALTER TABLE crates DROP COLUMN IF EXISTS short_code")
