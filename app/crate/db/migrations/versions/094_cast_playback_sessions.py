"""Add scoped Cast playback sessions.

Revision ID: 094
Revises: 093
"""

from alembic import op


revision = "094"
down_revision = "093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS cast_playback_sessions (
            lease_hash TEXT PRIMARY KEY,
            session_id UUID NOT NULL UNIQUE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_device_id TEXT,
            protocol_version SMALLINT NOT NULL DEFAULT 1,
            capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            appearance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            queue_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            current_index INTEGER NOT NULL DEFAULT 0,
            position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
            repeat_mode TEXT NOT NULL DEFAULT 'off',
            shuffle BOOLEAN NOT NULL DEFAULT FALSE,
            revision BIGINT NOT NULL DEFAULT 0,
            last_mutation_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            CONSTRAINT ck_cast_playback_sessions_current_index
                CHECK (current_index >= 0),
            CONSTRAINT ck_cast_playback_sessions_position_seconds
                CHECK (position_seconds >= 0),
            CONSTRAINT ck_cast_playback_sessions_repeat_mode
                CHECK (repeat_mode IN ('off', 'one', 'all')),
            CONSTRAINT ck_cast_playback_sessions_revision
                CHECK (revision >= 0)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cast_playback_sessions_user_created
        ON cast_playback_sessions(user_id, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cast_playback_sessions_expiry
        ON cast_playback_sessions(expires_at, last_used_at)
        WHERE revoked_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_cast_playback_sessions_expiry")
    op.execute("DROP INDEX IF EXISTS idx_cast_playback_sessions_user_created")
    op.execute("DROP TABLE IF EXISTS cast_playback_sessions")
