"""Add short-lived cast stream tickets.

Revision ID: 036
Revises: 035
"""

from typing import Sequence, Union

from alembic import op


revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS cast_stream_tickets (
            ticket_hash TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE CASCADE,
            track_entity_uid UUID,
            track_path TEXT,
            purpose TEXT NOT NULL,
            target_device_id TEXT,
            delivery_policy TEXT NOT NULL DEFAULT 'balanced',
            receiver_capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            last_used_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_cast_stream_tickets_user_created
        ON cast_stream_tickets(user_id, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_cast_stream_tickets_expires
        ON cast_stream_tickets(expires_at)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_cast_stream_tickets_track_entity
        ON cast_stream_tickets(track_entity_uid)
        WHERE track_entity_uid IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_cast_stream_tickets_track_entity")
    op.execute("DROP INDEX IF EXISTS idx_cast_stream_tickets_expires")
    op.execute("DROP INDEX IF EXISTS idx_cast_stream_tickets_user_created")
    op.execute("DROP TABLE IF EXISTS cast_stream_tickets")
