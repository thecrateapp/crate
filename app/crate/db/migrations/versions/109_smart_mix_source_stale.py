"""Mark mix profiles whose analysed source no longer matches the library file."""

from alembic import op

from crate.db.schema_sections.smart_mix_v109 import (
    create_smart_mix_source_stale_v109_schema,
)


revision = "109"
down_revision = "108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_source_stale_v109_schema(op)


def downgrade() -> None:
    op.execute("ALTER TABLE track_mix_profiles DROP COLUMN IF EXISTS source_stale_at")
