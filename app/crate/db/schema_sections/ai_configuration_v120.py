"""Immutable additive AI configuration and bounded usage schema (revision 130, section id v120)."""

# Keep this closed list frozen with revision 130; runtime registry validation is additional.
ACTIONS_SQL = "'shows.extract.vision','shows.extract.text','shows.extract.ocr_text','artwork.hero.analyze','artists.bio.research','genres.description.generate','genres.taxonomy.propose','genres.eq.propose','playlists.description.generate','music_paths.refine','i18n.listen.draft'"


def create_ai_configuration_v120_schema(cur):
    cur.execute("""CREATE TABLE IF NOT EXISTS ai_provider_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
        provider TEXT NOT NULL CHECK(provider IN ('gemini','deepseek','ollama')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
        secret_ref TEXT REFERENCES credential_secrets(secret_ref) ON DELETE RESTRICT,
        secret_source TEXT NOT NULL DEFAULT 'none' CHECK(secret_source IN ('none','stored','environment')),
        endpoint TEXT, enabled BOOLEAN NOT NULL DEFAULT TRUE,
        model_catalog JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(model_catalog)='array'),
        catalog_status TEXT NOT NULL DEFAULT 'pending' CHECK(catalog_status IN ('pending','ready','error')),
        catalog_error_code TEXT CHECK(length(catalog_error_code)<=80), catalog_updated_at TIMESTAMPTZ,
        max_concurrent INTEGER NOT NULL DEFAULT 2 CHECK(max_concurrent BETWEEN 1 AND 8),
        daily_calls INTEGER NOT NULL DEFAULT 1000 CHECK(daily_calls BETWEEN 1 AND 100000),
        daily_tokens BIGINT NOT NULL DEFAULT 1000000 CHECK(daily_tokens BETWEEN 1 AND 1000000000),
        active_invocations INTEGER NOT NULL DEFAULT 0 CHECK(active_invocations>=0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    cur.execute("""CREATE TABLE IF NOT EXISTS ai_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
        current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version>0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    cur.execute("""CREATE TABLE IF NOT EXISTS ai_profile_versions (
        profile_id UUID NOT NULL REFERENCES ai_profiles(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL CHECK(version>0), connection_id UUID NOT NULL REFERENCES ai_provider_connections(id) ON DELETE RESTRICT,
        model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200),
        config JSONB NOT NULL CHECK(jsonb_typeof(config)='object'), fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(profile_id,version))""")
    cur.execute("""CREATE OR REPLACE FUNCTION ai_profile_version_immutable_v120() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'AI profile versions are immutable'; END $$""")
    cur.execute("""DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ai_profile_version_immutable_v120' AND tgrelid='ai_profile_versions'::regclass) THEN
        CREATE TRIGGER ai_profile_version_immutable_v120 BEFORE UPDATE OR DELETE ON ai_profile_versions
        FOR EACH ROW EXECUTE FUNCTION ai_profile_version_immutable_v120(); END IF; END $$""")
    cur.execute(f"""CREATE TABLE IF NOT EXISTS ai_action_bindings (
        action_id TEXT PRIMARY KEY CHECK(action_id IN ({ACTIONS_SQL})),
        profile_id UUID NOT NULL, profile_version INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), enabled BOOLEAN NOT NULL DEFAULT TRUE,
        FOREIGN KEY(profile_id,profile_version) REFERENCES ai_profile_versions(profile_id,version) ON DELETE RESTRICT)""")
    cur.execute("""CREATE TABLE IF NOT EXISTS ai_configuration_state (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), active BOOLEAN NOT NULL DEFAULT FALSE,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), activated_at TIMESTAMPTZ)""")
    cur.execute(
        "INSERT INTO ai_configuration_state(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING"
    )
    cur.execute(f"""CREATE TABLE IF NOT EXISTS ai_invocations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 200),
        claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
        connection_id UUID NOT NULL REFERENCES ai_provider_connections(id) ON DELETE RESTRICT,
        invocation_kind TEXT NOT NULL DEFAULT 'action' CHECK(invocation_kind IN ('action','probe')),
        action_id TEXT, profile_id UUID, profile_version INTEGER,
        CHECK((invocation_kind='action' AND action_id IS NOT NULL AND action_id IN ({ACTIONS_SQL})) OR (invocation_kind='probe' AND action_id IS NULL)),
        CHECK((profile_id IS NULL)=(profile_version IS NULL)),
        FOREIGN KEY(profile_id,profile_version) REFERENCES ai_profile_versions(profile_id,version) ON DELETE RESTRICT,
        model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200), reported_model TEXT CHECK(length(reported_model)<=200),
        config_fingerprint TEXT CHECK(length(config_fingerprint)<=64),
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, job_id TEXT CHECK(length(job_id)<=200),
        status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','succeeded','failed','timeout','cancelled')),
        metering_mode TEXT NOT NULL DEFAULT 'enforced' CHECK(metering_mode IN ('enforced','legacy_tracking')),
        reserved_tokens BIGINT NOT NULL CHECK(reserved_tokens>=0), charged_tokens BIGINT NOT NULL CHECK(charged_tokens>=0),
        input_tokens BIGINT CHECK(input_tokens BETWEEN 0 AND 1000000000), output_tokens BIGINT CHECK(output_tokens BETWEEN 0 AND 1000000000),
        thought_tokens BIGINT CHECK(thought_tokens BETWEEN 0 AND 1000000000),
        cached_input_tokens BIGINT CHECK(cached_input_tokens>=0 AND cached_input_tokens<=input_tokens),
        total_tokens BIGINT CHECK(total_tokens BETWEEN 0 AND 1000000000),
        usage_known BOOLEAN NOT NULL DEFAULT FALSE, error_code TEXT CHECK(length(error_code)<=80),
        duration_ms BIGINT NOT NULL DEFAULT 0 CHECK(duration_ms>=0), estimated_cost NUMERIC CHECK(estimated_cost>=0),
        usage_day DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')::date,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ)""")
    cur.execute(f"""CREATE TABLE IF NOT EXISTS ai_usage_daily (
        day DATE NOT NULL, connection_id UUID NOT NULL REFERENCES ai_provider_connections(id) ON DELETE RESTRICT,
        invocation_kind TEXT NOT NULL DEFAULT 'action' CHECK(invocation_kind IN ('action','probe')),
        action_id TEXT NOT NULL,
        CHECK((invocation_kind='action' AND action_id IN ({ACTIONS_SQL})) OR (invocation_kind='probe' AND action_id='')),
        calls BIGINT NOT NULL DEFAULT 0 CHECK(calls>=0),
        unknown_calls BIGINT NOT NULL DEFAULT 0 CHECK(unknown_calls>=0),
        tokens BIGINT NOT NULL DEFAULT 0 CHECK(tokens>=0), completed BIGINT NOT NULL DEFAULT 0 CHECK(completed>=0),
        failed BIGINT NOT NULL DEFAULT 0 CHECK(failed>=0), estimated_cost NUMERIC,
        PRIMARY KEY(day,connection_id,invocation_kind,action_id))""")
    cur.execute(f"""CREATE TABLE IF NOT EXISTS ai_legacy_invocation_receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 200),
        claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
        action_id TEXT NOT NULL CHECK(action_id IN ({ACTIONS_SQL})),
        provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 200 AND provider NOT IN ('gemini','deepseek','ollama')),
        model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200), config_fingerprint TEXT CHECK(length(config_fingerprint)<=64),
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, job_id TEXT CHECK(length(job_id)<=200),
        status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','succeeded','failed','timeout','cancelled')),
        error_code TEXT CHECK(length(error_code)<=80), duration_ms BIGINT NOT NULL DEFAULT 0 CHECK(duration_ms>=0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ)""")
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_legacy_receipts_retention ON ai_legacy_invocation_receipts(created_at,id)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_invocations_activity ON ai_invocations(created_at DESC,id DESC)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_invocations_connection ON ai_invocations(connection_id,created_at DESC)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_invocations_finished ON ai_invocations(finished_at) WHERE finished_at IS NOT NULL"
    )


__all__ = ["create_ai_configuration_v120_schema"]
