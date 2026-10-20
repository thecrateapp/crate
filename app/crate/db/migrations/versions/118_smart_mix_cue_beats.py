"""Store beat stability and the bar downbeat measured at each Smart Mix cue."""

from alembic import op

from crate.db.schema_sections.smart_mix_v118 import (
    create_smart_mix_cue_beats_v118_schema,
)


revision = "118"
down_revision = "117"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_cue_beats_v118_schema(op)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE track_mix_profiles
            DROP COLUMN IF EXISTS intro_tempo_stability,
            DROP COLUMN IF EXISTS outro_tempo_stability,
            DROP COLUMN IF EXISTS intro_downbeat_ms,
            DROP COLUMN IF EXISTS outro_downbeat_ms
        """
    )
