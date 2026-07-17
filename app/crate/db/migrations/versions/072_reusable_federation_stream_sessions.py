"""Keep federation stream authorization reusable within a bounded session.

Revision ID: 072
Revises: 071
"""

from collections.abc import Sequence

from alembic import op


revision = "072"
down_revision = "071"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE federation_stream_tickets
        ADD COLUMN IF NOT EXISTS first_authorized_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE federation_stream_tickets
        ADD COLUMN IF NOT EXISTS last_authorized_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE federation_stream_tickets
        ADD COLUMN IF NOT EXISTS authorization_count INTEGER NOT NULL DEFAULT 0
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_stream_tickets_active
        ON federation_stream_tickets (ticket_uid, status, expires_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_federation_stream_tickets_active")
    op.execute(
        """
        ALTER TABLE federation_stream_tickets
        DROP COLUMN IF EXISTS authorization_count
        """
    )
    op.execute(
        """
        ALTER TABLE federation_stream_tickets
        DROP COLUMN IF EXISTS last_authorized_at
        """
    )
    op.execute(
        """
        ALTER TABLE federation_stream_tickets
        DROP COLUMN IF EXISTS first_authorized_at
        """
    )
