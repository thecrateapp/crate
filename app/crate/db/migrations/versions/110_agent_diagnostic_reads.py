"""Preserve snapshot invalidation and index bounded diagnostic reads."""

from alembic import op

revision = "110"
down_revision = "109"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE ui_snapshots ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ"
    )
    # Historical expiry cannot reliably distinguish invalidation; rebuild in background.
    op.execute(
        "UPDATE ui_snapshots SET invalidated_at = NOW() WHERE scope IN ('ops', 'ops:health')"
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_worker_logs_diagnostic_time ON worker_logs (created_at DESC, id DESC)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_diagnostic_time ON tasks (created_at DESC, id DESC)"
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_worker_logs_diagnostic_time")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_tasks_diagnostic_time")
    op.execute("ALTER TABLE ui_snapshots DROP COLUMN IF EXISTS invalidated_at")
