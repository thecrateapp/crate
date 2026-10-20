from __future__ import annotations

from typing import Any


def create_smart_mix_cue_beats_v118_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE track_mix_profiles
            ADD COLUMN IF NOT EXISTS intro_tempo_stability DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS outro_tempo_stability DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS intro_downbeat_ms BIGINT,
            ADD COLUMN IF NOT EXISTS outro_downbeat_ms BIGINT
        """
    )
