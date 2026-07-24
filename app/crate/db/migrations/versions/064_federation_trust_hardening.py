"""Normalize federation keys, pairing state and key rotations.

Revision ID: 064
Revises: 063
"""

from collections.abc import Sequence

from alembic import op


revision = "064"
down_revision = "063"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE federation_local_keys (
            id BIGSERIAL PRIMARY KEY,
            key_id TEXT NOT NULL,
            node_uid UUID NOT NULL,
            public_key TEXT NOT NULL,
            private_key_ref TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'retiring', 'retired', 'revoked')),
            not_before TIMESTAMPTZ,
            not_after TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (node_uid, key_id)
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX idx_federation_local_keys_one_active
        ON federation_local_keys(node_uid)
        WHERE status = 'active'
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_local_keys_validity
        ON federation_local_keys(node_uid, status, not_before, not_after)
        """
    )
    op.execute(
        """
        CREATE TABLE federation_peer_keys (
            id BIGSERIAL PRIMARY KEY,
            node_uid UUID NOT NULL,
            key_id TEXT NOT NULL,
            public_key TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('pending', 'active', 'retiring', 'retired', 'revoked')),
            not_before TIMESTAMPTZ,
            not_after TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (node_uid, key_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_peer_keys_validity
        ON federation_peer_keys(node_uid, status, not_before, not_after)
        """
    )
    op.execute(
        """
        CREATE TABLE federation_pairings (
            id BIGSERIAL PRIMARY KEY,
            pairing_uid UUID NOT NULL UNIQUE,
            remote_node_uid UUID,
            remote_base_url TEXT NOT NULL,
            direction TEXT NOT NULL
                CHECK (direction IN ('inbound', 'outbound')),
            state TEXT NOT NULL DEFAULT 'created'
                CHECK (state IN (
                    'created', 'offered', 'remote_pending', 'accepted',
                    'completed', 'rejected', 'expired', 'failed'
                )),
            local_challenge TEXT NOT NULL,
            remote_challenge TEXT,
            negotiated_protocol TEXT,
            signature_profile TEXT,
            descriptor_digest TEXT,
            offer_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            acceptance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            expires_at TIMESTAMPTZ NOT NULL,
            verified_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            failure_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_pairings_state_expiry
        ON federation_pairings(state, expires_at)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_pairings_remote
        ON federation_pairings(remote_node_uid, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE TABLE federation_key_rotations (
            id BIGSERIAL PRIMARY KEY,
            rotation_uid UUID NOT NULL UNIQUE,
            node_uid UUID NOT NULL,
            old_key_id TEXT NOT NULL,
            new_key_id TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'prepared'
                CHECK (state IN (
                    'prepared', 'announced', 'active', 'retired',
                    'cancelled', 'failed'
                )),
            activate_at TIMESTAMPTZ NOT NULL,
            grace_until TIMESTAMPTZ NOT NULL,
            retired_at TIMESTAMPTZ,
            failure_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (old_key_id <> new_key_id),
            CHECK (grace_until > activate_at)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_key_rotations_state
        ON federation_key_rotations(node_uid, state, activate_at)
        """
    )
    op.execute(
        """
        INSERT INTO federation_local_keys (
            key_id, node_uid, public_key, private_key_ref, status,
            not_before, not_after
        )
        SELECT
            key_item->>'key_id',
            local_node.node_uid,
            key_item->>'public_key',
            CASE
                WHEN key_item->>'key_id' = local_node.active_key_id
                THEN local_node.private_key_ref
                ELSE NULL
            END,
            CASE
                WHEN key_item->>'key_id' = local_node.active_key_id THEN 'active'
                WHEN key_item->>'status' IN ('pending', 'retiring', 'retired', 'revoked')
                    THEN key_item->>'status'
                ELSE 'retired'
            END,
            NULLIF(key_item->>'not_before', '')::timestamptz,
            NULLIF(key_item->>'not_after', '')::timestamptz
        FROM federation_local_node AS local_node
        CROSS JOIN LATERAL jsonb_array_elements(local_node.public_keys_json) AS key_item
        WHERE COALESCE(key_item->>'key_id', '') <> ''
          AND COALESCE(key_item->>'public_key', '') <> ''
        ON CONFLICT (node_uid, key_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO federation_peer_keys (
            node_uid, key_id, public_key, fingerprint, status,
            not_before, not_after
        )
        SELECT
            peer.node_uid,
            key_item->>'key_id',
            key_item->>'public_key',
            encode(sha256(convert_to(key_item->>'public_key', 'UTF8')), 'hex'),
            CASE
                WHEN key_item->>'key_id' = peer.active_key_id THEN 'active'
                WHEN key_item->>'status' IN ('pending', 'retiring', 'retired', 'revoked')
                    THEN key_item->>'status'
                ELSE 'retired'
            END,
            NULLIF(key_item->>'not_before', '')::timestamptz,
            NULLIF(key_item->>'not_after', '')::timestamptz
        FROM federation_nodes AS peer
        CROSS JOIN LATERAL jsonb_array_elements(peer.public_keys_json) AS key_item
        WHERE COALESCE(key_item->>'key_id', '') <> ''
          AND COALESCE(key_item->>'public_key', '') <> ''
        ON CONFLICT (node_uid, key_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO federation_pairings (
            pairing_uid, remote_node_uid, remote_base_url, direction, state,
            local_challenge, expires_at, completed_at, created_at, updated_at
        )
        SELECT
            request_uid,
            remote_node_uid,
            remote_base_url,
            'outbound',
            CASE status
                WHEN 'approved' THEN 'completed'
                WHEN 'completed' THEN 'completed'
                WHEN 'rejected' THEN 'rejected'
                WHEN 'expired' THEN 'expired'
                WHEN 'failed' THEN 'failed'
                ELSE 'remote_pending'
            END,
            challenge,
            expires_at,
            completed_at,
            created_at,
            COALESCE(completed_at, created_at)
        FROM federation_pairing_requests
        ON CONFLICT (pairing_uid) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM federation_key_rotations
                WHERE state IN ('prepared', 'announced', 'active')
            ) THEN
                RAISE EXCEPTION 'Cannot downgrade with an unfinished key rotation';
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        UPDATE federation_local_node AS local_node
        SET
            active_key_id = active_key.key_id,
            private_key_ref = active_key.private_key_ref,
            public_keys_json = COALESCE((
                SELECT jsonb_agg(
                    jsonb_strip_nulls(jsonb_build_object(
                        'key_id', key_row.key_id,
                        'algorithm', 'ed25519',
                        'public_key', key_row.public_key,
                        'status', key_row.status,
                        'not_before', key_row.not_before,
                        'not_after', key_row.not_after
                    )) ORDER BY key_row.created_at
                )
                FROM federation_local_keys AS key_row
                WHERE key_row.node_uid = local_node.node_uid
                  AND key_row.status <> 'revoked'
            ), '[]'::jsonb),
            updated_at = NOW()
        FROM federation_local_keys AS active_key
        WHERE active_key.node_uid = local_node.node_uid
          AND active_key.status = 'active'
        """
    )
    op.execute(
        """
        UPDATE federation_nodes AS peer
        SET
            active_key_id = active_key.key_id,
            public_keys_json = COALESCE((
                SELECT jsonb_agg(
                    jsonb_strip_nulls(jsonb_build_object(
                        'key_id', key_row.key_id,
                        'algorithm', 'ed25519',
                        'public_key', key_row.public_key,
                        'status', key_row.status,
                        'not_before', key_row.not_before,
                        'not_after', key_row.not_after
                    )) ORDER BY key_row.created_at
                )
                FROM federation_peer_keys AS key_row
                WHERE key_row.node_uid = peer.node_uid
                  AND key_row.status <> 'revoked'
            ), '[]'::jsonb),
            updated_at = NOW()
        FROM federation_peer_keys AS active_key
        WHERE active_key.node_uid = peer.node_uid
          AND active_key.status = 'active'
        """
    )
    op.execute("DROP INDEX IF EXISTS idx_federation_key_rotations_state")
    op.execute("DROP TABLE IF EXISTS federation_key_rotations")
    op.execute("DROP INDEX IF EXISTS idx_federation_pairings_remote")
    op.execute("DROP INDEX IF EXISTS idx_federation_pairings_state_expiry")
    op.execute("DROP TABLE IF EXISTS federation_pairings")
    op.execute("DROP INDEX IF EXISTS idx_federation_peer_keys_validity")
    op.execute("DROP TABLE IF EXISTS federation_peer_keys")
    op.execute("DROP INDEX IF EXISTS idx_federation_local_keys_validity")
    op.execute("DROP INDEX IF EXISTS idx_federation_local_keys_one_active")
    op.execute("DROP TABLE IF EXISTS federation_local_keys")
