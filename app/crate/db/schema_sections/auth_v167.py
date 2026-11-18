from __future__ import annotations

from typing import Any


def create_users_password_change_required_v167_schema(cur: Any) -> None:
    cur.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN NOT NULL DEFAULT FALSE"
    )
