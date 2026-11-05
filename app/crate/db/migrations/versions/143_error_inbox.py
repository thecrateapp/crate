"""Error inbox tables: synced Sentry issues and their triage results."""

from alembic import op

from crate.db.schema_sections.error_inbox_v143 import create_error_inbox_v143_schema

revision = "143"
down_revision = "142"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_error_inbox_v143_schema(op)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS error_issue_triage")
    op.execute("DROP TABLE IF EXISTS error_issues")
