"""Phrase and bar positions on a stored beat grid, in pure Python.

The analysis modules (``structure``, ``vocals``) need numpy, which the API image does
not install. Readers that only place stored phrases on the grid, such as the Admin
structure endpoint, import these helpers from here.
"""

from __future__ import annotations

from bisect import bisect_left
from collections.abc import Sequence
from statistics import median

from crate.smart_mix.models import Phrase

BEATS_PER_BAR = 4
# Beat This! downbeats (SM3-D14): a model downbeat votes for the bar phase of the grid
# beat within this distance, and the winning phase must hold this share of the votes.
# A downbeat that matches no grid beat (where Beat This! slides half a beat off the grid
# in a section) votes for no phase, but at least this share of the model downbeats that
# fall within the grid must vote. Same constants as tools/crate-cli/src/
# beat_tracking.rs.
MODEL_DOWNBEAT_TOLERANCE_MS = 70
MODEL_DOWNBEAT_MIN_SHARE = 0.6
MODEL_DOWNBEAT_MIN_ON_GRID = 0.5


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


def downbeat_anchor_from_model(
    beat_grid_ms: Sequence[int],
    downbeats_ms: Sequence[int],
    *,
    tolerance_ms: int = MODEL_DOWNBEAT_TOLERANCE_MS,
    min_share: float = MODEL_DOWNBEAT_MIN_SHARE,
    min_on_grid: float = MODEL_DOWNBEAT_MIN_ON_GRID,
) -> int | None:
    """The first beat of the bar phase (beat index mod 4) holding the model downbeats.

    Each model downbeat between the first and the last grid beat (within the
    tolerance) counts; it votes for the phase of its nearest grid beat when that beat
    is within ``tolerance_ms``. A downbeat further from every beat says nothing about
    the grid's bar and votes for no phase. The phase with the most votes anchors the
    bars if it holds at least ``min_share`` of the votes and at least ``min_on_grid``
    of the counted downbeats voted; otherwise the track has no downbeat, and so no
    phrases. Any anchor of the former rule (``min_share`` of the counted downbeats) is
    still the same anchor.
    """
    grid = list(beat_grid_ms)
    if not grid:
        return None
    votes = [0] * BEATS_PER_BAR
    counted = 0
    for downbeat in downbeats_ms:
        if not grid[0] - tolerance_ms <= downbeat <= grid[-1] + tolerance_ms:
            continue
        counted += 1
        index = _nearest_beat(grid, downbeat)
        if abs(grid[index] - downbeat) <= tolerance_ms:
            votes[index % BEATS_PER_BAR] += 1
    on_grid = sum(votes)
    if not on_grid or on_grid < min_on_grid * counted:
        return None
    # On a tie the earlier phase wins; a tie never reaches a share above one half.
    phase = max(
        range(BEATS_PER_BAR), key=lambda candidate: (votes[candidate], -candidate)
    )
    if votes[phase] < min_share * on_grid:
        return None
    return int(grid[phase])


def _nearest_beat(grid: list[int], position: int) -> int:
    """Index of the grid beat nearest ``position``; the earlier one on a tie."""
    after = bisect_left(grid, position)
    if after == 0:
        return 0
    if after == len(grid):
        return len(grid) - 1
    before = after - 1
    return before if position - grid[before] <= grid[after] - position else after


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


__all__ = [
    "BEATS_PER_BAR",
    "MODEL_DOWNBEAT_MIN_ON_GRID",
    "MODEL_DOWNBEAT_MIN_SHARE",
    "MODEL_DOWNBEAT_TOLERANCE_MS",
    "downbeat_anchor_from_model",
    "downbeats_from_anchor",
    "phrase_spans_ms",
]
