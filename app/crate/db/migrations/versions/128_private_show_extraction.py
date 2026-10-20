"""Private show extraction reuses common jobs and durable acceptance."""

from alembic import op
from crate.db.schema_sections.show_extraction_v119 import (
    create_show_extraction_v119_schema,
    PREVIOUS_OPERATIONS,
)

revision = "128"
down_revision = "127"
branch_labels = None
depends_on = None


def upgrade():
    create_show_extraction_v119_schema(op)


def downgrade():
    op.execute("""UPDATE tasks SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE 'failed' END,error='Extraction disabled by rollback',updated_at=NOW()
      WHERE type='show_extract' AND status IN ('pending','running','delegated','completing')""")
    op.execute("DELETE FROM agent_requests WHERE operation='extract_shows'")
    op.execute("DELETE FROM agent_jobs WHERE operation='extract_shows'")
    op.execute("DELETE FROM show_extraction_drafts")
    op.execute("DROP TABLE IF EXISTS show_image_uploads")
    op.execute("DROP INDEX IF EXISTS idx_show_extraction_drafts_actor")
    for table in ("agent_jobs", "agent_requests"):
        op.execute(
            f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_operation_check"
        )
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {table}_operation_check CHECK(operation IN ({PREVIOUS_OPERATIONS}))"
        )
