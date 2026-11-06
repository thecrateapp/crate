"""Record which model gave the Smart Mix beats and downbeats (SM3-D14)."""

from alembic import op

from crate.db.schema_sections.smart_mix_v149 import (
    create_smart_mix_beat_tracker_v149_schema,
)


revision = "149"
down_revision = "148"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_beat_tracker_v149_schema(op)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE track_mix_profiles
            DROP COLUMN IF EXISTS beat_tracker
        """
    )
