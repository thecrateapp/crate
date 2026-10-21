from __future__ import annotations

from typing import Any


def create_smart_mix_local_tempo_v117_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE track_mix_profiles
            ADD COLUMN IF NOT EXISTS intro_bpm DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS intro_beat_ms BIGINT,
            ADD COLUMN IF NOT EXISTS outro_bpm DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS outro_beat_ms BIGINT
        """
    )
