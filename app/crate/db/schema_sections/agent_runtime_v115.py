"""Revisioned operational policy and evidence of real consumer adoption."""


def create_agent_runtime_v115_schema(cur):
    cur.execute("""CREATE TABLE IF NOT EXISTS agent_runtime_policy (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
        policy JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""")
    cur.execute("""CREATE TABLE IF NOT EXISTS agent_runtime_adoptions (
        consumer_id TEXT NOT NULL,
        component TEXT NOT NULL,
        revision BIGINT NOT NULL CHECK (revision >= 0),
        policy_hash TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (consumer_id, component)
    )""")
    cur.execute("""CREATE INDEX IF NOT EXISTS idx_agent_runtime_adoptions_observed
        ON agent_runtime_adoptions (observed_at DESC)""")


__all__ = ["create_agent_runtime_v115_schema"]
