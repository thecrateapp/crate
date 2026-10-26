"""Server minted acquisition selections and durable transfer deduplication."""

from crate.db.schema_sections.show_plans_v118 import PREVIOUS_GRANTS


def create_agent_acquisition_v132_schema(cur):
    grants = (
        PREVIOUS_GRANTS
        + ",'curation.shows.read','curation.shows.write','library.acquisition.search','library.acquisition.write'"
    )
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    cur.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK (cardinality(grants)>0 AND array_position(grants,NULL) IS NULL
        AND grants <@ ARRAY[{grants}]::text[])""")
    cur.execute("""CREATE TABLE IF NOT EXISTS agent_acquisition_receipts (
        id UUID PRIMARY KEY,
        principal_id UUID NOT NULL REFERENCES agent_principals(id) ON DELETE CASCADE,
        authorization_context JSONB NOT NULL,
        source JSONB NOT NULL,
        source_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes'
    )""")
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_acquisition_receipts_owner ON agent_acquisition_receipts(principal_id,created_at)"
    )
    cur.execute("""CREATE TABLE IF NOT EXISTS agent_acquisition_transfers (
        source_hash TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_jobs(task_id),
        receipt_id UUID NOT NULL REFERENCES agent_acquisition_receipts(id),
        state TEXT NOT NULL DEFAULT 'starting',
        evidence JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""")
