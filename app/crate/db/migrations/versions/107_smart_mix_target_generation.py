"""Record which analyzer generation a Smart Mix processing claim targets."""

from alembic import op

from crate.db.schema_sections.smart_mix_v107 import (
    create_smart_mix_target_generation_v107_schema,
)


revision = "107"
down_revision = "106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_target_generation_v107_schema(op)


def downgrade() -> None:
    op.execute(
        "ALTER TABLE track_processing_state DROP COLUMN IF EXISTS target_generation"
    )
