"""Durable bounded agent commands; revision 120 bootstrap definition (section id v111)."""

from typing import Any


def create_agent_commands_v111_schema(cur: Any) -> None:
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    cur.execute("""
        ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check CHECK (
            cardinality(grants) > 0 AND array_position(grants, NULL) IS NULL
            AND grants <@ ARRAY[
                'library.health.read', 'ops.status.read', 'ops.jobs.read', 'ops.logs.read',
                'library.health.run', 'library.repair.photo_flag',
                'ops.jobs.retry', 'ops.jobs.cancel_pending'
            ]::TEXT[]
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS agent_jobs (
            task_id TEXT PRIMARY KEY,
            principal_id UUID NOT NULL REFERENCES agent_principals(id) ON DELETE CASCADE,
            credential_id UUID NOT NULL REFERENCES agent_credentials(id),
            operation TEXT NOT NULL CHECK (operation IN ('run_health_check', 'apply_repairs')),
            artist_uid UUID NOT NULL,
            payload JSONB NOT NULL,
            payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
            required_grants TEXT[] NOT NULL,
            retry_of TEXT,
            retry_root TEXT NOT NULL,
            retry_depth INTEGER NOT NULL DEFAULT 0 CHECK (retry_depth BETWEEN 0 AND 3),
            trace_id TEXT,
            result JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_jobs_principal ON agent_jobs (principal_id, created_at DESC)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_jobs_target ON agent_jobs (artist_uid)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_jobs_retry_root ON agent_jobs (retry_root)"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS agent_requests (
            principal_id UUID NOT NULL REFERENCES agent_principals(id) ON DELETE CASCADE,
            operation TEXT NOT NULL CHECK (operation IN ('run_health_check', 'apply_repairs', 'retry_job')),
            idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
            payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
            task_id TEXT NOT NULL REFERENCES agent_jobs(task_id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (principal_id, operation, idempotency_key)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS agent_photo_observations (
            id UUID PRIMARY KEY,
            task_id TEXT NOT NULL UNIQUE REFERENCES agent_jobs(task_id) ON DELETE CASCADE,
            artist_uid UUID NOT NULL,
            issue_id BIGINT,
            observation JSONB NOT NULL,
            observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_photo_observations_issue ON agent_photo_observations (issue_id, observed_at DESC)"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS agent_repair_plans (
            id UUID PRIMARY KEY,
            principal_id UUID NOT NULL REFERENCES agent_principals(id) ON DELETE CASCADE,
            artist_uid UUID NOT NULL,
            issue_id BIGINT NOT NULL,
            observation_id UUID NOT NULL REFERENCES agent_photo_observations(id),
            version TEXT NOT NULL CHECK (version ~ '^[a-f0-9]{64}$'),
            before_value BOOLEAN NOT NULL,
            after_value BOOLEAN NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
            state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'queued', 'applied', 'conflict', 'failed', 'cancelled')),
            task_id TEXT,
            result JSONB,
            CHECK (before_value <> after_value)
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_repair_plans_principal ON agent_repair_plans (principal_id, created_at DESC)"
    )
