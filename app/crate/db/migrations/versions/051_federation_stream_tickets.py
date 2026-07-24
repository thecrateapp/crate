"""Federation stream tickets — for inbound/outbound streaming proxy.

Revision ID: 051
Revises: 050
"""

from collections.abc import Sequence

from alembic import op


revision = "051"
down_revision = "050"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_stream_tickets (
            id BIGSERIAL PRIMARY KEY,
            ticket_uid UUID NOT NULL UNIQUE,
            direction TEXT NOT NULL,
            node_uid UUID NOT NULL,
            subject_hash TEXT,
            remote_entity_uid TEXT NOT NULL,
            delivery_policy TEXT NOT NULL,
            local_user_id INTEGER,
            local_user_hash TEXT,
            assertion_jti TEXT,
            constraints_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            status TEXT NOT NULL DEFAULT 'active',
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_stream_tickets_expiry
        ON federation_stream_tickets(expires_at)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_stream_tickets_node_subject
        ON federation_stream_tickets(node_uid, subject_hash, created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_federation_stream_tickets_node_subject")
    op.execute("DROP INDEX IF EXISTS idx_federation_stream_tickets_expiry")
    op.execute("DROP TABLE IF EXISTS federation_stream_tickets")
