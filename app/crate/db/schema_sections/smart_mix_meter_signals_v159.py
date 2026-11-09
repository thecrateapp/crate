from __future__ import annotations

from typing import Any


def create_smart_mix_meter_signals_v159_schema(cur: Any) -> None:
    """How a track's bar length was chosen, kept with its model beats.

    ``meter_margin`` is log p(3 beats) - log p(4 beats) of Beat This!'s DBN per 1,000
    frames; ``meter_arbiter`` is madmom's verdict (``madmom-dbn-3`` or ``-4``) when the
    DBN preferred three, NULL when it was not asked. Beats of three stored without a
    verdict predate the arbiter, so they are recomputed.
    """
    cur.execute(
        """
        ALTER TABLE track_mix_signals
            ADD COLUMN IF NOT EXISTS meter_margin REAL,
            ADD COLUMN IF NOT EXISTS meter_arbiter TEXT
        """
    )


__all__ = ["create_smart_mix_meter_signals_v159_schema"]
