"""Canonical shows, durable provider aliases and private extraction drafts."""


def create_shows_v117_schema(cur):
    cur.execute("ALTER TABLE shows ADD COLUMN IF NOT EXISTS timezone TEXT")
    cur.execute("ALTER TABLE shows ADD COLUMN IF NOT EXISTS doors_time TEXT")
    cur.execute("ALTER TABLE shows ADD COLUMN IF NOT EXISTS identity_key TEXT")
    cur.execute(
        "ALTER TABLE shows ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1"
    )
    cur.execute("ALTER TABLE shows ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ")
    cur.execute(
        "ALTER TABLE shows ADD COLUMN IF NOT EXISTS merged_into_id INTEGER REFERENCES shows(id) ON DELETE RESTRICT"
    )
    cur.execute(
        "ALTER TABLE shows ADD COLUMN IF NOT EXISTS field_provenance JSONB NOT NULL DEFAULT '{}'::jsonb"
    )
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_identity_key ON shows(identity_key) WHERE identity_key IS NOT NULL"
    )
    cur.execute("""CREATE INDEX IF NOT EXISTS idx_shows_artist_date_identity
        ON shows(lower(regexp_replace(btrim(artist_name), '\\s+', ' ', 'g')), date)""")
    cur.execute("""CREATE TABLE IF NOT EXISTS show_source_aliases (
        provider TEXT NOT NULL, event_id TEXT NOT NULL,
        show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE RESTRICT,
        evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(provider,event_id))""")
    cur.execute("""INSERT INTO show_source_aliases(provider,event_id,show_id)
        SELECT CASE WHEN external_id LIKE 'setlistfm:%' THEN 'setlistfm'
                    WHEN external_id LIKE 'lastfm:%' THEN 'lastfm' ELSE 'ticketmaster' END,
               external_id,id FROM shows WHERE external_id IS NOT NULL
        ON CONFLICT DO NOTHING""")
    cur.execute("""INSERT INTO show_source_aliases(provider,event_id,show_id)
        SELECT 'lastfm',lastfm_event_id,id FROM shows WHERE lastfm_event_id IS NOT NULL
        ON CONFLICT DO NOTHING""")
    cur.execute("""WITH candidates AS (
        SELECT id,encode(sha256(convert_to(concat_ws(chr(31),
            lower(regexp_replace(btrim(artist_name),'\\s+',' ','g')),date::text,
            lower(regexp_replace(btrim(venue),'\\s+',' ','g')),
            lower(regexp_replace(btrim(city),'\\s+',' ','g')),coalesce(left(local_time,5),''),
            lower(coalesce(country_code,country,''))), 'UTF8')),'hex') AS key
        FROM shows WHERE venue IS NOT NULL AND venue<>'' AND city IS NOT NULL AND city<>''
    ), unique_keys AS (SELECT key FROM candidates GROUP BY key HAVING count(*)=1)
    UPDATE shows s SET identity_key=c.key FROM candidates c JOIN unique_keys u ON u.key=c.key
    WHERE s.id=c.id AND s.identity_key IS NULL""")
    # The 'migration:117' literal below is a frozen provenance identifier already
    # persisted in shows.field_provenance rows; it must not change even though this
    # DDL now ships as migration 126 (renumbered from 117 in commit 6b13b5a0).
    cur.execute("""UPDATE shows s SET field_provenance=(
        SELECT coalesce(jsonb_object_agg(key,jsonb_build_object('provider',coalesce(s.source,'legacy'),
            'actor','migration:117')), '{}'::jsonb)
        FROM jsonb_each(to_jsonb(s)) WHERE key=ANY(ARRAY['artist_name','date','local_time','venue','city',
            'country','country_code','tickets_url','url','image_url','lineup','price_range','status'])
        AND value<>'null'::jsonb) WHERE field_provenance='{}'::jsonb""")
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_shows_lineup ON shows USING gin(lineup)"
    )
    cur.execute("""CREATE TABLE IF NOT EXISTS show_sources (
        id BIGSERIAL PRIMARY KEY, show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE RESTRICT,
        fingerprint TEXT NOT NULL, provider TEXT NOT NULL, actor TEXT NOT NULL,
        evidence JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(show_id,fingerprint))""")
    cur.execute("""CREATE TABLE IF NOT EXISTS show_extraction_drafts (
        id UUID PRIMARY KEY, actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT, input JSONB NOT NULL, result JSONB, status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours')""")
    cur.execute("""CREATE OR REPLACE FUNCTION bump_show_revision() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.revision := OLD.revision + 1; RETURN NEW; END $$""")
    cur.execute("DROP TRIGGER IF EXISTS trg_show_revision ON shows")
    cur.execute(
        "CREATE TRIGGER trg_show_revision BEFORE UPDATE ON shows FOR EACH ROW EXECUTE FUNCTION bump_show_revision()"
    )


__all__ = ["create_shows_v117_schema"]
