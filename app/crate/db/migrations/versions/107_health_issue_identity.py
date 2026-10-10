"""Give health issues a stable identity, entity links and per-check run times."""

from alembic import op

from crate.db.schema_sections.health_v107 import (
    create_health_issue_identity_v107_schema,
)


revision = "107"
down_revision = "106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_health_issue_identity_v107_schema(op)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS health_check_runs")
    op.execute("DROP INDEX IF EXISTS idx_health_issues_open_artist")
    op.execute("DROP INDEX IF EXISTS idx_health_issues_dismissed_identity")
    op.execute("DROP INDEX IF EXISTS idx_health_issues_open_identity")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_health_issues_dedup "
        "ON health_issues (check_type, md5(description)) WHERE status = 'open'"
    )
    for column in ("last_seen_at", "album_id", "artist_id", "identity_key"):
        op.execute(f"ALTER TABLE health_issues DROP COLUMN IF EXISTS {column}")
