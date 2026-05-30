"""Add Crate Connect active playback sessions.

Revision ID: 037
Revises: 036
"""

from typing import Sequence, Union

from alembic import op


revision: str = "037"
down_revision: Union[str, None] = "036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_active_playback_sessions (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            playback_session_id UUID NOT NULL,
            active_device_id TEXT,
            status TEXT NOT NULL,
            command_seq BIGINT NOT NULL DEFAULT 0,
            state_revision TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_active_playback_sessions_device
        ON user_active_playback_sessions(user_id, active_device_id)
        WHERE active_device_id IS NOT NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_active_playback_sessions_expires
        ON user_active_playback_sessions(expires_at)
        WHERE expires_at IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_user_active_playback_sessions_expires")
    op.execute("DROP INDEX IF EXISTS idx_user_active_playback_sessions_device")
    op.execute("DROP TABLE IF EXISTS user_active_playback_sessions")
