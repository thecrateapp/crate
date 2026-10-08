from __future__ import annotations

from typing import Any


def create_smart_mix_measurement_v106_schema(cur: Any) -> None:
    cur.execute(
        """
        ALTER TABLE track_mix_profiles
            ADD COLUMN IF NOT EXISTS duration_ms BIGINT,
            ADD COLUMN IF NOT EXISTS active_start_ms BIGINT,
            ADD COLUMN IF NOT EXISTS active_end_ms BIGINT,
            ADD COLUMN IF NOT EXISTS integrated_lufs DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS measurement_version TEXT
        """
    )
