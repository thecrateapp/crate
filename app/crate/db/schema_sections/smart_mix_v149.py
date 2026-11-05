from __future__ import annotations

from typing import Any


def create_smart_mix_beat_tracker_v149_schema(cur: Any) -> None:
    """The model that gave a profile's beats and downbeats (SM3-D14).

    NULL when the analyzer used its own beat tracker; a draft that brings a tracker
    replaces profiles of the same analyzer version and quality that lack it.
    """
    cur.execute(
        """
        ALTER TABLE track_mix_profiles
            ADD COLUMN IF NOT EXISTS beat_tracker TEXT
        """
    )
