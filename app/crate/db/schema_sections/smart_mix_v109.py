from __future__ import annotations

from typing import Any


def create_smart_mix_source_stale_v109_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE track_mix_profiles
            ADD COLUMN IF NOT EXISTS source_stale_at TIMESTAMPTZ
        """
    )
