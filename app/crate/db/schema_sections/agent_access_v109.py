"""DDL for Alembic revision 109; keep immutable after the revision ships."""

from typing import Any


def create_agent_access_v109_schema(cur: Any) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_principals (
            id UUID PRIMARY KEY,
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            grants TEXT[] NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT agent_principals_grants_check CHECK (
                cardinality(grants) > 0
                AND array_position(grants, NULL) IS NULL
                AND grants <@ ARRAY[
                    'library.health.read', 'ops.status.read',
                    'ops.jobs.read', 'ops.logs.read'
                ]::TEXT[]
            )
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_credentials (
            id UUID PRIMARY KEY,
            principal_id UUID NOT NULL REFERENCES agent_principals(id) ON DELETE CASCADE,
            token_digest TEXT NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            CONSTRAINT agent_credentials_expiry_check CHECK (expires_at > created_at)
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_credentials_principal
        ON agent_credentials(principal_id, created_at DESC)
        """
    )
