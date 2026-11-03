"""Store daily product KPIs and index play events for day-bounded scans."""

from alembic import op

from crate.db.schema_sections.product_kpis_v142 import (
    create_product_kpi_daily_v142_schema,
)

revision = "142"
down_revision = "141"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_product_kpi_daily_v142_schema(op)
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_play_events_created_brin "
            "ON user_play_events USING brin (created_at)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS idx_user_play_events_created_brin"
        )
    op.execute("DROP TABLE IF EXISTS product_kpi_daily")
