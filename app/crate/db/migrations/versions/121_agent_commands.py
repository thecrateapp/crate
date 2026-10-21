"""Durable idempotency, evidence and exact plans for bounded agent commands."""

from alembic import op
from crate.db.schema_sections.agent_commands_v111 import (
    create_agent_commands_v111_schema,
)

revision = "121"
down_revision = "120"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_agent_commands_v111_schema(op)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agent_repair_plans")
    op.execute("DROP TABLE IF EXISTS agent_photo_observations")
    op.execute("DROP TABLE IF EXISTS agent_requests")
    op.execute("DROP TABLE IF EXISTS agent_jobs")
    # Retain identities but disable any integration whose action grants are removed.
    op.execute("""
        UPDATE agent_principals SET enabled = FALSE,
            grants = CASE WHEN cardinality(ARRAY(
                SELECT grant_name FROM unnest(grants) grant_name
                WHERE grant_name = ANY(ARRAY['library.health.read','ops.status.read','ops.jobs.read','ops.logs.read'])
            )) = 0 THEN ARRAY['library.health.read']::TEXT[] ELSE ARRAY(
                SELECT grant_name FROM unnest(grants) grant_name
                WHERE grant_name = ANY(ARRAY['library.health.read','ops.status.read','ops.jobs.read','ops.logs.read'])
            ) END
        WHERE NOT grants <@ ARRAY['library.health.read','ops.status.read','ops.jobs.read','ops.logs.read']::TEXT[]
    """)
    op.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    op.execute("""
        ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check CHECK (
            cardinality(grants) > 0 AND array_position(grants, NULL) IS NULL
            AND grants <@ ARRAY['library.health.read','ops.status.read','ops.jobs.read','ops.logs.read']::TEXT[]
        )
    """)
