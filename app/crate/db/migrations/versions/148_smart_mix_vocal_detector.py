"""Record which detector computed the Smart Mix per-phrase voice (SM3-D13)."""

from alembic import op

from crate.db.schema_sections.smart_mix_v148 import (
    create_smart_mix_vocal_detector_v148_schema,
)


revision = "148"
down_revision = "147"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_vocal_detector_v148_schema(op)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE track_mix_profiles
            DROP COLUMN IF EXISTS vocal_detector
        """
    )
