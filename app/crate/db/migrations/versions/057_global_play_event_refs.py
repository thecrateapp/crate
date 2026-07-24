"""Global catalog refs for play events.

Revision ID: 057
Revises: 056
"""

from collections.abc import Sequence

from alembic import op


revision = "057"
down_revision = "056"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE user_play_events ADD COLUMN IF NOT EXISTS global_track_uid UUID"
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_play_events_global_track_uid
        ON user_play_events(global_track_uid)
        WHERE global_track_uid IS NOT NULL
        """
    )
    op.execute(
        "ALTER TABLE user_track_stats ADD COLUMN IF NOT EXISTS global_track_uid UUID"
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_track_stats_global_track_uid
        ON user_track_stats(global_track_uid)
        WHERE global_track_uid IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_user_track_stats_global_track_uid")
    op.execute("ALTER TABLE user_track_stats DROP COLUMN IF EXISTS global_track_uid")
    op.execute("DROP INDEX IF EXISTS idx_user_play_events_global_track_uid")
    op.execute("ALTER TABLE user_play_events DROP COLUMN IF EXISTS global_track_uid")
