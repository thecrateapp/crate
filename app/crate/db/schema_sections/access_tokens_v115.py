from __future__ import annotations

from typing import Any


def create_playback_continuation_token_v115_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE user_access_tokens
            ADD COLUMN IF NOT EXISTS session_id TEXT
                REFERENCES sessions(id) ON DELETE CASCADE
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_access_tokens_session
        ON user_access_tokens(session_id)
        WHERE session_id IS NOT NULL
        """
    )
