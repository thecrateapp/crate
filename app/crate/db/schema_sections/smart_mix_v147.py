from __future__ import annotations

from typing import Any


def create_smart_mix_structure_v147_schema(cur: Any) -> None:
    """Phrases, per-bar energy, optional per-phrase voice and segmentation confidence.

    All nullable: schema-1 profiles keep NULL until the backfill recomputes them.
    """
    cur.execute(
        """
        ALTER TABLE track_mix_profiles
            ADD COLUMN IF NOT EXISTS phrases JSONB,
            ADD COLUMN IF NOT EXISTS energy_curve BYTEA,
            ADD COLUMN IF NOT EXISTS vocal_presence BYTEA,
            ADD COLUMN IF NOT EXISTS structure_confidence REAL
        """
    )
