from __future__ import annotations

from typing import Any


def create_users_timezone_v104_schema(cur: Any) -> None:
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT")
