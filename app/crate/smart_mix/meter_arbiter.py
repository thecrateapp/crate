"""A second opinion on bars of three, from madmom's own downbeat model.

Beat This!'s DBN hears fast 4/4 punk and metal (d-beat, thrash, death) in three, and
since SM3-D16 a track in three gets no downbeat and no phrases. madmom's recurrent
downbeat network, decoded by the same kind of DBN, is an independent model: on the
evaluation sets it heard four on eight of the nine such tracks it read and three on
the two most likely to be in three. ``beat_model`` asks it only when Beat This!'s DBN
prefers three, about 2.5 % of tracks, and keeps bars of three only if it agrees.

madmom's networks are CC BY-NC-SA 4.0; Crate is free and open source, and Diego
approved running them in production (gate MG1, 2026-11-09). They ship with the madmom
package the analysis image installs; nothing is downloaded at run time.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

ARBITER_NAME = "madmom-dbn"
# madmom's downbeat network reads 44.1 kHz audio at 100 frames per second.
ARBITER_SAMPLE_RATE = 44_100
ARBITER_FPS = 100
ARBITER_BEATS_PER_BAR = (3, 4)


class MadmomMeterArbiter:
    """The bar length (3 or 4) madmom's downbeat network and DBN prefer for a file."""

    def __init__(self) -> None:
        from madmom.features.downbeats import (
            DBNDownBeatTrackingProcessor,
            RNNDownBeatProcessor,
        )

        # One thread: the analysis worker already runs one profile per process.
        self._network = RNNDownBeatProcessor(num_threads=1)
        self._dbn = DBNDownBeatTrackingProcessor(
            beats_per_bar=list(ARBITER_BEATS_PER_BAR), fps=ARBITER_FPS
        )

    def __call__(self, path: str | Path) -> int | None:
        from madmom.audio.signal import Signal

        from crate.smart_mix.beat_model import _load_signal

        samples, rate = _load_signal(Path(path), ARBITER_SAMPLE_RATE)
        activations = self._network(Signal(samples, sample_rate=rate, num_channels=1))
        return meter_from_activations(self._dbn, activations)


def meter_from_activations(dbn: Any, activations: Any) -> int | None:
    """The bar length whose path the DBN scores higher, or None without beats."""
    from crate.smart_mix.beat_model import decode_bar_paths

    best = decode_bar_paths(dbn, activations).best()
    return None if best is None else best.beats_per_bar


@lru_cache(maxsize=1)
def load_meter_arbiter() -> MadmomMeterArbiter | None:
    """The process-wide arbiter, or None when madmom or its networks are missing."""
    try:
        return MadmomMeterArbiter()
    except Exception:
        log.warning(
            "madmom's downbeat network could not be loaded; tracks the DBN hears in "
            "three keep bars of three",
            exc_info=True,
        )
        return None


__all__ = [
    "ARBITER_BEATS_PER_BAR",
    "ARBITER_FPS",
    "ARBITER_NAME",
    "ARBITER_SAMPLE_RATE",
    "MadmomMeterArbiter",
    "load_meter_arbiter",
    "meter_from_activations",
]
