"""Persist delegated MCP OAuth clients, consent and rotating credentials."""

from alembic import op
from crate.db.schema_sections.mcp_oauth_v112 import create_mcp_oauth_v112_schema

revision = "121"
down_revision = "120"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_mcp_oauth_v112_schema(op)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mcp_oauth_tokens")
    op.execute("DROP TABLE IF EXISTS mcp_oauth_codes")
    op.execute("DROP TABLE IF EXISTS mcp_oauth_consents")
    op.execute(
        "UPDATE agent_credentials SET revoked_at = NOW() WHERE principal_id IN (SELECT principal_id FROM mcp_oauth_authorizations)"
    )
    op.execute(
        "UPDATE agent_principals SET enabled = FALSE WHERE id IN (SELECT principal_id FROM mcp_oauth_authorizations)"
    )
    op.execute("DROP TABLE IF EXISTS mcp_oauth_authorizations")
    op.execute("DROP TABLE IF EXISTS mcp_oauth_clients")
    op.execute("ALTER TABLE agent_principals DROP COLUMN IF EXISTS kind")
