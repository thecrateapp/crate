"""Store the Smart Mix 3 structure (phrases, energy curve, voice, confidence)."""

from alembic import op

from crate.db.schema_sections.smart_mix_v147 import (
    create_smart_mix_structure_v147_schema,
)


revision = "147"
down_revision = "146"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_structure_v147_schema(op)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE track_mix_profiles
            DROP COLUMN IF EXISTS phrases,
            DROP COLUMN IF EXISTS energy_curve,
            DROP COLUMN IF EXISTS vocal_presence,
            DROP COLUMN IF EXISTS structure_confidence
        """
    )
