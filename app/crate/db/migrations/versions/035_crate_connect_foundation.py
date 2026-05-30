"""Add Crate Connect device and playback state tables.

Revision ID: 035
Revises: 034
"""

from typing import Sequence, Union

from alembic import op


revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_devices (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            device_label TEXT,
            device_type TEXT,
            app_platform TEXT,
            app_version TEXT,
            capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            last_session_id TEXT,
            last_seen_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            revoked_at TIMESTAMPTZ,
            UNIQUE (user_id, device_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_devices_user_seen
        ON user_devices(user_id, last_seen_at DESC)
        WHERE revoked_at IS NULL
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS user_playback_device_states (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            playback_session_id UUID,
            status TEXT NOT NULL,
            track_id INTEGER,
            track_entity_uid UUID,
            track_path TEXT,
            title TEXT,
            artist TEXT,
            album TEXT,
            album_cover TEXT,
            position_ms INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER,
            current_index INTEGER NOT NULL DEFAULT 0,
            queue_revision TEXT,
            queue_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            play_source_json JSONB,
            repeat_mode TEXT NOT NULL DEFAULT 'off',
            shuffle BOOLEAN NOT NULL DEFAULT false,
            unshuffled_queue_json JSONB,
            playback_rate DOUBLE PRECISION NOT NULL DEFAULT 1,
            app_platform TEXT,
            device_type TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ,
            PRIMARY KEY (user_id, device_id),
            FOREIGN KEY (user_id, device_id)
                REFERENCES user_devices(user_id, device_id)
                ON DELETE CASCADE
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_playback_states_user_updated
        ON user_playback_device_states(user_id, updated_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_playback_states_track_entity
        ON user_playback_device_states(track_entity_uid)
        WHERE track_entity_uid IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_user_playback_states_track_entity")
    op.execute("DROP INDEX IF EXISTS idx_user_playback_states_user_updated")
    op.execute("DROP TABLE IF EXISTS user_playback_device_states")
    op.execute("DROP INDEX IF EXISTS idx_user_devices_user_seen")
    op.execute("DROP TABLE IF EXISTS user_devices")
