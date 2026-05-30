"""Add durable Crate Connect command outbox.

Revision ID: 040
Revises: 039
"""

from typing import Sequence, Union

from alembic import op


revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS connect_command_outbox (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_device_id TEXT NOT NULL,
            command_id UUID NOT NULL,
            command_type TEXT NOT NULL,
            source_device_id TEXT,
            playback_session_id UUID,
            command_seq BIGINT,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            delivered_at TIMESTAMPTZ,
            acked_at TIMESTAMPTZ,
            ack_status TEXT,
            ack_error TEXT,
            UNIQUE (user_id, command_id),
            FOREIGN KEY (user_id, target_device_id)
                REFERENCES user_devices(user_id, device_id)
                ON DELETE CASCADE
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_connect_command_outbox_device
        ON connect_command_outbox(user_id, target_device_id, id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_connect_command_outbox_expires
        ON connect_command_outbox(expires_at)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_connect_command_outbox_acks
        ON connect_command_outbox(user_id, command_id)
        WHERE acked_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_connect_command_outbox_acks")
    op.execute("DROP INDEX IF EXISTS idx_connect_command_outbox_expires")
    op.execute("DROP INDEX IF EXISTS idx_connect_command_outbox_device")
    op.execute("DROP TABLE IF EXISTS connect_command_outbox")
