"""Add dedicated, bounded remote-agent principals and opaque credentials."""

from alembic import op
from crate.db.schema_sections.agent_access_v109 import create_agent_access_v109_schema

revision = "118"
down_revision = "117"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_agent_access_v109_schema(op)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agent_credentials")
    op.execute("DROP TABLE IF EXISTS agent_principals")
