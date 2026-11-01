"""Persist absolute metric minute snapshots without legacy accumulation."""

from alembic import op

from crate.db.schema_sections.metric_minutes_v141 import (
    create_metric_minute_snapshots_v141_schema,
)

revision = "141"
down_revision = "140"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_metric_minute_snapshots_v141_schema(op)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS metric_minute_snapshots")
    op.execute(
        "DELETE FROM settings WHERE key IN ('metrics_v2_cutover_at', 'metrics_v2_collection_state', 'metrics_v2_retention_state')"
    )
