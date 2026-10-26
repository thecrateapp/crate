"""Native Telegram exact-plan confirmation."""

from alembic import op
from crate.db.schema_sections.agent_telegram_v133 import (
    create_agent_telegram_v133_schema,
)

revision = "133"
down_revision = "132"
branch_labels = None
depends_on = None


def upgrade():
    create_agent_telegram_v133_schema(op)


def downgrade():
    op.execute(
        "ALTER TABLE agent_plan_approvals DROP COLUMN IF EXISTS telegram_binding_id"
    )
    op.execute("DROP TABLE IF EXISTS agent_telegram_receipts")
    op.execute("DROP TABLE IF EXISTS agent_telegram_confirmations")
    op.execute("DROP TABLE IF EXISTS agent_telegram_bindings")
