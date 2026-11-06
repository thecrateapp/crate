"""Store the Smart Mix model outputs per track so later versions reuse them (SM3-D16)."""

from alembic import op

from crate.db.schema_sections.smart_mix_v150 import (
    create_smart_mix_track_signals_v150_schema,
)


revision = "150"
down_revision = "149"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_track_signals_v150_schema(op)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS track_mix_signals")
