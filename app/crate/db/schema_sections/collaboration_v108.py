from __future__ import annotations

from typing import Any


def create_collaboration_visibility_v108_schema(cur: Any) -> None:
    cur.execute(
        "UPDATE playlists SET visibility = 'private' WHERE visibility IS NULL OR visibility NOT IN ('private', 'public')"
    )
    cur.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'playlists_visibility_check'
            ) THEN
                ALTER TABLE playlists
                ADD CONSTRAINT playlists_visibility_check CHECK (visibility IN ('private', 'public'));
            END IF;
        END $$
        """
    )
    cur.execute(
        "UPDATE playlist_invites SET expires_at = NOW() WHERE expires_at IS NULL OR expires_at > NOW()"
    )
    cur.execute(
        "UPDATE crate_invites SET expires_at = NOW() WHERE expires_at IS NULL OR expires_at > NOW()"
    )
