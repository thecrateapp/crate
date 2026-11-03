"""Constant-tempo grid fitted to the tracked beats. Same method and constants as
``tools/crate-cli/src/tempo_grid.rs``.

The beat tracker follows the strongest onsets and, in a break where the off-beats are
louder, can lock onto them for a few bars and come back. Analyzer v5 published those
beats and took the tempo from a regression of beat index against time, so one slip moved
the BPM by about 1/N and the grid sat half a beat off through the break. This fit
maximises the coherence of the beat times at twice the beat rate, where a beat on the
off-beat lines up with one on the beat. A constant grid is published only when the
beats stay close to it along most of the track, and it is marked when some stretch of
them keeps another tempo; its tempo snaps to a whole or half BPM if
that keeps the grid within 25 ms over the track, and the majority of the tracked beats
picks its phase unless both the bass and the broadband onsets are clearly stronger on
the other half-beat phase.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


MIN_BEATS = 32
SEARCH_SPAN = 0.03
MIN_COHERENCE = 0.5
BLOCK_BEATS = 16
BEAT_TOLERANCE_MS = 35.0
BLOCK_TOLERANCE_MS = 25.0
MIN_STEADY_BLOCKS = 0.8
# A constant grid cannot back a full profile when SECTION_MIN_RUNS consecutive runs of
# SECTION_BEATS tracked beats keep their own tempo at least SECTION_TEMPO_CHANGE away
# from the grid's and are clearly less coherent at the grid's tempo.
SECTION_BEATS = 24
SECTION_STEP_BEATS = 4
SECTION_MIN_RUNS = 2
SECTION_TEMPO_CHANGE = 0.02
SECTION_MIN_COHERENCE = 0.6
SECTION_MAX_GRID_SHARE = 0.6
SECTION_SEARCH_SPAN = 0.08
SNAP_DRIFT_MS = 25.0
PHASE_FLIP_RATIO = 1.25
ONSET_WINDOW_FRAMES = 2
SLIDE_WINDOW_BEATS = 6
SLIDE_MIN_FRACTION = 0.4
SLIDE_CONTEXT_BEATS = 8
SLIDE_MAX_TEMPO_CHANGE = 0.03


@dataclass(frozen=True, slots=True)
class ConstantGrid:
    bpm: float
    period_ms: float
    anchor_ms: float
    phase_support: float
    phase_flipped: bool
    tempo_deviates: bool = False

    def beats_ms(self, from_ms: float, to_ms: float) -> tuple[int, ...]:
        first = int(_round_half_away((from_ms - self.anchor_ms) / self.period_ms))
        last = int(_round_half_away((to_ms - self.anchor_ms) / self.period_ms))
        positions = (
            self.anchor_ms + index * self.period_ms for index in range(first, last + 1)
        )
        return tuple(
            int(_round_half_away(position)) for position in positions if position >= 1.0
        )

    def beat_near_ms(self, position_ms: float) -> float:
        return (
            self.anchor_ms
            + _round_half_away((position_ms - self.anchor_ms) / self.period_ms)
            * self.period_ms
        )


@dataclass(frozen=True, slots=True)
class TempoFit:
    bpm: float
    coherence: float
    grid: ConstantGrid | None


def _round_half_away(value: float) -> float:
    """Rust's ``f64::round`` (half away from zero), not Python's banker's rounding."""
    return math.copysign(math.floor(abs(value) + 0.5), value)


def _wrap(values: np.ndarray, period: float) -> np.ndarray:
    return (
        values - np.copysign(np.floor(np.abs(values / period) + 0.5), values) * period
    )


def _resultant(
    times: np.ndarray, period: float, harmonic: float
) -> tuple[float, float]:
    angles = 2.0 * math.pi * harmonic * times / period
    sine, cosine = float(np.sum(np.sin(angles))), float(np.sum(np.cos(angles)))
    return math.hypot(sine, cosine) / times.size, math.atan2(sine, cosine)


