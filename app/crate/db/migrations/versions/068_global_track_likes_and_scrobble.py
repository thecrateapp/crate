"""Global track likes and playback provenance.

Revision ID: 068
Revises: 067a
"""

from collections.abc import Sequence

from alembic import op


revision = "068"
down_revision = "067a"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_global_track_likes (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            global_track_uid UUID NOT NULL
                REFERENCES global_catalog_tracks(global_track_uid) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, global_track_uid)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_global_track_likes_created
        ON user_global_track_likes(user_id, created_at DESC, global_track_uid)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_global_track_like_repairs (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            legacy_track_id INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            status TEXT NOT NULL DEFAULT 'unresolved',
            reason TEXT NOT NULL DEFAULT 'global_track_not_found',
            last_attempt_at TIMESTAMPTZ,
            resolved_at TIMESTAMPTZ,
            PRIMARY KEY (user_id, legacy_track_id),
            CONSTRAINT ck_global_track_like_repair_status
                CHECK (status IN ('unresolved', 'resolved'))
        )
        """
    )
    op.execute(
        """
        INSERT INTO user_global_track_likes (user_id, global_track_uid, created_at)
        SELECT DISTINCT ON (legacy.user_id, global_track.global_track_uid)
            legacy.user_id,
            global_track.global_track_uid,
            legacy.created_at
        FROM user_liked_tracks legacy
        JOIN global_catalog_tracks global_track
          ON global_track.local_track_id = legacy.track_id
        ORDER BY legacy.user_id, global_track.global_track_uid, legacy.created_at ASC
        ON CONFLICT (user_id, global_track_uid) DO UPDATE
        SET created_at = LEAST(
            user_global_track_likes.created_at,
            EXCLUDED.created_at
        )
        """
    )
    op.execute(
        """
        INSERT INTO user_global_track_like_repairs
            (user_id, legacy_track_id, created_at, status, reason)
        SELECT legacy.user_id, legacy.track_id, legacy.created_at,
               'unresolved', 'global_track_not_found'
        FROM user_liked_tracks legacy
        WHERE NOT EXISTS (
            SELECT 1 FROM global_catalog_tracks global_track
            WHERE global_track.local_track_id = legacy.track_id
        )
        ON CONFLICT (user_id, legacy_track_id) DO NOTHING
        """
    )
    op.execute(
        """
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS remote_scrobbling_enabled BOOLEAN NOT NULL DEFAULT FALSE
        """
    )
    op.execute(
        """
        ALTER TABLE user_play_events
            ADD COLUMN IF NOT EXISTS content_origin TEXT NOT NULL DEFAULT 'local',
            ADD COLUMN IF NOT EXISTS source_node_uid UUID
        """
    )
    op.execute(
        """
        ALTER TABLE user_play_events
            DROP CONSTRAINT IF EXISTS ck_user_play_event_content_origin,
            ADD CONSTRAINT ck_user_play_event_content_origin CHECK (
                content_origin IN ('local', 'remote', 'imported')
                AND (content_origin <> 'remote' OR source_node_uid IS NOT NULL)
                AND (source_node_uid IS NULL OR content_origin IN ('remote', 'imported'))
            )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_play_events_source_node
        ON user_play_events(source_node_uid, ended_at DESC)
        WHERE source_node_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_scrobble_dispatches (
            event_id BIGINT PRIMARY KEY
                REFERENCES user_play_events(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            locked_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            CONSTRAINT ck_user_scrobble_dispatch_status
                CHECK (status IN ('pending', 'processing', 'completed', 'skipped', 'failed'))
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_scrobble_dispatches")
    op.execute("DROP INDEX IF EXISTS idx_user_play_events_source_node")
    op.execute(
        """
        ALTER TABLE user_play_events
            DROP CONSTRAINT IF EXISTS ck_user_play_event_content_origin,
            DROP COLUMN IF EXISTS source_node_uid,
            DROP COLUMN IF EXISTS content_origin
        """
    )
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS remote_scrobbling_enabled")
    op.execute("DROP TABLE IF EXISTS user_global_track_like_repairs")
    op.execute("DROP INDEX IF EXISTS idx_user_global_track_likes_created")
    op.execute("DROP TABLE IF EXISTS user_global_track_likes")
