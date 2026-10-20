"""Audited instance controls, cooperative cancellation and runtime policies."""

from alembic import op

from crate.db.schema_sections.agent_operations_v115 import (
    create_agent_operations_v115_schema,
)

revision = "125"
down_revision = "124"
branch_labels = None
depends_on = None


def upgrade():
    create_agent_operations_v115_schema(op)


def downgrade():
    operations = (
        "('job_retry','job_cancel','schedule_run','schedule_update','runtime_update')"
    )
    op.execute("""UPDATE tasks SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE 'failed' END,
        error='Instance operation disabled by schema rollback; reconcile any effects',
        result_json=COALESCE(result_json,'{}'::jsonb)||'{"verification": {"status": "manual_reconciliation_required"}}'::jsonb,
        heartbeat_at=NULL,worker_id=NULL,updated_at=NOW()
        WHERE status IN ('pending','running','delegated','completing') AND
          (type='agent_control' OR (origin='agent' AND required_grants &&
            ARRAY['ops.jobs.manage_instance','ops.jobs.cancel','ops.schedules.run','ops.schedules.write','ops.runtime.write']::text[]))""")
    op.execute(f"""DELETE FROM agent_requests r USING agent_jobs j
        WHERE r.task_id=j.task_id AND j.payload->>'domain_operation' IN {operations}""")
    op.execute(
        f"DELETE FROM agent_jobs WHERE payload->>'domain_operation' IN {operations}"
    )
    op.execute(f"DELETE FROM agent_repair_plans WHERE operation IN {operations}")
    op.execute("DROP TABLE IF EXISTS agent_runtime_adoptions")
    op.execute("DROP TABLE IF EXISTS agent_runtime_policy")
    for column in (
        "origin",
        "actor_user_id",
        "origin_principal_id",
        "origin_context",
        "required_grants",
        "retry_of",
        "retry_root",
        "retry_depth",
        "schedule_name",
        "cancellation_requested_at",
        "cancellation_actor_user_id",
        "cancellation_principal_id",
        "cancellation_acknowledged_at",
    ):
        op.execute(f"ALTER TABLE tasks DROP COLUMN IF EXISTS {column}")
    op.execute("""WITH old AS (
        SELECT ARRAY['library.health.read','ops.status.read','ops.jobs.read','ops.logs.read',
            'library.health.run','library.repair.photo_flag','ops.jobs.retry','ops.jobs.cancel_pending',
            'library.quality.run','library.repair.run','library.metadata.write','library.enrichment.run',
            'library.analysis.run','library.sync.run','library.metadata.export','library.metadata.rehydrate']::text[] AS grants
        ) UPDATE agent_principals p SET enabled=FALSE,
        grants=CASE WHEN p.grants && old.grants THEN ARRAY(
            SELECT g FROM unnest(p.grants) g WHERE g=ANY(old.grants))
            ELSE ARRAY['library.health.read']::text[] END
        FROM old WHERE NOT p.grants <@ old.grants""")
    from crate.db.schema_sections.agent_library_v114 import (
        create_agent_library_v114_schema,
    )

    create_agent_library_v114_schema(op)
