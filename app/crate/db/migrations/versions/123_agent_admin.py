"""Integration policies and exact human approvals of agent plans."""

from alembic import op
from crate.db.schema_sections.agent_admin_v113 import create_agent_admin_v113_schema

revision = "123"
down_revision = "122"
branch_labels = None
depends_on = None


def upgrade():
    create_agent_admin_v113_schema(op, include_index=False)
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_audit_activity ON audit_log ((details_json->>'principal_id'), timestamp DESC, id DESC)"
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_agent_audit_activity")
    op.execute("DROP TABLE IF EXISTS agent_plan_approvals")
    op.execute(
        "UPDATE agent_repair_plans SET state = 'conflict' WHERE state IN ('awaiting_approval','authorized','running','rejected')"
    )
    op.execute(
        "ALTER TABLE agent_repair_plans DROP CONSTRAINT IF EXISTS agent_repair_plans_state_check"
    )
    op.execute(
        "ALTER TABLE agent_repair_plans ADD CONSTRAINT agent_repair_plans_state_check CHECK (state IN ('ready','queued','applied','conflict','failed','cancelled'))"
    )
    for column in ("authorization_context", "policy_revision", "approval_required"):
        op.execute(f"ALTER TABLE agent_repair_plans DROP COLUMN IF EXISTS {column}")
    op.execute("ALTER TABLE agent_jobs DROP COLUMN IF EXISTS authorization_context")
    op.execute("ALTER TABLE agent_principals DROP COLUMN IF EXISTS policy_revision")
    op.execute("ALTER TABLE agent_principals DROP COLUMN IF EXISTS require_approval")
