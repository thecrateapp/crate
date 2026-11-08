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
picks its phase; a kick clearly stronger on the other half-beat phase contests it, and an
overwhelming one moves the grid onto the kick.
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
# The bass decides the phase against the tracked beats (which follow broadband onsets):
# real bass KICK_CONTEST_RATIO times stronger on the other phase contests it, and
# KICK_FLIP_RATIO times moves the grid onto it. Real bass is at least KICK_MIN_SHARE of
# the 95th percentile of the bass onsets over the tracked span.
KICK_CONTEST_RATIO = 2.0
KICK_FLIP_RATIO = 4.0
KICK_MIN_SHARE = 0.5
ONSET_WINDOW_FRAMES = 2
SLIDE_WINDOW_BEATS = 6
SLIDE_MIN_FRACTION = 0.4
SLIDE_CONTEXT_BEATS = 8
SLIDE_MAX_TEMPO_CHANGE = 0.03
# Beat This! predicts at 50 frames per second and its DBN puts each beat on one of those
# frames, so an interval between two model beats is only known to a frame.
MODEL_BEAT_RESOLUTION_MS = 20.0
# Whole-track stability of model beats reaches 0 at this tempo change between the first
# and the last third of the beats, or at this median interval jitter: the limits both
# analyzers apply to their tracker's beats.
_TRACK_DRIFT_LIMIT = 0.25
_TRACK_JITTER_LIMIT = 0.20


@dataclass(frozen=True, slots=True)
class ConstantGrid:
    bpm: float
    period_ms: float
    anchor_ms: float
    phase_support: float
    phase_flipped: bool
    tempo_deviates: bool = False
    phase_contested: bool = False

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


def _median_bass_at(low_onsets: np.ndarray, frame_ms: float, positions) -> float:
    """Median bass onset peak around the given positions (ms): the typical beat
    position, so one loud section cannot decide the phase of the whole track."""
    peaks = []
    for position in positions:
        frame = int(_round_half_away(position / frame_ms))
        if frame < low_onsets.size:
            start = max(0, frame - ONSET_WINDOW_FRAMES)
            end = min(low_onsets.size, frame + ONSET_WINDOW_FRAMES + 1)
            peaks.append(float(np.max(low_onsets[start:end])))
    return _median(np.asarray(peaks)) if peaks else 0.0


def _lattice_positions(phase: float, period: float, tracked: tuple[float, float]):
    first = math.ceil((tracked[0] - phase) / period)
    last = math.floor((tracked[1] - phase) / period)
    return [phase + index * period for index in range(first, last + 1)]


def _bass_peak(low_onsets: np.ndarray, frame_ms: float, tracked) -> float:
    end = min(int(tracked[1] / frame_ms) + 1, low_onsets.size)
    start = min(int(tracked[0] / frame_ms), end)
    values = np.sort(low_onsets[start:end])
    if not values.size:
        return 0.0
    return float(values[min(int(values.size * 0.95), values.size - 1)])


def _bass_against(chosen: float, other: float, peak: float) -> tuple[bool, bool]:
    real_bass = other > 0.0 and other >= KICK_MIN_SHARE * peak
    return (
        real_bass and other >= KICK_CONTEST_RATIO * chosen,
        real_bass and other >= KICK_FLIP_RATIO * chosen,
    )


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
    contested, flipped = _bass_against(
        _median_bass_at(
            low_onsets, frame_ms, _lattice_positions(majority, period, tracked)
        ),
        _median_bass_at(
            low_onsets, frame_ms, _lattice_positions(minority, period, tracked)
        ),
        _bass_peak(low_onsets, frame_ms, tracked),
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
            phase_contested=contested,
        ),
    )


