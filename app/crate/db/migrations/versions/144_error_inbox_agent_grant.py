"""Allow the `ops.errors.read` MCP grant for the error inbox tools."""

from alembic import op

from crate.db.schema_sections.error_inbox_grant_v144 import (
    create_error_inbox_grant_v144_schema,
    drop_error_inbox_grant_v144_schema,
)

revision = "144"
down_revision = "143"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_error_inbox_grant_v144_schema(op)


def downgrade() -> None:
    # Fails transactionally until every `ops.errors.read` grant has been revoked.
    drop_error_inbox_grant_v144_schema(op)
