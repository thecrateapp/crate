"""Revisioned system playlists and private, actor-bound refinement proposals."""


def create_editorial_v116_schema(cur, *, include_audit_index=True):
    grants = """'library.health.read','ops.status.read','ops.jobs.read','ops.logs.read',
        'library.health.run','library.repair.photo_flag','ops.jobs.retry','ops.jobs.cancel_pending',
        'library.quality.run','library.repair.run','library.metadata.write','library.enrichment.run',
        'library.analysis.run','library.sync.run','library.metadata.export','library.metadata.rehydrate',
        'ops.audit.read','ops.jobs.manage_instance','ops.jobs.cancel',
        'ops.schedules.read','ops.schedules.run','ops.schedules.write','ops.runtime.read','ops.runtime.write',
        'editorial.read','editorial.prepare','editorial.write','editorial.publish'"""
    cur.execute(
        "ALTER TABLE agent_principals DROP CONSTRAINT IF EXISTS agent_principals_grants_check"
    )
    cur.execute(f"""ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_grants_check
        CHECK (cardinality(grants)>0 AND array_position(grants,NULL) IS NULL
               AND grants <@ ARRAY[{grants}]::text[])""")
    cur.execute(
        "ALTER TABLE playlists ADD COLUMN IF NOT EXISTS editorial_revision BIGINT NOT NULL DEFAULT 1"
    )
    cur.execute(
        "ALTER TABLE playlists ADD COLUMN IF NOT EXISTS generation_epoch BIGINT NOT NULL DEFAULT 0"
    )
    cur.execute("""CREATE OR REPLACE FUNCTION bump_playlist_editorial_revision()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF (to_jsonb(NEW) - ARRAY['editorial_revision','generation_status',
                    'generation_error','last_generated_at','generation_epoch','updated_at'])
               IS DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['editorial_revision','generation_status',
                    'generation_error','last_generated_at','generation_epoch','updated_at'])
               OR (NEW.generation_status IS NOT DISTINCT FROM OLD.generation_status
                   AND NEW.generation_error IS NOT DISTINCT FROM OLD.generation_error
                   AND NEW.last_generated_at IS NOT DISTINCT FROM OLD.last_generated_at
                   AND NEW.generation_epoch IS NOT DISTINCT FROM OLD.generation_epoch)
            THEN
                NEW.editorial_revision := OLD.editorial_revision + 1;
            ELSE
                NEW.editorial_revision := OLD.editorial_revision;
            END IF;
            RETURN NEW;
        END $$""")
    cur.execute("DROP TRIGGER IF EXISTS trg_playlist_editorial_revision ON playlists")
    cur.execute("""CREATE TRIGGER trg_playlist_editorial_revision
        BEFORE UPDATE ON playlists FOR EACH ROW
        EXECUTE FUNCTION bump_playlist_editorial_revision()""")
    cur.execute("""CREATE TABLE IF NOT EXISTS playlist_refinement_proposals (
        id UUID PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        editorial_revision BIGINT NOT NULL,
        exclusion_hash TEXT NOT NULL,
        actions JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
        applied_at TIMESTAMPTZ
    )""")
    cur.execute("""CREATE INDEX IF NOT EXISTS idx_playlist_refinement_proposals_actor
        ON playlist_refinement_proposals(actor_user_id, playlist_id, created_at DESC)""")
    if include_audit_index:
        cur.execute("""CREATE INDEX IF NOT EXISTS idx_audit_playlist_editorial_history
            ON audit_log(target_name, timestamp DESC, id DESC)
            WHERE target_type='system_playlist' AND action='playlist.editorial.applied'""")


__all__ = ["create_editorial_v116_schema"]
