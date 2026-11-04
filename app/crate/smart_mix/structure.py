"""Phrase segmentation and per-bar energy for Smart Mix profiles (SM3-D2).

The segmentation reuses frames the analyzer already computed: the 50 ms RMS frames of
cue detection give each bar its energy, and low/mid/high band levels of the beat
tracker's mel spectrogram give its spectral balance. Bars run from downbeat to
downbeat; phrases cover the active bars, from the first to the last bar above -50 dBFS.
A section change shows as novelty at a bar boundary: the change of mean energy and
spectral balance between the four bars before and the four bars after it.

Phrases are 8, 16 or 32 bars on an 8-bar grid. The grid starts on one of the first
eight active bars, the one whose boundaries collect the most novelty (the first active
bar unless another clearly wins). A dynamic programme then keeps the grid boundaries whose
novelty pays for a fixed cost, so steady stretches merge into 16- and 32-bar phrases;
boundaries on 16- and 32-bar multiples get a small bonus.

Kinds follow rules over phrase energy and position. A peak is within 1.5 dB of the
loudest phrase and 1.5 dB above the track's typical (median bar) level, so a steady
groove has none. The main part runs from the first to the last peak or, without peaks,
between the first and last phrases near the typical level. Quieter phrases before it
are intro, after it outro, and inside it break when 3 dB under the peaks (or under the
typical level). A rising phrase just before a peak is a build; the rest is body.

``structure_confidence`` multiplies how much of the novelty peaks falls on the chosen
boundaries, whether at least three section changes support the grid, and how regular
the bars are. Tracks without a downbeat, or shorter than 16 bars, get no phrases.

The Rust analyzer (``tools/crate-cli/src/structure.rs``) implements the same algorithm
with the same constants.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from crate.smart_mix.cue_detection import rms_frame_geometry
from crate.smart_mix.models import (
    MAX_ENERGY_CURVE_BARS,
    MAX_PHRASES,
    Phrase,
    StructureDraft,
)


BEATS_PER_BAR = 4
UNIT_BARS = 8
# Phrase lengths in 8-bar units (32, 16 and 8 bars), longest first: ties keep it.
PHRASE_UNITS = (4, 2, 1)
MIN_STRUCTURE_BARS = 2 * UNIT_BARS
BAND_COUNT = 3
MID_BAND_HZ = 2_000.0
# Energy scale of the profile: RMS dBFS mapped linearly from -60 (0) to 0 (1).
ENERGY_FLOOR_DB = -60.0
# Bars this quiet are silence: phrases start and end on the bars inside them.
SILENCE_DB = -50.0
# Bar energy skips this much at each end of the bar, so a grid a few tens of ms off
# (the Python and Rust grids can differ that much) neither pulls in the next section
# nor drops the downbeat in one analyzer only.
BAR_EDGE_GUARD_MS = 50
NOVELTY_WINDOW_BARS = 4
NOVELTY_NOISE_DB = 0.5
SPECTRAL_WEIGHT = 0.5
OFFSET_ZERO_BONUS_DB = 1.0
BOUNDARY_COST_DB = 1.0
HYPERBAR_16_BONUS_DB = 0.25
HYPERBAR_32_BONUS_DB = 0.5
CAP_SEARCH_STEPS = 20
PEAK_MIN_DB = 1.0
SUPPORT_PEAKS = 3.0
BAR_JITTER_LIMIT = 0.08
CONTRAST_DB = 2.0
PEAK_WITHIN_DB = 1.5
PEAK_ABOVE_TYPICAL_DB = 1.5
MAIN_WITHIN_TYPICAL_DB = 1.5
BREAK_BELOW_DB = 3.0
BUILD_RISE_DB = 1.5
_EPSILON = 1e-9

NO_STRUCTURE = StructureDraft(phrases=(), energy_curve=None, structure_confidence=0.0)


@dataclass(frozen=True, slots=True)
class EnergyFrames:
    """Frames the analyzer computed for other features, reused by the segmentation.

    ``rms`` holds the cue-detection RMS frames (``cue_detection.frame_rms``).
    ``bands_db`` holds, per beat-tracker STFT frame, the mean level (dB) of the mel
    bands below 200 Hz, below 2 kHz and above; frame ``i`` is centred on sample
    ``i * band_hop``.
    """

    rms: np.ndarray
    bands_db: np.ndarray
    band_hop: int


@dataclass(frozen=True, slots=True)
class _Bar:
    start_beat: int
    start_ms: int
    end_ms: int


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


def segment_phrases(
    beat_grid_ms: Sequence[int],
    downbeats_ms: Sequence[int],
    energy_frames: EnergyFrames,
    sample_rate: int,
) -> StructureDraft:
    bars = _bars(beat_grid_ms, downbeats_ms)
    if not bars or sample_rate <= 0:
        return NO_STRUCTURE
    levels, shapes = _bar_features(bars, energy_frames, sample_rate)
    curve = bytes(_energy_byte(level) for level in levels)
    active = [index for index, level in enumerate(levels) if level >= SILENCE_DB]
    if not active or active[-1] + 1 - active[0] < MIN_STRUCTURE_BARS:
        return StructureDraft(phrases=(), energy_curve=curve, structure_confidence=0.0)
    first, last = active[0], active[-1] + 1
    novelty = _novelty(levels[first:last], shapes[first:last])
    offset = _grid_offset(novelty)
    units = (last - first - offset) // UNIT_BARS
    lengths = _capped_partition(novelty, offset, units)
    starts = [offset]
    for length in lengths:
        starts.append(starts[-1] + length * UNIT_BARS)
    phrases = _phrases(bars, levels, [first + start for start in starts])
    confidence = _confidence(novelty, starts, bars[first:last])
    return StructureDraft(
        phrases=phrases, energy_curve=curve, structure_confidence=confidence
    )


def _bars(beat_grid_ms: Sequence[int], downbeats_ms: Sequence[int]) -> list[_Bar]:
    index = {position: beat for beat, position in enumerate(beat_grid_ms)}
    starts = [
        (index[position], position) for position in downbeats_ms if position in index
    ]
    if len(starts) < 2:
        return []
    durations = [
        following[1] - current[1] for current, following in zip(starts, starts[1:])
    ]
    last_end = starts[-1][1] + int(_median(durations))
    ends = [position for _, position in starts[1:]] + [last_end]
    return [
        _Bar(start_beat=beat, start_ms=position, end_ms=end)
        for (beat, position), end in zip(starts, ends)
    ][:MAX_ENERGY_CURVE_BARS]


def _bar_features(
    bars: list[_Bar], frames: EnergyFrames, sample_rate: int
) -> tuple[list[float], list[tuple[float, ...]]]:
    """Each bar's energy (dBFS) and spectral balance (band levels minus their mean).

    A bar's energy is the mean power of the RMS frames that lie wholly inside it; its
    balance comes from the band frames centred inside it. Both leave out the first and
    last ``BAR_EDGE_GUARD_MS`` of the bar.
    """
    frame_length, hop = rms_frame_geometry(sample_rate)
    power = np.square(np.asarray(frames.rms, dtype=np.float64))
    power_sums = np.concatenate(([0.0], np.cumsum(power)))
    bands = np.asarray(frames.bands_db, dtype=np.float64).reshape(-1, BAND_COUNT)
    band_sums = np.vstack((np.zeros(BAND_COUNT), np.cumsum(bands, axis=0)))
    band_hop = max(1, int(frames.band_hop))
    levels: list[float] = []
    shapes: list[tuple[float, ...]] = []
    for bar in bars:
        start = (bar.start_ms + BAR_EDGE_GUARD_MS) * sample_rate // 1_000
        end = (bar.end_ms - BAR_EDGE_GUARD_MS) * sample_rate // 1_000
        first = min(power.size, _ceil_div(start, hop))
        last = (
            min(power.size, (end - frame_length) // hop + 1)
            if end >= frame_length
            else 0
        )
        mean_power = (
            float(power_sums[last] - power_sums[first]) / (last - first)
            if last > first
            else 0.0
        )
        levels.append(_power_db(mean_power))
        band_first = min(bands.shape[0], _ceil_div(start, band_hop))
        band_last = min(bands.shape[0], _ceil_div(end, band_hop))
        if band_last > band_first:
            means = [
                float(band_sums[band_last, band] - band_sums[band_first, band])
                / (band_last - band_first)
                for band in range(BAND_COUNT)
            ]
            centre = sum(means) / BAND_COUNT
            shapes.append(tuple(mean - centre for mean in means))
        else:
            shapes.append((0.0,) * BAND_COUNT)
    return levels, shapes


def _novelty(levels: list[float], shapes: list[tuple[float, ...]]) -> list[float]:
    """Novelty at each bar boundary 0..len(levels); the two ends stay 0."""
    count = len(levels)
    novelty = [0.0] * (count + 1)
    for boundary in range(1, count):
        low = max(0, boundary - NOVELTY_WINDOW_BARS)
        high = min(count, boundary + NOVELTY_WINDOW_BARS)
        before = _mean(levels[low:boundary])
        after = _mean(levels[boundary:high])
        spectral = sum(
            abs(
                _mean([shape[band] for shape in shapes[boundary:high]])
                - _mean([shape[band] for shape in shapes[low:boundary]])
            )
            for band in range(BAND_COUNT)
        )
        novelty[boundary] = max(
            0.0, abs(after - before) + SPECTRAL_WEIGHT * spectral - NOVELTY_NOISE_DB
        )
    return novelty


def _grid_offset(novelty: list[float]) -> int:
    """The first of the opening eight downbeats on which the 8-bar grid starts."""
    count = len(novelty) - 1
    best_offset, best_score = 0, -math.inf
    for offset in range(UNIT_BARS):
        if (count - offset) // UNIT_BARS < 1:
            break
        score = sum(
            novelty[boundary]
            for boundary in range(offset, count, UNIT_BARS)
            if boundary >= 1
        )
        if offset == 0:
            score += OFFSET_ZERO_BONUS_DB
        if score > best_score + _EPSILON:
            best_offset, best_score = offset, score
    return best_offset


def _capped_partition(novelty: list[float], offset: int, units: int) -> list[int]:
    """Phrase lengths in units; raises the boundary cost while over ``MAX_PHRASES``."""
    lengths = _partition(novelty, offset, units, BOUNDARY_COST_DB)
    if len(lengths) <= MAX_PHRASES:
        return lengths
    low, high = BOUNDARY_COST_DB, 2.0 * BOUNDARY_COST_DB
    while len(_partition(novelty, offset, units, high)) > MAX_PHRASES:
        low, high = high, 2.0 * high
    for _ in range(CAP_SEARCH_STEPS):
        middle = 0.5 * (low + high)
        if len(_partition(novelty, offset, units, middle)) > MAX_PHRASES:
            low = middle
        else:
            high = middle
    return _partition(novelty, offset, units, high)


def _partition(novelty: list[float], offset: int, units: int, cost: float) -> list[int]:
    gains = [0.0] * units
    for unit in range(1, units):
        bonus = (
            HYPERBAR_32_BONUS_DB
            if unit % 4 == 0
            else HYPERBAR_16_BONUS_DB
            if unit % 2 == 0
            else 0.0
        )
        gains[unit] = novelty[offset + unit * UNIT_BARS] + bonus - cost
    best = [0.0] + [-math.inf] * units
    choice = [0] * (units + 1)
    for end in range(1, units + 1):
        for length in PHRASE_UNITS:
            start = end - length
            if start < 0:
                continue
            candidate = best[start] + (gains[start] if start > 0 else 0.0)
            if candidate > best[end] + _EPSILON:
                best[end], choice[end] = candidate, length
    lengths: list[int] = []
    end = units
    while end > 0:
        lengths.append(choice[end])
        end -= choice[end]
    return lengths[::-1]


def _phrases(
    bars: list[_Bar], levels: list[float], starts: list[int]
) -> tuple[Phrase, ...]:
    spans = list(zip(starts, starts[1:]))
    phrase_levels = [_mean(levels[start:end]) for start, end in spans]
    rises = [
        _mean(levels[(start + end) // 2 : end])
        - _mean(levels[start : (start + end) // 2])
        for start, end in spans
    ]
    typical = _median(levels[starts[0] : starts[-1]])
    kinds = _kinds(phrase_levels, rises, spans, typical)
    phrases: list[Phrase] = []
    previous: float | None = None
    for (start, end), level, kind in zip(spans, phrase_levels, kinds):
        energy = round(_energy(level), 4)
        phrases.append(
            Phrase(
                start_beat=bars[start].start_beat,
                start_ms=bars[start].start_ms,
                bars=end - start,
                energy=energy,
                delta_energy=None if previous is None else round(energy - previous, 4),
                kind=kind,
            )
        )
        previous = energy
    return tuple(phrases)


def _kinds(
    levels: list[float],
    rises: list[float],
    spans: list[tuple[int, int]],
    typical: float,
) -> list[str]:
    count = len(levels)
    top = max(levels)
    if count < 2 or top - min(levels) < CONTRAST_DB:
        return ["body"] * count
    peak = [
        level >= top - PEAK_WITHIN_DB and level >= typical + PEAK_ABOVE_TYPICAL_DB
        for level in levels
    ]
    if any(peak):
        main, reference = peak, top
    else:
        main = [level >= typical - MAIN_WITHIN_TYPICAL_DB for level in levels]
        reference = typical
    first_main = main.index(True)
    last_main = count - 1 - main[::-1].index(True)
    middle = 0.5 * (spans[0][0] + spans[-1][1])
    kinds = []
    for index, (start, end) in enumerate(spans):
        if peak[index]:
            kind = "peak"
        elif index + 1 < count and peak[index + 1] and rises[index] >= BUILD_RISE_DB:
            kind = "build"
        elif index < first_main and start < middle:
            kind = "intro"
        elif index > last_main and end > middle:
            kind = "outro"
        elif (
            first_main < index < last_main
            and levels[index] <= reference - BREAK_BELOW_DB
        ):
            kind = "break"
        else:
            kind = "body"
        kinds.append(kind)
    return kinds


def _confidence(novelty: list[float], boundaries: list[int], bars: list[_Bar]) -> float:
    count = len(novelty) - 1
    peaks = [
        boundary
        for boundary in range(1, count)
        if novelty[boundary] >= PEAK_MIN_DB
        and novelty[boundary] > novelty[boundary - 1]
        and novelty[boundary] >= novelty[boundary + 1]
    ]
    if not peaks:
        return 0.0
    total = aligned = support = 0.0
    for peak in peaks:
        distance = min(abs(peak - boundary) for boundary in boundaries)
        weight = 1.0 if distance == 0 else 0.5 if distance == 1 else 0.0
        total += novelty[peak]
        aligned += weight * novelty[peak]
        support += weight
    durations = [float(bar.end_ms - bar.start_ms) for bar in bars[:-1]]
    if not durations:
        return 0.0
    typical = _median(durations)
    jitter = _median([abs(duration - typical) for duration in durations]) / typical
    regularity = min(1.0, max(0.0, 1.0 - jitter / BAR_JITTER_LIMIT))
    return round((aligned / total) * min(1.0, support / SUPPORT_PEAKS) * regularity, 4)


def _energy(level_db: float) -> float:
    return min(1.0, max(0.0, (level_db - ENERGY_FLOOR_DB) / -ENERGY_FLOOR_DB))


def _energy_byte(level_db: float) -> int:
    return int(255.0 * _energy(level_db) + 0.5)


def _power_db(mean_power: float) -> float:
    if mean_power <= 0.0:
        return ENERGY_FLOOR_DB
    return min(0.0, max(ENERGY_FLOOR_DB, 10.0 * math.log10(mean_power)))


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values)


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[middle])
    return 0.5 * (ordered[middle - 1] + ordered[middle])


def _ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


__all__ = [
    "EnergyFrames",
    "NO_STRUCTURE",
    "downbeats_from_anchor",
    "segment_phrases",
]
