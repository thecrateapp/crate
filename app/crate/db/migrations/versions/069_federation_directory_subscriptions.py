"""Persist signed federation directory subscriptions and candidates.

Revision ID: 069
Revises: 068
"""

from collections.abc import Sequence

from alembic import op


revision = "069"
down_revision = "068"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE federation_directory_subscriptions (
            id BIGSERIAL PRIMARY KEY,
            subscription_uid UUID NOT NULL UNIQUE,
            url TEXT NOT NULL UNIQUE,
            trusted_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            refresh_interval_seconds INTEGER NOT NULL DEFAULT 3600
                CHECK (refresh_interval_seconds BETWEEN 300 AND 604800),
            state TEXT NOT NULL DEFAULT 'active'
                CHECK (state IN ('active', 'paused', 'error')),
            etag TEXT,
            last_modified TEXT,
            consecutive_failures INTEGER NOT NULL DEFAULT 0,
            retry_after TIMESTAMPTZ,
            last_attempt_at TIMESTAMPTZ,
            last_success_at TIMESTAMPTZ,
            last_error_code TEXT,
            last_error_detail TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_directory_due
        ON federation_directory_subscriptions (state, retry_after, last_attempt_at)
        WHERE state <> 'paused'
        """
    )
    op.execute(
        """
        CREATE TABLE federation_directory_refresh_runs (
            id BIGSERIAL PRIMARY KEY,
            run_uid UUID NOT NULL UNIQUE,
            subscription_id BIGINT NOT NULL REFERENCES
                federation_directory_subscriptions(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'succeeded', 'not_modified', 'failed')),
            http_status INTEGER,
            signing_key_id TEXT,
            candidates_seen INTEGER NOT NULL DEFAULT 0,
            candidates_changed INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            error_detail TEXT,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_federation_directory_running
        ON federation_directory_refresh_runs (subscription_id)
        WHERE status = 'running'
        """
    )
    op.execute(
        """
        CREATE TABLE federation_directory_candidates (
            id BIGSERIAL PRIMARY KEY,
            subscription_id BIGINT NOT NULL REFERENCES
                federation_directory_subscriptions(id) ON DELETE CASCADE,
            node_uid UUID NOT NULL,
            descriptor_url TEXT NOT NULL,
            descriptor_digest TEXT NOT NULL,
            display_name TEXT,
            advertised_key_id TEXT,
            state TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending', 'stale', 'changed', 'ignored')),
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            stale_at TIMESTAMPTZ,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            UNIQUE (subscription_id, node_uid)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_directory_candidates_state
        ON federation_directory_candidates (subscription_id, state, last_seen_at DESC)
        """
    )
    op.execute(
        """
        ALTER TABLE federation_nodes
        ADD COLUMN directory_candidate_id BIGINT REFERENCES
            federation_directory_candidates(id) ON DELETE SET NULL
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE federation_nodes DROP COLUMN IF EXISTS directory_candidate_id"
    )
    op.execute("DROP INDEX IF EXISTS idx_federation_directory_candidates_state")
    op.execute("DROP TABLE IF EXISTS federation_directory_candidates")
    op.execute("DROP INDEX IF EXISTS uq_federation_directory_running")
    op.execute("DROP TABLE IF EXISTS federation_directory_refresh_runs")
    op.execute("DROP INDEX IF EXISTS idx_federation_directory_due")
    op.execute("DROP TABLE IF EXISTS federation_directory_subscriptions")
