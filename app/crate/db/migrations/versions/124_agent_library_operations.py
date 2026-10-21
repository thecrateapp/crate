"""Shared library operations and generation-bound analysis claims."""

from alembic import op

from crate.db.schema_sections.agent_library_v114 import create_agent_library_v114_schema

revision = "124"
down_revision = "123"
branch_labels = None
depends_on = None


def upgrade():
    create_agent_library_v114_schema(op)


def downgrade():
    op.execute("DROP TABLE IF EXISTS admin_repair_preparations")
    # Preserve historic photo jobs/plans; newer operation records cannot run on 123.
    op.execute(
        "DELETE FROM agent_requests WHERE operation IN ('prepare_operation','apply_operation')"
    )
    op.execute("DROP TABLE IF EXISTS agent_artifacts")
    op.execute(
        "DELETE FROM agent_jobs WHERE operation IN ('prepare_operation','apply_operation')"
    )
    op.execute("DELETE FROM agent_repair_plans WHERE operation <> 'repair_photo_flag'")
    for column in ("generation", "claim_token", "pipeline_signature"):
        op.execute(f"ALTER TABLE track_processing_state DROP COLUMN IF EXISTS {column}")
    for column in (
        "document",
        "execution_data",
        "operation",
        "mandatory_approval",
        "required_grants",
    ):
        op.execute(f"ALTER TABLE agent_repair_plans DROP COLUMN IF EXISTS {column}")
    for column in ("target_keys", "effect_started_at"):
        op.execute(f"ALTER TABLE agent_jobs DROP COLUMN IF EXISTS {column}")
    for column in (
        "artist_uid",
        "issue_id",
        "observation_id",
        "before_value",
        "after_value",
    ):
        op.execute(f"ALTER TABLE agent_repair_plans ALTER COLUMN {column} SET NOT NULL")
    op.execute("ALTER TABLE agent_jobs ALTER COLUMN artist_uid SET NOT NULL")
    for table, operations in (
        ("agent_jobs", "'run_health_check','apply_repairs'"),
        ("agent_requests", "'run_health_check','apply_repairs','retry_job'"),
    ):
        op.execute(
            f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_operation_check"
        )
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {table}_operation_check CHECK (operation IN ({operations}))"
        )
    op.execute("""WITH legacy AS (
        SELECT ARRAY['library.health.read','ops.status.read','ops.jobs.read','ops.logs.read',
            'library.health.run','library.repair.photo_flag','ops.jobs.retry','ops.jobs.cancel_pending']::text[] AS scopes
        ) UPDATE agent_principals SET enabled=FALSE,
        grants=CASE WHEN grants && legacy.scopes THEN ARRAY(SELECT g FROM unnest(grants) g WHERE g=ANY(legacy.scopes))
                    ELSE ARRAY['library.health.read']::text[] END
        FROM legacy WHERE NOT grants <@ legacy.scopes""")
    from crate.db.schema_sections.agent_commands_v111 import (
        create_agent_commands_v111_schema,
    )
    from crate.db.schema_sections.agent_admin_v113 import create_agent_admin_v113_schema

    create_agent_commands_v111_schema(op)
    create_agent_admin_v113_schema(op, include_index=False)
