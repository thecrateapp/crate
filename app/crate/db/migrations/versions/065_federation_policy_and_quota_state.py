"""Add revisioned federation grants and recoverable quota reservations.

Revision ID: 065
Revises: 064
"""

from collections.abc import Sequence

from alembic import op


revision = "065"
down_revision = "064"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE federation_peer_grants
            ADD COLUMN grant_uid UUID,
            ADD COLUMN policy_revision BIGINT NOT NULL DEFAULT 1,
            ADD COLUMN constraints_version INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN subject_selector TEXT,
            ADD COLUMN valid_from TIMESTAMPTZ,
            ADD COLUMN valid_until TIMESTAMPTZ,
            ADD COLUMN revoked_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        UPDATE federation_peer_grants
        SET grant_uid = COALESCE(grant_uid, gen_random_uuid()),
            subject_selector = COALESCE(subject_selector, principal_selector),
            valid_from = COALESCE(valid_from, created_at),
            valid_until = COALESCE(valid_until, expires_at),
            revoked_at = COALESCE(revoked_at, disabled_at),
            constraints_json = COALESCE(constraints_json, '{}'::jsonb)
        """
    )
    op.execute(
        """
        UPDATE federation_peer_grants AS grant_row
        SET constraints_json = jsonb_strip_nulls(jsonb_build_object(
                'max_concurrent_streams', peer.policy_json->'max_streams',
                'daily_stream_bytes', peer.policy_json->'daily_bytes',
                'max_results', peer.policy_json->'max_results'
            )) || grant_row.constraints_json
        FROM federation_nodes AS peer
        WHERE peer.node_uid = grant_row.node_uid
        """
    )
    op.execute(
        """
        INSERT INTO federation_peer_grants (
            node_uid, principal_selector, subject_selector, preset,
            capabilities_json, constraints_json, grant_uid,
            policy_revision, constraints_version, valid_from
        )
        SELECT
            peer.node_uid,
            'peer_users:' || peer.node_uid::text,
            'peer_users:' || peer.node_uid::text,
            peer.default_grant_preset,
            CASE peer.default_grant_preset
                WHEN 'off' THEN '[]'::jsonb
                WHEN 'discovery' THEN '["catalog.search", "artwork.read"]'::jsonb
                WHEN 'catalog' THEN '["catalog.search", "catalog.sync", "catalog.artist.read", "catalog.album.read", "catalog.track.read", "catalog.metadata.genres", "artwork.read"]'::jsonb
                WHEN 'listen' THEN '["catalog.search", "catalog.sync", "catalog.artist.read", "catalog.album.read", "catalog.track.read", "catalog.metadata.genres", "artwork.read", "stream.proxy", "stream.transcoded"]'::jsonb
                WHEN 'trusted_library' THEN '["catalog.search", "catalog.sync", "catalog.artist.read", "catalog.album.read", "catalog.track.read", "catalog.metadata.genres", "artwork.read", "stream.proxy", "stream.transcoded", "stream.original", "import.request", "import.pull"]'::jsonb
                ELSE '[]'::jsonb
            END,
            CASE peer.default_grant_preset
                WHEN 'discovery' THEN '{"max_results": 10, "allowed_entity_types": ["artist", "album", "track"]}'::jsonb
                WHEN 'catalog' THEN '{"max_results": 20, "allowed_entity_types": ["artist", "album", "track"]}'::jsonb
                WHEN 'listen' THEN '{"max_results": 20, "max_concurrent_streams": 4, "daily_stream_bytes": 50000000000, "delivery": ["balanced"], "allowed_entity_types": ["artist", "album", "track"]}'::jsonb
                WHEN 'trusted_library' THEN '{"max_results": 50, "max_concurrent_streams": 4, "daily_stream_bytes": 250000000000, "delivery": ["balanced", "original"], "allow_original": true, "allowed_entity_types": ["artist", "album", "track"], "max_import_bytes": 100000000000, "import_requires_approval": true}'::jsonb
                ELSE '{}'::jsonb
            END || jsonb_strip_nulls(jsonb_build_object(
                'max_concurrent_streams', peer.policy_json->'max_streams',
                'daily_stream_bytes', peer.policy_json->'daily_bytes',
                'max_results', peer.policy_json->'max_results'
            )),
            gen_random_uuid(),
            1,
            1,
            peer.created_at
        FROM federation_nodes AS peer
        WHERE NOT EXISTS (
            SELECT 1 FROM federation_peer_grants AS existing
            WHERE existing.node_uid = peer.node_uid
        )
        """
    )
    op.execute(
        """
        ALTER TABLE federation_peer_grants
            ALTER COLUMN grant_uid SET NOT NULL,
            ALTER COLUMN grant_uid SET DEFAULT gen_random_uuid(),
            ALTER COLUMN subject_selector SET NOT NULL,
            ALTER COLUMN valid_from SET NOT NULL,
            ALTER COLUMN valid_from SET DEFAULT NOW(),
            ADD CONSTRAINT uq_federation_peer_grants_uid UNIQUE (grant_uid),
            ADD CONSTRAINT ck_federation_peer_grants_constraints_version
                CHECK (constraints_version = 1),
            ADD CONSTRAINT ck_federation_peer_grants_constraints_object
                CHECK (jsonb_typeof(constraints_json) = 'object'),
            ADD CONSTRAINT ck_federation_peer_grants_validity
                CHECK (valid_until IS NULL OR valid_until > valid_from)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_peer_grants_authorize
        ON federation_peer_grants (
            node_uid, subject_selector, priority DESC, policy_revision DESC
        )
        WHERE revoked_at IS NULL
        """
    )
    op.execute(
        """
        CREATE TABLE federation_quota_reservations (
            reservation_uid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            node_uid UUID NOT NULL,
            subject_hash TEXT,
            capability TEXT NOT NULL,
            units BIGINT NOT NULL CHECK (units > 0),
            policy_revision BIGINT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            released_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_quota_reservations_active
        ON federation_quota_reservations (node_uid, capability, expires_at)
        WHERE released_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_federation_quota_reservations_active")
    op.execute("DROP TABLE IF EXISTS federation_quota_reservations")
    op.execute("DROP INDEX IF EXISTS idx_federation_peer_grants_authorize")
    op.execute(
        """
        ALTER TABLE federation_peer_grants
            DROP CONSTRAINT IF EXISTS ck_federation_peer_grants_validity,
            DROP CONSTRAINT IF EXISTS ck_federation_peer_grants_constraints_object,
            DROP CONSTRAINT IF EXISTS ck_federation_peer_grants_constraints_version,
            DROP CONSTRAINT IF EXISTS uq_federation_peer_grants_uid,
            DROP COLUMN IF EXISTS revoked_at,
            DROP COLUMN IF EXISTS valid_until,
            DROP COLUMN IF EXISTS valid_from,
            DROP COLUMN IF EXISTS subject_selector,
            DROP COLUMN IF EXISTS constraints_version,
            DROP COLUMN IF EXISTS policy_revision,
            DROP COLUMN IF EXISTS grant_uid
        """
    )
