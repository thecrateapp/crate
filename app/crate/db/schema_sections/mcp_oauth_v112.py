"""Delegated OAuth identity and single-use authorization state for revision 121 (section id v112)."""


def create_mcp_oauth_v112_schema(cur) -> None:
    cur.execute(
        "ALTER TABLE agent_principals ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service', 'delegated'))"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
            client_id TEXT PRIMARY KEY CHECK (length(client_id) BETWEEN 1 AND 2048),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
            redirect_uris TEXT[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 20),
            scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            metadata_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_authorizations (
            id UUID PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
            issuer TEXT NOT NULL,
            resource TEXT NOT NULL,
            principal_id UUID NOT NULL REFERENCES agent_principals(id),
            credential_id UUID NOT NULL REFERENCES agent_credentials(id),
            scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            revoked_at TIMESTAMPTZ
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_mcp_oauth_authorizations_connection ON mcp_oauth_authorizations(user_id, client_id, issuer)"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_consents (
            id UUID PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
            nonce_digest TEXT NOT NULL CHECK (nonce_digest ~ '^[a-f0-9]{64}$'),
            parameters JSONB NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
            consumed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_mcp_oauth_consents_expiry ON mcp_oauth_consents(expires_at)
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
            code_digest TEXT PRIMARY KEY CHECK (code_digest ~ '^[a-f0-9]{64}$'),
            authorization_id UUID NOT NULL REFERENCES mcp_oauth_authorizations(id) ON DELETE CASCADE,
            family_id UUID NOT NULL,
            client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
            redirect_uri TEXT NOT NULL,
            issuer TEXT NOT NULL,
            resource TEXT NOT NULL,
            scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
            code_challenge TEXT NOT NULL,
            code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
            expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
            consumed_at TIMESTAMPTZ
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
            id UUID PRIMARY KEY,
            authorization_id UUID NOT NULL REFERENCES mcp_oauth_authorizations(id) ON DELETE CASCADE,
            family_id UUID NOT NULL,
            client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
            issuer TEXT NOT NULL,
            resource TEXT NOT NULL,
            scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
            access_digest TEXT NOT NULL UNIQUE CHECK (access_digest ~ '^[a-f0-9]{64}$'),
            refresh_digest TEXT NOT NULL UNIQUE CHECK (refresh_digest ~ '^[a-f0-9]{64}$'),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            refresh_expires_at TIMESTAMPTZ NOT NULL,
            refresh_used_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_authorization ON mcp_oauth_tokens(authorization_id)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_family ON mcp_oauth_tokens(family_id)
    """)
