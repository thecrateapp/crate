"""Keep how a track's bar length was chosen with its stored model beats."""

from alembic import op

from crate.db.schema_sections.smart_mix_meter_signals_v161 import (
    create_smart_mix_meter_signals_v161_schema,
)


revision = "161"
down_revision = "160"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_meter_signals_v161_schema(op)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE track_mix_signals
            DROP COLUMN IF EXISTS meter_arbiter,
            DROP COLUMN IF EXISTS meter_margin
        """
    )
