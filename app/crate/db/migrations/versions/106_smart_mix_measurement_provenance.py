"""Persist decoder duration and loudness measurement provenance for mix profiles."""

from alembic import op

from crate.db.schema_sections.smart_mix_v106 import (
    create_smart_mix_measurement_v106_schema,
)


revision = "106"
down_revision = "105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_measurement_v106_schema(op)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE track_mix_profiles
            DROP COLUMN IF EXISTS measurement_version,
            DROP COLUMN IF EXISTS integrated_lufs,
            DROP COLUMN IF EXISTS active_end_ms,
            DROP COLUMN IF EXISTS active_start_ms,
            DROP COLUMN IF EXISTS duration_ms
        """
    )
