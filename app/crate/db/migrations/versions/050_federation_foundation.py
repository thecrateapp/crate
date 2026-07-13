"""Federation foundation — node identity, peers, pairing, grants, subjects, audit.

Revision ID: 050
Revises: 049
"""

from collections.abc import Sequence

from alembic import op


revision = "050"
down_revision = "049"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_local_node (
            id BIGSERIAL PRIMARY KEY,
            node_uid UUID NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            public_base_url TEXT,
            api_base_url TEXT,
            listen_base_url TEXT,
            active_key_id TEXT NOT NULL,
            public_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            private_key_ref TEXT NOT NULL,
            capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_nodes (
            id BIGSERIAL PRIMARY KEY,
            node_uid UUID NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            api_base_url TEXT NOT NULL,
            listen_base_url TEXT,
            active_key_id TEXT NOT NULL,
            public_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            trust_state TEXT NOT NULL DEFAULT 'pending',
            direction TEXT NOT NULL DEFAULT 'outbound',
            scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            default_grant_preset TEXT NOT NULL DEFAULT 'discovery',
            capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            health_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            last_health_at TIMESTAMPTZ,
            last_seen_at TIMESTAMPTZ,
            last_success_at TIMESTAMPTZ,
            last_error TEXT,
            disabled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_nodes_state
        ON federation_nodes(trust_state, disabled_at)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_pairing_requests (
            id BIGSERIAL PRIMARY KEY,
            request_uid UUID NOT NULL UNIQUE,
            remote_node_uid UUID,
            remote_base_url TEXT NOT NULL,
            remote_public_key TEXT,
            challenge TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            requested_scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            granted_scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            expires_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_peer_grants (
            id BIGSERIAL PRIMARY KEY,
            node_uid UUID NOT NULL,
            principal_selector TEXT NOT NULL,
            preset TEXT NOT NULL DEFAULT 'discovery',
            capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            constraints_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            resource_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            priority INTEGER NOT NULL DEFAULT 0,
            expires_at TIMESTAMPTZ,
            disabled_at TIMESTAMPTZ,
            created_by INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_peer_grants_node
        ON federation_peer_grants(node_uid, disabled_at, priority DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_peer_grants_principal
        ON federation_peer_grants(principal_selector)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_remote_subjects (
            id BIGSERIAL PRIMARY KEY,
            node_uid UUID NOT NULL,
            subject_hash TEXT NOT NULL,
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            quota_overrides_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            blocked_at TIMESTAMPTZ,
            blocked_reason TEXT,
            UNIQUE (node_uid, subject_hash)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_remote_subjects_node_seen
        ON federation_remote_subjects(node_uid, last_seen_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_remote_subjects_blocked
        ON federation_remote_subjects(node_uid, blocked_at)
        WHERE blocked_at IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_audit_events (
            id BIGSERIAL PRIMARY KEY,
            node_uid UUID,
            event_type TEXT NOT NULL,
            actor_user_id INTEGER,
            request_id TEXT,
            status TEXT NOT NULL,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_audit_node_created
        ON federation_audit_events(node_uid, created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_federation_audit_node_created")
    op.execute("DROP TABLE IF EXISTS federation_audit_events")
    op.execute("DROP INDEX IF EXISTS idx_federation_remote_subjects_blocked")
    op.execute("DROP INDEX IF EXISTS idx_federation_remote_subjects_node_seen")
    op.execute("DROP TABLE IF EXISTS federation_remote_subjects")
    op.execute("DROP INDEX IF EXISTS idx_federation_peer_grants_principal")
    op.execute("DROP INDEX IF EXISTS idx_federation_peer_grants_node")
    op.execute("DROP TABLE IF EXISTS federation_peer_grants")
    op.execute("DROP TABLE IF EXISTS federation_pairing_requests")
    op.execute("DROP INDEX IF EXISTS idx_federation_nodes_state")
    op.execute("DROP TABLE IF EXISTS federation_nodes")
    op.execute("DROP TABLE IF EXISTS federation_local_node")
