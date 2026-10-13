from __future__ import annotations

from typing import Any


def create_users_pulse_listed_v106_schema(cur: Any) -> None:
    cur.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS pulse_listed BOOLEAN NOT NULL DEFAULT TRUE"
    )
