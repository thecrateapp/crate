from __future__ import annotations

from typing import Any

# Shipped DDL is immutable (db/AGENTS.md rule 7): add a new section to change it.

NATIVE_DEVICE_TOKEN_INDEX = "uq_user_access_tokens_native_device"


def create_native_device_tokens_v170_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE user_access_tokens
            ADD COLUMN IF NOT EXISTS device_id TEXT
        """
    )
    # One active native device token per (session, device_id).
    cur.execute(
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS {NATIVE_DEVICE_TOKEN_INDEX}
        ON user_access_tokens(session_id, device_id)
        WHERE token_type = 'native_device' AND revoked_at IS NULL
        """
    )


def drop_native_device_tokens_v170_schema(cur: Any) -> None:
    cur.execute(f"DROP INDEX IF EXISTS {NATIVE_DEVICE_TOKEN_INDEX}")
    # Older code would treat a leftover native_device token as a VirtualDJ
    # token, so the downgrade removes them instead of orphaning them.
    cur.execute("DELETE FROM user_access_tokens WHERE token_type = 'native_device'")
    cur.execute("ALTER TABLE user_access_tokens DROP COLUMN IF EXISTS device_id")
