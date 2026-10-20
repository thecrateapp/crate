"""Add instance-wide daily listening rollups for the global stats explorer."""

from alembic import op

from crate.db.schema_sections.activity_v109 import (
    create_instance_listening_rollups_v109_schema,
)


revision = "109"
down_revision = "108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_instance_listening_rollups_v109_schema(op)
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_track_daily_day ON user_track_daily(day)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_entity_firsts_key ON user_entity_firsts(entity_type, entity_key)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX IF EXISTS idx_user_entity_firsts_key")
        op.execute("DROP INDEX IF EXISTS idx_user_track_daily_day")
    op.execute("DROP TABLE IF EXISTS instance_entity_firsts")
    op.execute("DROP TABLE IF EXISTS instance_track_daily")
