"""Task provenance, cooperative cancellation and scoped instance operations."""


def create_agent_operations_v115_schema(cur):
    grants = """'library.health.read','ops.status.read','ops.jobs.read','ops.logs.read',
        'library.health.run','library.repair.photo_flag','ops.jobs.retry','ops.jobs.cancel_pending',
        'library.quality.run','library.repair.run','library.metadata.write','library.enrichment.run',
        'library.analysis.run','library.sync.run','library.metadata.export','library.metadata.rehydrate',
        'ops.audit.read','ops.jobs.manage_instance','ops.jobs.cancel',
        'ops.schedules.read','ops.schedules.run','ops.schedules.write','ops.runtime.read','ops.runtime.write'"""
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    cur.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK (cardinality(grants)>0 AND array_position(grants,NULL) IS NULL
               AND grants <@ ARRAY[{grants}]::text[])""")
    columns = (
        "origin TEXT NOT NULL DEFAULT 'unknown'",
        "actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "origin_principal_id UUID REFERENCES agent_principals(id) ON DELETE SET NULL",
        "origin_context JSONB",
        "required_grants TEXT[] NOT NULL DEFAULT '{}'",
        "retry_of TEXT",
        "retry_root TEXT",
        "retry_depth INTEGER NOT NULL DEFAULT 0",
        "schedule_name TEXT",
        "cancellation_requested_at TIMESTAMPTZ",
        "cancellation_actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "cancellation_principal_id UUID REFERENCES agent_principals(id) ON DELETE SET NULL",
        "cancellation_acknowledged_at TIMESTAMPTZ",
    )
    for column in columns:
        cur.execute(f"ALTER TABLE tasks ADD COLUMN IF NOT EXISTS {column}")
    cur.execute("""UPDATE tasks t SET origin='agent',origin_principal_id=j.principal_id,
        origin_context=jsonb_build_object('principal_id',j.principal_id::text,'credential_id',j.credential_id::text,'authorization_context',j.authorization_context),required_grants=j.required_grants,
        actor_user_id=NULLIF(j.authorization_context->>'actor_user_id','')::integer
        FROM agent_jobs j WHERE j.task_id=t.id AND t.origin='unknown'""")
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_retry_root ON tasks(retry_root) WHERE retry_root IS NOT NULL"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_schedule_success ON tasks(schedule_name,updated_at DESC) WHERE schedule_name IS NOT NULL AND status='completed'"
    )
    from crate.db.schema_sections.agent_runtime_v115 import (
        create_agent_runtime_v115_schema,
    )

    create_agent_runtime_v115_schema(cur)
