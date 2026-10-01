"""Add Crate presentation and playback settings."""

from alembic import op

from crate.db.schema_sections.crates_v100 import create_crates_v100_schema


revision = "100"
down_revision = "099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_crates_v100_schema(op)


def downgrade() -> None:
    op.execute("ALTER TABLE crates DROP COLUMN IF EXISTS loop_enabled")
    op.execute(
        "ALTER TABLE crates DROP CONSTRAINT IF EXISTS crates_sort_direction_check"
    )
    op.execute("ALTER TABLE crates DROP COLUMN IF EXISTS sort_direction")
    op.execute("ALTER TABLE crates DROP COLUMN IF EXISTS is_ordered")