def bass_contests_tracked_beats(
    beats_ms, onsets: np.ndarray, low_onsets: np.ndarray, *, frame_ms: float
) -> bool:
    """Tracked beats published without a constant grid whose phase the bass contests:
    real bass between consecutive beats, KICK_CONTEST_RATIO times the bass on them."""
    del onsets  # same signature as fit_tempo; only the bass decides
    times = np.asarray(beats_ms, dtype=np.float64)
    if times.size < 2 or frame_ms <= 0:
        return False
    low_onsets = np.asarray(low_onsets, dtype=np.float64)
    on = _median_bass_at(low_onsets, frame_ms, times)
    between = _median_bass_at(low_onsets, frame_ms, (times[:-1] + times[1:]) / 2.0)
    tracked = (float(times[0]), float(times[-1]))
    return _bass_against(on, between, _bass_peak(low_onsets, frame_ms, tracked))[0]


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


def _model_beat_points(
    beats_ms, grid: ConstantGrid | None
) -> tuple[np.ndarray, np.ndarray]:
    """(beat number, time) of each model beat: its beat on the constant grid, or its
    position in the sequence without one. A beat on the same grid beat as the one before
    is left out."""
    times = np.asarray(beats_ms, dtype=np.float64)
    if grid is None:
        return np.arange(times.size, dtype=np.float64), times
    indices = np.array(
        [_round_half_away((time - grid.anchor_ms) / grid.period_ms) for time in times]
    )
    keep = np.ones(times.size, dtype=bool)
    keep[1:] = np.diff(indices) >= 1
    return indices[keep], times[keep]


def _period(indices: np.ndarray, times: np.ndarray) -> float:
    """Least-squares milliseconds per beat number."""
    spread = indices - indices.mean()
    return float(np.dot(spread, times - times.mean()) / np.dot(spread, spread))


def grid_step_intervals(beats_ms, grid: ConstantGrid | None) -> np.ndarray:
    """Intervals between consecutive beats (ms), each divided by the grid beats it spans.

    Model beats need not fall on every beat: Beat This!'s DBN can hold half the tempo
    through an intro, or skip a beat in a break. On a constant grid such an interval
    spans two grid beats and counts as two beats of half its length, and a beat on the
    same grid beat as the one before gives no interval. Without a grid each interval is
    one beat.
    """
    indices, times = _model_beat_points(beats_ms, grid)
    if times.size < 2:
        return np.zeros(0)
    return np.diff(times) / np.diff(indices)


def model_beat_stability(beats_ms, grid: ConstantGrid | None) -> float | None:
    """Steadiness (0..1) of model beats over the whole track, or None with fewer than
    six beats.

    The analyzers' measure of their tracker's beats, tempo drift between the first and
    the last third and median interval jitter, counted in beats of the constant grid,
    so a track whose beats stay on its grid is steady wherever the model skipped beats.
    Beats on 20 ms frames give intervals only known to a frame (a 470 ms pulse gives
    460 and 480 ms), so a frame is forgiven of the jitter, and the tempo of each third
    is a regression over its beats, which averages the frames out.
    """
    indices, times = _model_beat_points(beats_ms, grid)
    if times.size < 6:
        return None
    intervals = np.diff(times) / np.diff(indices)
    median = _median(intervals)
    period = _period(indices, times)
    if median <= 0 or period <= 0:
        return None
    third = max(3, times.size // 3)
    early = _period(indices[:third], times[:third])
    late = _period(indices[-third:], times[-third:])
    drift = abs(late - early) / period
    residual = _median(np.abs(intervals - median)) - MODEL_BEAT_RESOLUTION_MS
    jitter = max(0.0, residual) / median
    return max(
        0.0,
        min(1.0, 1.0 - drift / _TRACK_DRIFT_LIMIT - jitter / _TRACK_JITTER_LIMIT),
    )


__all__ = [
    "MODEL_BEAT_RESOLUTION_MS",
    "ConstantGrid",
    "TempoFit",
    "bass_contests_tracked_beats",
    "fit_tempo",
    "grid_step_intervals",
    "half_beat_slides",
    "model_beat_stability",
]
