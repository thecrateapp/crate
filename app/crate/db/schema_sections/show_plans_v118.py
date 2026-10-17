"""Human ownership in the existing operation engine and closed show grants."""

PREVIOUS_GRANTS = """'library.health.read','ops.status.read','ops.jobs.read','ops.logs.read',
    'library.health.run','library.repair.photo_flag','ops.jobs.retry','ops.jobs.cancel_pending',
    'library.quality.run','library.repair.run','library.metadata.write','library.enrichment.run',
    'library.analysis.run','library.sync.run','library.metadata.export','library.metadata.rehydrate',
    'ops.audit.read','ops.jobs.manage_instance','ops.jobs.cancel',
    'ops.schedules.read','ops.schedules.run','ops.schedules.write','ops.runtime.read','ops.runtime.write',
    'editorial.read','editorial.prepare','editorial.write','editorial.publish'"""


def create_show_plans_v118_schema(cur):
    grants = """'library.health.read','ops.status.read','ops.jobs.read','ops.logs.read',
        'library.health.run','library.repair.photo_flag','ops.jobs.retry','ops.jobs.cancel_pending',
        'library.quality.run','library.repair.run','library.metadata.write','library.enrichment.run',
        'library.analysis.run','library.sync.run','library.metadata.export','library.metadata.rehydrate',
        'ops.audit.read','ops.jobs.manage_instance','ops.jobs.cancel',
        'ops.schedules.read','ops.schedules.run','ops.schedules.write','ops.runtime.read','ops.runtime.write',
        'editorial.read','editorial.prepare','editorial.write','editorial.publish',
        'curation.shows.read','curation.shows.write'"""
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    cur.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK (cardinality(grants)>0 AND array_position(grants,NULL) IS NULL AND grants <@ ARRAY[{grants}]::text[])""")
    cur.execute(
        "ALTER TABLE agent_principals ADD COLUMN IF NOT EXISTS human_owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE"
    )
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_kind_check"
    )
    cur.execute(
        "ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_kind_check CHECK (kind IN ('service','delegated','human'))"
    )
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_human_owner_check"
    )
    cur.execute(
        "ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_human_owner_check CHECK ((kind='human')=(human_owner_user_id IS NOT NULL))"
    )
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_show_editor_principal ON agent_principals(human_owner_user_id) WHERE kind='human'"
    )


__all__ = ["create_show_plans_v118_schema"]
