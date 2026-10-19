"""Store the local tempo and beat reference around each Smart Mix cue."""

from alembic import op

from crate.db.schema_sections.smart_mix_v117 import (
    create_smart_mix_local_tempo_v117_schema,
)


revision = "117"
down_revision = "116"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_local_tempo_v117_schema(op)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE track_mix_profiles
            DROP COLUMN IF EXISTS intro_bpm,
            DROP COLUMN IF EXISTS intro_beat_ms,
            DROP COLUMN IF EXISTS outro_bpm,
            DROP COLUMN IF EXISTS outro_beat_ms
        """
    )