def _median(values: np.ndarray) -> float:
    ordered = np.sort(values)
    return float(ordered[ordered.size // 2])


def _best_period(
    times: np.ndarray, initial: float, span: float, search_span: float = SEARCH_SPAN
) -> tuple[float, float]:
    step = max(initial * initial / (16.0 * span), 1e-3)

    def search(start: float, stop: float, step: float) -> tuple[float, float]:
        periods = np.arange(start, stop + step / 2, step)
        angles = 4.0 * math.pi * times[None, :] / periods[:, None]
        coherence = np.hypot(np.sin(angles).sum(axis=1), np.cos(angles).sum(axis=1))
        best = int(np.argmax(coherence))
        return float(periods[best]), float(coherence[best]) / times.size

    coarse, _ = search(
        initial * (1.0 - search_span), initial * (1.0 + search_span), step
    )
    return search(coarse - step, coarse + step, step / 20.0)


def _is_steady(times: np.ndarray, period: float, lattice: float) -> bool:
    residuals = _wrap(times - lattice, period / 2.0)
    blocks = [
        residuals[start : start + BLOCK_BEATS]
        for start in range(0, residuals.size, BLOCK_BEATS)
        if residuals[start : start + BLOCK_BEATS].size * 2 >= BLOCK_BEATS
    ]
    steady = sum(
        1
        for block in blocks
        if 2 * int(np.sum(np.abs(block) <= BEAT_TOLERANCE_MS)) >= block.size
        and abs(_median(block)) <= BLOCK_TOLERANCE_MS
    )
    return bool(blocks) and steady >= MIN_STEADY_BLOCKS * len(blocks)


def _has_section_at_another_tempo(times: np.ndarray, period: float) -> bool:
    consecutive = 0
    for start in range(0, times.size - SECTION_BEATS + 1, SECTION_STEP_BEATS):
        run = times[start : start + SECTION_BEATS]
        local, coherence = _best_period(
            run, period, float(run[-1] - run[0]), SECTION_SEARCH_SPAN
        )
        at_grid, _ = _resultant(run, period, 2.0)
        elsewhere = (
            coherence >= SECTION_MIN_COHERENCE
            and abs(local / period - 1.0) >= SECTION_TEMPO_CHANGE
            and at_grid <= SECTION_MAX_GRID_SHARE * coherence
        )
        consecutive = consecutive + 1 if elsewhere else 0
        if consecutive >= SECTION_MIN_RUNS:
            return True
    return False


def _snapped_period(period: float, span: float) -> float:
    bpm = 60_000.0 / period
    for fraction in (1.0, 2.0):
        candidate = 60_000.0 / (_round_half_away(bpm * fraction) / fraction)
        if abs(candidate - period) * span / period <= SNAP_DRIFT_MS:
            return candidate
    return period


def _onset_evidence(
    onsets: np.ndarray,
    low_onsets: np.ndarray,
    frame_ms: float,
    phase: float,
    period: float,
    tracked: tuple[float, float],
) -> tuple[float, float]:
    """Median onset peak around the grid positions: the typical beat position, so one
    loud section cannot decide the phase of the whole track."""

    def peak(values: np.ndarray, frame: int) -> float:
        start = max(0, frame - ONSET_WINDOW_FRAMES)
        end = min(values.size, frame + ONSET_WINDOW_FRAMES + 1)
        return float(np.max(values[start:end])) if start < end else 0.0

    broad, low = [], []
    position = phase + math.ceil((tracked[0] - phase) / period) * period
    while position <= tracked[1]:
        frame = int(_round_half_away(position / frame_ms))
        if frame < onsets.size:
            broad.append(peak(onsets, frame))
            low.append(peak(low_onsets, frame))
        position += period
    if not broad:
        return 0.0, 0.0
    return _median(np.asarray(broad)), _median(np.asarray(low))


def fit_tempo(
    beats_ms,
    onsets: np.ndarray,
    low_onsets: np.ndarray,
    *,
    frame_ms: float,
) -> TempoFit | None:
    """Strongest constant pulse of the tracked beats (ms) and, when the track keeps it,
    a constant grid checked against the onset envelopes (one value per ``frame_ms``)."""
    if len(beats_ms) < MIN_BEATS or frame_ms <= 0:
        return None
    times = np.asarray(beats_ms, dtype=np.float64)
    span = float(times[-1] - times[0])
    initial = _median(np.diff(times))
    if initial <= 0 or span <= 0:
        return None
    fitted, coherence = _best_period(times, initial, span)

    def lattice(period: float) -> float:
        _, angle = _resultant(times, period, 2.0)
        return (angle / (2.0 * math.pi) * period / 2.0) % (period / 2.0)

    bpm = 60_000.0 / fitted
    if coherence < MIN_COHERENCE or not _is_steady(times, fitted, lattice(fitted)):
        return TempoFit(bpm=bpm, coherence=coherence, grid=None)

    period = _snapped_period(fitted, span)
    on_beat = lattice(period)
    off_beat = on_beat + period / 2.0

    def near(phase: float) -> float:
        return float(np.mean(np.abs(_wrap(times - phase, period)) < period / 4.0))

    support = near(on_beat)
    majority, minority = (on_beat, off_beat) if support >= 0.5 else (off_beat, on_beat)
    tracked = (float(times[0]), float(times[-1]))
    onsets = np.asarray(onsets, dtype=np.float64)
    low_onsets = np.asarray(low_onsets, dtype=np.float64)
    majority_broad, majority_low = _onset_evidence(
        onsets, low_onsets, frame_ms, majority, period, tracked
    )
    minority_broad, minority_low = _onset_evidence(
        onsets, low_onsets, frame_ms, minority, period, tracked
    )
    flipped = (
        minority_broad >= PHASE_FLIP_RATIO * majority_broad
        and minority_low >= PHASE_FLIP_RATIO * majority_low
    )
    phase = minority if flipped else majority
    offsets = _wrap(times - phase, period)
    offsets = offsets[np.abs(offsets) < period / 4.0]
    anchor = phase + _median(offsets) if offsets.size else phase
    return TempoFit(
        bpm=bpm,
        coherence=coherence,
        grid=ConstantGrid(
            bpm=60_000.0 / period,
            period_ms=period,
            anchor_ms=anchor,
            phase_support=near(phase),
            phase_flipped=flipped,
            tempo_deviates=_has_section_at_another_tempo(times, period),
        ),
    )


def half_beat_slides(beats_ms) -> int:
    """Places where the tracked beats slide half a beat (a short run of intervals that
    spans a whole and a half beats of the tempo around it, with the same tempo before
    and after), which leaves part of the grid on the off-beat."""
    intervals = np.diff(np.asarray(beats_ms, dtype=np.float64))
    slides = 0
    index = SLIDE_CONTEXT_BEATS
    while index + SLIDE_WINDOW_BEATS + SLIDE_CONTEXT_BEATS <= intervals.size:
        after_start = index + SLIDE_WINDOW_BEATS
        before = _median(intervals[index - SLIDE_CONTEXT_BEATS : index])
        after = _median(intervals[after_start : after_start + SLIDE_CONTEXT_BEATS])
        period = 0.5 * (before + after)
        beats = (
            float(np.sum(intervals[index:after_start])) / period if period > 0 else 0.0
        )
        if (
            period > 0
            and abs(before - after) / period <= SLIDE_MAX_TEMPO_CHANGE
            and abs(beats - _round_half_away(beats)) >= SLIDE_MIN_FRACTION
        ):
            slides += 1
            index = after_start + SLIDE_CONTEXT_BEATS
        else:
            index += 1
    return slides


__all__ = ["ConstantGrid", "TempoFit", "fit_tempo", "half_beat_slides"]
