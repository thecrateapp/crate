"""Phrase and bar positions on a stored beat grid, in pure Python.

The analysis modules (``structure``, ``vocals``) need numpy, which the API image does
not install. Readers that only place stored phrases on the grid, such as the Admin
structure endpoint, import these helpers from here.
"""

from __future__ import annotations

from collections.abc import Sequence
from statistics import median

from crate.smart_mix.models import Phrase

BEATS_PER_BAR = 4


def downbeats_from_anchor(
    beat_grid_ms: Sequence[int], downbeat_anchor_ms: int | None
) -> tuple[int, ...]:
    """Every fourth beat of the grid, in phase with the downbeat anchor."""
    if downbeat_anchor_ms is None:
        return ()
    try:
        anchor = list(beat_grid_ms).index(downbeat_anchor_ms)
    except ValueError:
        return ()
    return tuple(beat_grid_ms[anchor % BEATS_PER_BAR :: BEATS_PER_BAR])


def phrase_spans_ms(
    phrases: Sequence[Phrase], beat_grid_ms: Sequence[int]
) -> list[tuple[int, int]]:
    """Start and end (ms) of each phrase.

    A phrase ends where the next starts; the last one ends ``bars`` bars after its
    start on the beat grid, continued at the grid's median beat when it runs past it.
    """
    spans: list[tuple[int, int]] = []
    for current, following in zip(phrases, phrases[1:]):
        spans.append((current.start_ms, following.start_ms))
    if phrases:
        last = phrases[-1]
        spans.append((last.start_ms, _beat_ms(beat_grid_ms, last, last.bars)))
    return spans


def _beat_ms(beat_grid_ms: Sequence[int], phrase: Phrase, bars: int) -> int:
    if not beat_grid_ms:
        return phrase.start_ms
    beat = phrase.start_beat + bars * BEATS_PER_BAR
    if beat < len(beat_grid_ms):
        return int(beat_grid_ms[beat])
    beat_length = (
        float(median(b - a for a, b in zip(beat_grid_ms, beat_grid_ms[1:])))
        if len(beat_grid_ms) > 1
        else 0
    )
    last = len(beat_grid_ms) - 1
    return int(round(beat_grid_ms[last] + (beat - last) * beat_length))


__all__ = ["BEATS_PER_BAR", "downbeats_from_anchor", "phrase_spans_ms"]
