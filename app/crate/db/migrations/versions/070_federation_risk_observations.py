"""Persist bounded federation risk evidence and expiring operator actions.

Revision ID: 070
Revises: 069
"""

from collections.abc import Sequence

from alembic import op


revision = "070"
down_revision = "069"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE federation_risk_observations (
            id BIGSERIAL PRIMARY KEY,
            observation_key TEXT NOT NULL UNIQUE,
            peer_node_uid UUID,
            subject_hash TEXT CHECK (length(subject_hash) <= 128),
            observation_type TEXT NOT NULL CHECK (observation_type IN (
                'invalid_signature', 'nonce_replay', 'pairing_flood',
                'auth_denial', 'quota_denial', 'import_hash_failure',
                'stream_error'
            )),
            severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
            count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            CHECK (octet_length(metadata_json::text) <= 16384),
            CHECK (expires_at > first_seen_at)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_risk_observations_recent
        ON federation_risk_observations
            (peer_node_uid, subject_hash, last_seen_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_risk_observations_retention
        ON federation_risk_observations (expires_at)
        """
    )
    op.execute(
        """
        CREATE TABLE federation_risk_snapshots (
            id BIGSERIAL PRIMARY KEY,
            peer_node_uid UUID,
            subject_hash TEXT CHECK (length(subject_hash) <= 128),
            score NUMERIC(5, 2) NOT NULL CHECK (score BETWEEN 0 AND 100),
            inputs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            algorithm_version TEXT NOT NULL,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
            CHECK (octet_length(inputs_json::text) <= 32768),
            CHECK (expires_at > computed_at)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_risk_snapshots_recent
        ON federation_risk_snapshots (peer_node_uid, subject_hash, computed_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_risk_snapshots_retention
        ON federation_risk_snapshots (expires_at)
        """
    )
    op.execute(
        """
        CREATE TABLE federation_temporary_actions (
            id BIGSERIAL PRIMARY KEY,
            action_uid UUID NOT NULL UNIQUE,
            peer_node_uid UUID,
            subject_hash TEXT CHECK (length(subject_hash) <= 128),
            action_type TEXT NOT NULL CHECK (action_type IN ('throttle', 'deny')),
            capability TEXT NOT NULL CHECK (length(capability) BETWEEN 1 AND 128),
            reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            reversed_at TIMESTAMPTZ,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            CHECK (octet_length(metadata_json::text) <= 16384),
            CHECK (expires_at > created_at)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_temporary_actions_active
        ON federation_temporary_actions
            (peer_node_uid, subject_hash, capability, expires_at)
        WHERE reversed_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_federation_temporary_actions_active")
    op.execute("DROP TABLE IF EXISTS federation_temporary_actions")
    op.execute("DROP INDEX IF EXISTS idx_federation_risk_snapshots_retention")
    op.execute("DROP INDEX IF EXISTS idx_federation_risk_snapshots_recent")
    op.execute("DROP TABLE IF EXISTS federation_risk_snapshots")
    op.execute("DROP INDEX IF EXISTS idx_federation_risk_observations_retention")
    op.execute("DROP INDEX IF EXISTS idx_federation_risk_observations_recent")
    op.execute("DROP TABLE IF EXISTS federation_risk_observations")
