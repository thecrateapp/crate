from __future__ import annotations

from typing import Any


def create_playback_continuation_descriptor_v116_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE user_access_tokens
            ADD COLUMN IF NOT EXISTS continuation_descriptor JSONB
        """
    )
