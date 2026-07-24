"""Add a transactional outbox for durable domain-event delivery.

Revision ID: 073
Revises: 072
"""

from collections.abc import Sequence

from alembic import op


revision = "073"
down_revision = "072"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS domain_event_outbox (
            event_uid UUID PRIMARY KEY,
            event_type TEXT NOT NULL,
            scope TEXT,
            subject_key TEXT,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'leased', 'delivered', 'dead_letter')),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            leased_by TEXT,
            lease_expires_at TIMESTAMPTZ,
            redis_stream_id TEXT,
            sequence BIGINT,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            delivered_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_dispatch
        ON domain_event_outbox (status, next_attempt_at, created_at)
        WHERE status IN ('pending', 'leased')
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_dead_letter
        ON domain_event_outbox (updated_at DESC)
        WHERE status = 'dead_letter'
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS domain_event_outbox")
