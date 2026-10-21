"""Human policy and exact plan approval metadata for revision 123 (section id v113)."""


def create_agent_admin_v113_schema(cur, *, include_index=True):
    cur.execute(
        "ALTER TABLE agent_principals ADD COLUMN IF NOT EXISTS policy_revision INTEGER NOT NULL DEFAULT 1"
    )
    cur.execute(
        "ALTER TABLE agent_principals ADD COLUMN IF NOT EXISTS require_approval BOOLEAN NOT NULL DEFAULT FALSE"
    )
    cur.execute(
        "ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS authorization_context JSONB NOT NULL DEFAULT '{}'::jsonb"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans ADD COLUMN IF NOT EXISTS authorization_context JSONB NOT NULL DEFAULT '{}'::jsonb"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans ADD COLUMN IF NOT EXISTS policy_revision INTEGER NOT NULL DEFAULT 1"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT FALSE"
    )
    cur.execute(
        "ALTER TABLE agent_repair_plans DROP CONSTRAINT IF EXISTS agent_repair_plans_state_check"
    )
    cur.execute("""
        ALTER TABLE agent_repair_plans ADD CONSTRAINT agent_repair_plans_state_check CHECK
        (state IN ('ready','awaiting_approval','authorized','queued','running','applied','conflict','failed','cancelled','rejected'))
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS agent_plan_approvals (
            plan_id UUID PRIMARY KEY REFERENCES agent_repair_plans(id) ON DELETE CASCADE,
            principal_id UUID NOT NULL REFERENCES agent_principals(id) ON DELETE CASCADE,
            plan_version TEXT NOT NULL,
            content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
            authorization_context JSONB NOT NULL,
            policy_revision INTEGER NOT NULL,
            decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
            approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            reserved_job_id TEXT
        )
    """)
    if include_index:
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_audit_activity ON audit_log ((details_json->>'principal_id'), timestamp DESC, id DESC)"
        )
