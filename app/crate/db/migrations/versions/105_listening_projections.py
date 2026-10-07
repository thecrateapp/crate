"""Per-day listening projections maintained incrementally from dirty days."""

from alembic import op

from crate.db.schema_sections.activity_v105 import (
    create_listening_projections_v105_schema,
)


revision = "105"
down_revision = "104"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_listening_projections_v105_schema(op)


def downgrade() -> None:
    for table in (
        "user_listening_sessions",
        "user_entity_firsts",
        "user_track_daily",
        "user_hourly_listening",
        "user_listening_dirty_days",
        "user_listening_projection_state",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
