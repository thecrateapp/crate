from __future__ import annotations

from typing import Any


def create_smart_mix_vocal_detector_v148_schema(cur: Any) -> None:
    """The detector that computed a profile's per-phrase voice (SM3-D13).

    NULL whenever ``vocal_presence`` is NULL; a new detector replaces profiles of the
    same analyzer version so the voice is recomputed.
    """
    cur.execute(
        """
        ALTER TABLE track_mix_profiles
            ADD COLUMN IF NOT EXISTS vocal_detector TEXT
        """
    )
