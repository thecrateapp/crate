"""Additive shared library plans, artifacts and generation-bound DSP claims."""


def create_agent_library_v114_schema(cur):
    grants = """'library.health.read','ops.status.read','ops.jobs.read','ops.logs.read',
        'library.health.run','library.repair.photo_flag','ops.jobs.retry','ops.jobs.cancel_pending',
        'library.quality.run','library.repair.run','library.metadata.write','library.enrichment.run',
        'library.analysis.run','library.sync.run','library.metadata.export','library.metadata.rehydrate'"""
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    cur.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK (cardinality(grants)>0 AND array_position(grants,NULL) IS NULL
               AND grants <@ ARRAY[{grants}]::text[])""")
    for table in ("agent_jobs", "agent_requests"):
        cur.execute(
            f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_operation_check"
        )
        cur.execute(f"""ALTER TABLE {table} ADD CONSTRAINT {table}_operation_check CHECK
            (operation IN ('run_health_check','apply_repairs','retry_job','prepare_operation','apply_operation'))""")
    cur.execute("ALTER TABLE agent_jobs ALTER COLUMN artist_uid DROP NOT NULL")
    cur.execute(
        "ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS target_keys TEXT[] NOT NULL DEFAULT '{}'"
    )
    cur.execute(
        "ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS effect_started_at TIMESTAMPTZ"
    )
    cur.execute(
        "UPDATE agent_jobs SET target_keys=ARRAY['artist:'||artist_uid::text] WHERE artist_uid IS NOT NULL AND target_keys='{}'"
    )
    for column in (
        "artist_uid",
        "issue_id",
        "observation_id",
        "before_value",
        "after_value",
    ):
        cur.execute(
            f"ALTER TABLE agent_repair_plans ALTER COLUMN {column} DROP NOT NULL"
        )
    cur.execute(
        "ALTER TABLE agent_repair_plans ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'repair_photo_flag'"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans ADD COLUMN IF NOT EXISTS document JSONB"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans ADD COLUMN IF NOT EXISTS execution_data JSONB"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans ADD COLUMN IF NOT EXISTS mandatory_approval BOOLEAN NOT NULL DEFAULT FALSE"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans ADD COLUMN IF NOT EXISTS required_grants TEXT[] NOT NULL DEFAULT ARRAY['library.repair.photo_flag']::text[]"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans DROP CONSTRAINT IF EXISTS agent_repair_plans_state_check"
    )
    cur.execute("""ALTER TABLE agent_repair_plans ADD CONSTRAINT agent_repair_plans_state_check CHECK
        (state IN ('ready','awaiting_approval','authorized','queued','running','applied','partial','conflict','failed','cancelled','rejected'))""")
    cur.execute("""CREATE TABLE IF NOT EXISTS agent_artifacts (
        id UUID PRIMARY KEY,
        principal_id UUID NOT NULL REFERENCES agent_principals(id) ON DELETE CASCADE,
        authorization_context JSONB NOT NULL,
        job_id TEXT NOT NULL REFERENCES agent_jobs(task_id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        byte_size BIGINT NOT NULL,
        required_grant TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours'
    )""")
    cur.execute("""CREATE TABLE IF NOT EXISTS admin_repair_preparations (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '15 minutes'
    )""")
    cur.execute("""DO $$ BEGIN
        IF to_regclass('track_processing_state') IS NOT NULL THEN
            ALTER TABLE track_processing_state ADD COLUMN IF NOT EXISTS generation BIGINT NOT NULL DEFAULT 0;
            ALTER TABLE track_processing_state ADD COLUMN IF NOT EXISTS claim_token UUID;
            ALTER TABLE track_processing_state ADD COLUMN IF NOT EXISTS pipeline_signature TEXT;
        END IF;
    END $$""")
