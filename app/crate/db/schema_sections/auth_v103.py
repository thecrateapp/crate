from __future__ import annotations

from typing import Any


def create_users_instagram_v103_schema(cur: Any) -> None:
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_handle TEXT")
