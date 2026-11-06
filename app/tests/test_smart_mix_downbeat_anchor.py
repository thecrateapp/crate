"""Downbeat anchor from the model's downbeats (SM3-D14).

The bar phase (beat index mod 4) of the published grid that collects the most model
downbeats within the tolerance is the anchor, if it collects at least ``min_share`` of
the model downbeats that fall within the grid. Same rule and constants as
``tools/crate-cli/src/beat_tracking.rs``.
"""

from __future__ import annotations

from crate.smart_mix.phrase_grid import (
    MODEL_DOWNBEAT_MIN_SHARE,
    MODEL_DOWNBEAT_TOLERANCE_MS,
    downbeat_anchor_from_model,
)

BEAT_MS = 500
GRID = tuple(1_000 + BEAT_MS * beat for beat in range(64))


def _downbeats(phase: int, beats: range | None = None) -> list[int]:
    return [GRID[beat] for beat in (beats or range(64)) if beat % 4 == phase]


def test_rule_constants_match_the_design() -> None:
    assert (MODEL_DOWNBEAT_TOLERANCE_MS, MODEL_DOWNBEAT_MIN_SHARE) == (70, 0.6)


def test_picks_phase_with_most_model_downbeats() -> None:
    # A pickup: the model hears the bar start on the third beat of the grid, with
    # a couple of stray downbeats on another phase.
    downbeats = sorted(_downbeats(2) + [GRID[4], GRID[40]])

    assert downbeat_anchor_from_model(GRID, downbeats) == GRID[2]


def test_no_anchor_below_min_share() -> None:
    # Half the bars on one phase and half on another: no phase holds 60 %.
    split = _downbeats(0, range(32)) + _downbeats(2, range(32, 64))
    # Three beats to the bar never settle on one phase of a four-beat grid.
    waltz = [GRID[beat] for beat in range(0, 64, 3)]

    assert downbeat_anchor_from_model(GRID, split) is None
    assert downbeat_anchor_from_model(GRID, waltz) is None
    assert downbeat_anchor_from_model(GRID, []) is None
    assert downbeat_anchor_from_model((), _downbeats(0)) is None


def test_share_counts_only_downbeats_that_fall_within_the_grid() -> None:
    # Downbeats before the first beat or after the last (a scan that stops early)
    # neither vote nor dilute the share.
    outside = [10, 200, GRID[-1] + 2_000, GRID[-1] + 4_000]
    downbeats = sorted(outside + _downbeats(1))

    assert downbeat_anchor_from_model(GRID, downbeats) == GRID[1]


def test_tolerates_jitter_within_tolerance() -> None:
    jittered = [
        position + (60 if index % 2 else -60)
        for index, position in enumerate(_downbeats(3))
    ]
    # Off by more than the tolerance they match no beat, so no phase reaches the share.
    late = [position + MODEL_DOWNBEAT_TOLERANCE_MS + 30 for position in _downbeats(3)]

    assert downbeat_anchor_from_model(GRID, jittered) == GRID[3]
    assert downbeat_anchor_from_model(GRID, late) is None


def test_exact_share_at_the_threshold_anchors() -> None:
    # Six of ten downbeats on phase 0 is exactly 60 %.
    downbeats = sorted(
        _downbeats(0, range(24)) + [GRID[beat] for beat in (1, 5, 9, 13)]
    )

    assert len(downbeats) == 10
    assert downbeat_anchor_from_model(GRID, downbeats) == GRID[0]
    assert downbeat_anchor_from_model(GRID, downbeats, min_share=0.61) is None


def test_a_tracked_grid_with_uneven_beats_uses_the_nearest_beat() -> None:
    # A tracked grid (no constant tempo) drifts: each downbeat votes for its nearest
    # beat, whatever the spacing.
    grid = tuple(1_000 + 480 * beat + 2 * beat * beat for beat in range(40))
    downbeats = [grid[beat] + 20 for beat in range(1, 40, 4)]

    assert downbeat_anchor_from_model(grid, downbeats) == grid[1]
