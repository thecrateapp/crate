"""Revisioned editorial playlists and agent grants."""

from alembic import op

from crate.db.schema_sections.editorial_v116 import create_editorial_v116_schema

revision = "126"
down_revision = "125"
branch_labels = None
depends_on = None


def upgrade():
    create_editorial_v116_schema(op, include_audit_index=False)
    with op.get_context().autocommit_block():
        op.execute("""CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_playlist_editorial_history
            ON audit_log(target_name, timestamp DESC, id DESC)
            WHERE target_type='system_playlist' AND action='playlist.editorial.applied'""")


def downgrade():
    op.execute("""UPDATE tasks SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE 'failed' END,
        error='Editorial operation disabled by schema rollback; reconcile any effects',
        result_json=COALESCE(result_json,'{}'::jsonb)||'{"verification": {"status": "manual_reconciliation_required"}}'::jsonb,
        heartbeat_at=NULL,worker_id=NULL,updated_at=NOW()
        WHERE status IN ('pending','running','delegated','completing')
          AND origin='agent' AND required_grants &&
          ARRAY['editorial.prepare','editorial.write','editorial.publish']::text[]""")
    op.execute("""DELETE FROM agent_requests r USING agent_jobs j
        WHERE r.task_id=j.task_id AND j.payload->>'domain_operation'='editorial_change'""")
    op.execute(
        "DELETE FROM agent_jobs WHERE payload->>'domain_operation'='editorial_change'"
    )
    op.execute("DELETE FROM agent_repair_plans WHERE operation='editorial_change'")
    op.execute("DROP TABLE IF EXISTS playlist_refinement_proposals")
    op.execute("DROP INDEX IF EXISTS idx_audit_playlist_editorial_history")
    op.execute("DROP TRIGGER IF EXISTS trg_playlist_editorial_revision ON playlists")
    op.execute("DROP FUNCTION IF EXISTS bump_playlist_editorial_revision()")
    op.execute("ALTER TABLE playlists DROP COLUMN IF EXISTS generation_epoch")
    op.execute("ALTER TABLE playlists DROP COLUMN IF EXISTS editorial_revision")
    old_grants = """'library.health.read','ops.status.read','ops.jobs.read','ops.logs.read',
        'library.health.run','library.repair.photo_flag','ops.jobs.retry','ops.jobs.cancel_pending',
        'library.quality.run','library.repair.run','library.metadata.write','library.enrichment.run',
        'library.analysis.run','library.sync.run','library.metadata.export','library.metadata.rehydrate',
        'ops.audit.read','ops.jobs.manage_instance','ops.jobs.cancel',
        'ops.schedules.read','ops.schedules.run','ops.schedules.write','ops.runtime.read','ops.runtime.write'"""
    op.execute(f"""UPDATE agent_principals SET enabled=FALSE,
        grants=CASE WHEN grants && ARRAY[{old_grants}]::text[] THEN ARRAY(
            SELECT g FROM unnest(grants) g WHERE g=ANY(ARRAY[{old_grants}]::text[]))
            ELSE ARRAY['library.health.read']::text[] END
        WHERE NOT grants <@ ARRAY[{old_grants}]::text[]""")
    op.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    op.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK (cardinality(grants)>0 AND array_position(grants,NULL) IS NULL
               AND grants <@ ARRAY[{old_grants}]::text[])""")
