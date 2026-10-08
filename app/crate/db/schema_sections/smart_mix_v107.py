from __future__ import annotations

from typing import Any


def create_smart_mix_target_generation_v107_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE track_processing_state
            ADD COLUMN IF NOT EXISTS target_generation TEXT
        """
    )
