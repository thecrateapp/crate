"""Phrase segmentation and per-bar energy for Smart Mix profiles (SM3-D2).

The segmentation reuses frames the analyzer already computed: the 50 ms RMS frames of
cue detection give each bar its energy, and low/mid/high band levels of the beat
tracker's mel spectrogram give its spectral balance. Bars run from downbeat to downbeat;
each bar's energy is the mean power of the frames inside it, leaving out 50 ms at each
end. Non-finite frames count as silence.

Coverage. A bar is music when one of its frames is within 35 dB of the loudest frame and
above -55 dBFS, the frames cue detection counts as active. Phrases cover the bars from
the first to the last such bar, so the first phrase starts no earlier than the bar that
holds ``activeStartMs`` and the last one ends no later than the bar that holds
``activeEndMs``. Runs of one or two silent bars inside the music are gaps (a stop before
a drop, a dropout): they are missing data for the novelty, the phrase levels and the
typical level, and a phrase boundary never lands on one. Longer silences are music.

A section change shows as novelty at a bar boundary: the change of mean bar level (dB)
and spectral balance between the four bars before and the four bars after it, gaps
left out. Boundaries closer than four bars to either end of the music get none: a
truncated window cannot tell a pickup or a fade-in from a section change. Its peaks are the local maxima of at least 1 dB, skipping gap bars; a run of
equal values is one peak, so a long fade or ramp makes one wide peak. Phrases are 8, 16
or 32 bars on an 8-bar grid. For a grid starting on each of the first eight music bars,
a dynamic programme keeps the grid boundaries whose novelty pays for a fixed cost, so
steady stretches merge into 16- and 32-bar phrases (boundaries on 16- and 32-bar
multiples get a small bonus). The grid with the highest confidence wins: the one whose
boundaries explain the most section changes. The first music bar keeps the grid unless
another start beats it by ``OFFSET_ZERO_PREFERENCE``.

Kinds follow rules over phrase level (mean power, in dB) and position. A peak is within
1.5 dB of the loudest phrase and 1.5 dB above the track's typical (median bar) level, so
a steady groove has none. The main part runs from the first to the last peak or, without
peaks, between the first and last phrases near the typical level. Quieter phrases before
it are intro, after it outro, and inside it break when 3 dB under the peaks (or under
the typical level). A rising phrase just before a peak is a build; the rest is body.

``structure_confidence`` multiplies how much of the novelty peaks (a plateau counts as
one peak) falls on the chosen boundaries, whether at least three section changes support
the grid, how regular the bars are, and 0.5 when the analyzer doubts its beat grid.
Tracks without a downbeat, or with fewer than 16 bars of music, get no phrases.
Comparisons against thresholds and between candidates allow ``EPSILON``.

The Rust analyzer (``tools/crate-cli/src/structure.rs``) implements the same algorithm
with the same constants and the same order of floating-point operations.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from crate.smart_mix.cue_detection import (
    ACTIVE_RANGE_DB,
    MIN_ACTIVE_DBFS,
    RMS_FRAMES_PER_SECOND,
    RMS_MIN_FRAME_SAMPLES,
    RMS_MIN_HOP_SAMPLES,
    rms_frame_geometry,
)
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
LOW_BAND_HZ = 200.0
MID_BAND_HZ = 2_000.0
# Energy scale of the profile: RMS dBFS mapped linearly from -60 (0) to 0 (1).
ENERGY_FLOOR_DB = -60.0
# Bar energy skips this much at each end of the bar, so a grid a few tens of ms off
# (the Python and Rust grids can differ that much) neither pulls in the next section
# nor drops the downbeat in one analyzer only.
BAR_EDGE_GUARD_MS = 50
MAX_GAP_BARS = 2
NOVELTY_WINDOW_BARS = 4
NOVELTY_NOISE_DB = 0.5
SPECTRAL_WEIGHT = 0.5
OFFSET_ZERO_PREFERENCE = 0.05
BOUNDARY_COST_DB = 1.0
HYPERBAR_16_BONUS_DB = 0.25
HYPERBAR_32_BONUS_DB = 0.5
CAP_SEARCH_STEPS = 20
PEAK_MIN_DB = 1.0
SUPPORT_PEAKS = 3.0
BAR_JITTER_LIMIT = 0.08
GRID_DOUBT_FACTOR = 0.5
CONTRAST_DB = 2.0
PEAK_WITHIN_DB = 1.5
PEAK_ABOVE_TYPICAL_DB = 1.5
MAIN_WITHIN_TYPICAL_DB = 1.5
BREAK_BELOW_DB = 3.0
BUILD_RISE_DB = 1.5
# Tolerance for ties and thresholds, well above the float noise between analyzers.
EPSILON = 1e-6

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


@dataclass(frozen=True, slots=True)
class _Peak:
    """A run of equal novelty from bar ``first`` to bar ``last`` (inclusive)."""

    first: int
    last: int
    value: float

    def distance(self, bar: int) -> int:
        if self.first <= bar <= self.last:
            return 0
        return min(abs(bar - self.first), abs(bar - self.last))


@dataclass(frozen=True, slots=True)
class _BarFeatures:
    levels: list[float]
    shapes: list[tuple[float, ...]]
    music: list[bool]


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
    *,
    grid_trusted: bool = True,
) -> StructureDraft:
    """Phrases, energy curve and confidence; ``grid_trusted=False`` halves confidence."""
    bars = _bars(beat_grid_ms, downbeats_ms)
    if not bars or sample_rate <= 0:
        return NO_STRUCTURE
    features = _bar_features(bars, energy_frames, sample_rate)
    curve = bytes(_energy_byte(level) for level in features.levels)
    music = [index for index, is_music in enumerate(features.music) if is_music]
    if not music or music[-1] + 1 - music[0] < MIN_STRUCTURE_BARS:
        return StructureDraft(phrases=(), energy_curve=curve, structure_confidence=0.0)
    first, last = music[0], music[-1] + 1
    levels = features.levels[first:last]
    gaps = _gaps(features.music[first:last])
    novelty = _novelty(levels, features.shapes[first:last], gaps)
    span = bars[first:last]
    starts, confidence = _best_grid(novelty, _peaks(novelty, gaps), span)
    if not grid_trusted:
        confidence *= GRID_DOUBT_FACTOR
    return StructureDraft(
        phrases=_phrases(span, levels, gaps, starts),
        energy_curve=curve,
        structure_confidence=_round4(confidence),
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
) -> _BarFeatures:
    """Each bar's energy (dBFS), spectral balance and whether it holds music.

    Energy is the mean power of the RMS frames that lie wholly inside the bar; the
    balance (band levels minus their mean) comes from the band frames centred inside
    it. Both leave out the first and last ``BAR_EDGE_GUARD_MS`` of the bar. Frames are
    read as 32-bit floats, as the Rust analyzer keeps them, and non-finite ones count
    as silence.
    """
    frame_length, hop = rms_frame_geometry(sample_rate)
    with np.errstate(over="ignore", invalid="ignore"):
        rms = np.asarray(frames.rms, dtype=np.float32)
        bands = np.asarray(frames.bands_db, dtype=np.float32).reshape(-1, BAND_COUNT)
    rms = np.where(np.isfinite(rms) & (rms > 0.0), rms, 0.0).astype(np.float64)
    bands = np.where(np.isfinite(bands), bands, 0.0).astype(np.float64)
    power = rms * rms
    power_sums = np.concatenate(([0.0], np.cumsum(power)))
    peak = float(power.max()) if power.size else 0.0
    if peak > 0.0:
        floor_db = max(MIN_ACTIVE_DBFS, 10.0 * math.log10(peak) - ACTIVE_RANGE_DB)
        music_frames = power >= 10.0 ** (floor_db / 10.0)
    else:
        music_frames = np.zeros(power.size, dtype=bool)
    music_counts = np.concatenate(([0], np.cumsum(music_frames)))
    band_sums = np.vstack((np.zeros(BAND_COUNT), np.cumsum(bands, axis=0)))
    band_hop = max(1, int(frames.band_hop))
    levels: list[float] = []
    shapes: list[tuple[float, ...]] = []
    music: list[bool] = []
    for bar in bars:
        start = (bar.start_ms + BAR_EDGE_GUARD_MS) * sample_rate // 1_000
        end = (bar.end_ms - BAR_EDGE_GUARD_MS) * sample_rate // 1_000
        first = min(power.size, _ceil_div(start, hop))
        last = (
            min(power.size, (end - frame_length) // hop + 1)
            if end >= frame_length
            else 0
        )
        if last > first:
            mean_power = float(power_sums[last] - power_sums[first]) / (last - first)
            music.append(int(music_counts[last] - music_counts[first]) > 0)
        else:
            mean_power = 0.0
            music.append(False)
        levels.append(_power_db(mean_power))
        band_first = min(bands.shape[0], _ceil_div(start, band_hop))
        band_last = min(bands.shape[0], _ceil_div(end, band_hop))
        if band_last > band_first:
            count = band_last - band_first
            means = [
                float(band_sums[band_last, band] - band_sums[band_first, band]) / count
                for band in range(BAND_COUNT)
            ]
            centre = _sum(means) / BAND_COUNT
            shapes.append(tuple(mean - centre for mean in means))
        else:
            shapes.append((0.0,) * BAND_COUNT)
    return _BarFeatures(levels=levels, shapes=shapes, music=music)


def _gaps(music: list[bool]) -> list[bool]:
    """Runs of at most ``MAX_GAP_BARS`` silent bars between music bars."""
    gaps = [False] * len(music)
    index = 0
    while index < len(music):
        if music[index]:
            index += 1
            continue
        end = index
        while end < len(music) and not music[end]:
            end += 1
        if end - index <= MAX_GAP_BARS:
            gaps[index:end] = [True] * (end - index)
        index = end
    return gaps


def _novelty(
    levels: list[float], shapes: list[tuple[float, ...]], gaps: list[bool]
) -> list[float]:
    """Novelty at each bar boundary 0..len(levels).

    Gap bars and boundaries without four bars of music range on each side stay 0.
    """
    count = len(levels)
    novelty = [0.0] * (count + 1)
    for boundary in range(NOVELTY_WINDOW_BARS, count - NOVELTY_WINDOW_BARS + 1):
        if gaps[boundary]:
            continue
        before = [
            bar
            for bar in range(max(0, boundary - NOVELTY_WINDOW_BARS), boundary)
            if not gaps[bar]
        ]
        after = [
            bar
            for bar in range(boundary, min(count, boundary + NOVELTY_WINDOW_BARS))
            if not gaps[bar]
        ]
        if not before or not after:
            continue
        change = abs(
            _mean([levels[bar] for bar in after])
            - _mean([levels[bar] for bar in before])
        )
        spectral = 0.0
        for band in range(BAND_COUNT):
            spectral += abs(
                _mean([shapes[bar][band] for bar in after])
                - _mean([shapes[bar][band] for bar in before])
            )
        novelty[boundary] = max(
            0.0, change + SPECTRAL_WEIGHT * spectral - NOVELTY_NOISE_DB
        )
    return novelty


def _peaks(novelty: list[float], gaps: list[bool]) -> list[_Peak]:
    """Local maxima of the novelty over the non-gap boundaries; a plateau is one."""
    count = len(novelty) - 1
    positions = [bar for bar in range(1, count) if not gaps[bar]]
    values = [novelty[bar] for bar in positions]
    peaks: list[_Peak] = []
    index = 0
    while index < len(values):
        end = index
        while end + 1 < len(values) and abs(values[end + 1] - values[index]) <= EPSILON:
            end += 1
        value = values[index]
        left = values[index - 1] if index > 0 else 0.0
        right = values[end + 1] if end + 1 < len(values) else 0.0
        if (
            value >= PEAK_MIN_DB - EPSILON
            and value > left + EPSILON
            and value > right + EPSILON
        ):
            peaks.append(_Peak(positions[index], positions[end], value))
        index = end + 1
    return peaks


def _best_grid(
    novelty: list[float], peaks: list[_Peak], bars: list[_Bar]
) -> tuple[list[int], float]:
    """Phrase starts (and the end) of the grid that best explains the section changes."""
    count = len(novelty) - 1
    best_starts: list[int] = []
    best_confidence = best_score = -math.inf
    for offset in range(UNIT_BARS):
        units = (count - offset) // UNIT_BARS
        if units < 1:
            break
        starts = [offset]
        for length in _capped_partition(novelty, offset, units):
            starts.append(starts[-1] + length * UNIT_BARS)
        confidence = _confidence(peaks, starts, bars)
        score = confidence + (OFFSET_ZERO_PREFERENCE if offset == 0 else 0.0)
        if score > best_score + EPSILON:
            best_starts, best_confidence, best_score = starts, confidence, score
    return best_starts, best_confidence


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
            if candidate > best[end] + EPSILON:
                best[end], choice[end] = candidate, length
    lengths: list[int] = []
    end = units
    while end > 0:
        lengths.append(choice[end])
        end -= choice[end]
    return lengths[::-1]


def _phrases(
    bars: list[_Bar], levels: list[float], gaps: list[bool], starts: list[int]
) -> tuple[Phrase, ...]:
    def level_of(first: int, last: int) -> float | None:
        members = [levels[bar] for bar in range(first, last) if not gaps[bar]]
        return _power_level(members) if members else None

    spans = list(zip(starts, starts[1:]))
    phrase_levels: list[float] = []
    rises: list[float] = []
    for start, end in spans:
        level = level_of(start, end)
        phrase_levels.append(ENERGY_FLOOR_DB if level is None else level)
        middle = (start + end) // 2
        early, late = level_of(start, middle), level_of(middle, end)
        rises.append(0.0 if early is None or late is None else late - early)
    typical = _median(
        [levels[bar] for bar in range(starts[0], starts[-1]) if not gaps[bar]]
    )
    kinds = _kinds(phrase_levels, rises, spans, typical)
    phrases: list[Phrase] = []
    previous: float | None = None
    for (start, end), level, kind in zip(spans, phrase_levels, kinds):
        energy = _round4(_energy(level))
        phrases.append(
            Phrase(
                start_beat=bars[start].start_beat,
                start_ms=bars[start].start_ms,
                bars=end - start,
                energy=energy,
                delta_energy=None if previous is None else _round4(energy - previous),
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
    if count < 2 or top - min(levels) < CONTRAST_DB - EPSILON:
        return ["body"] * count
    peak = [
        level >= top - PEAK_WITHIN_DB - EPSILON
        and level >= typical + PEAK_ABOVE_TYPICAL_DB - EPSILON
        for level in levels
    ]
    if any(peak):
        main, reference = peak, top
    else:
        main = [level >= typical - MAIN_WITHIN_TYPICAL_DB - EPSILON for level in levels]
        reference = typical
    if not any(main):
        return ["body"] * count
    first_main = main.index(True)
    last_main = count - 1 - main[::-1].index(True)
    middle = 0.5 * (spans[0][0] + spans[-1][1])
    kinds = []
    for index, (start, end) in enumerate(spans):
        if peak[index]:
            kind = "peak"
        elif (
            index + 1 < count
            and peak[index + 1]
            and rises[index] >= BUILD_RISE_DB - EPSILON
        ):
            kind = "build"
        elif index < first_main and start < middle:
            kind = "intro"
        elif index > last_main and end > middle:
            kind = "outro"
        elif (
            first_main < index < last_main
            and levels[index] <= reference - BREAK_BELOW_DB + EPSILON
        ):
            kind = "break"
        else:
            kind = "body"
        kinds.append(kind)
    return kinds


def _confidence(peaks: list[_Peak], boundaries: list[int], bars: list[_Bar]) -> float:
    if not peaks:
        return 0.0
    total = aligned = support = 0.0
    for peak in peaks:
        distance = min(peak.distance(boundary) for boundary in boundaries)
        weight = 1.0 if distance == 0 else 0.5 if distance == 1 else 0.0
        total += peak.value
        aligned += weight * peak.value
        support += weight
    durations = [float(bar.end_ms - bar.start_ms) for bar in bars[:-1]]
    if not durations:
        return 0.0
    typical = _median(durations)
    jitter = _median([abs(duration - typical) for duration in durations]) / typical
    regularity = min(1.0, max(0.0, 1.0 - jitter / BAR_JITTER_LIMIT))
    return (aligned / total) * min(1.0, support / SUPPORT_PEAKS) * regularity


def _energy(level_db: float) -> float:
    return min(1.0, max(0.0, (level_db - ENERGY_FLOOR_DB) / -ENERGY_FLOOR_DB))


def _energy_byte(level_db: float) -> int:
    return int(255.0 * _energy(level_db) + 0.5)


def _power_db(mean_power: float) -> float:
    if mean_power <= 0.0:
        return ENERGY_FLOOR_DB
    return min(0.0, max(ENERGY_FLOOR_DB, 10.0 * math.log10(mean_power)))


def _power_level(levels_db: Sequence[float]) -> float:
    """Level (dB) of the mean power of bars given in dB."""
    return _power_db(_mean([10.0 ** (level / 10.0) for level in levels_db]))


def _sum(values: Sequence[float]) -> float:
    # A plain left-to-right sum, the order the Rust analyzer adds in (the built-in
    # ``sum`` compensates rounding and would differ in the last bits).
    total = 0.0
    for value in values:
        total += value
    return total


def _mean(values: Sequence[float]) -> float:
    return _sum(values) / len(values)


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[middle])
    return 0.5 * (ordered[middle - 1] + ordered[middle])


def _round4(value: float) -> float:
    # Halves round away from zero, as Rust's f64::round does.
    scaled = value * 10_000.0
    return math.copysign(math.floor(abs(scaled) + 0.5), scaled) / 10_000.0


def _ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


__all__ = [
    "ACTIVE_RANGE_DB",
    "EnergyFrames",
    "MIN_ACTIVE_DBFS",
    "NO_STRUCTURE",
    "RMS_FRAMES_PER_SECOND",
    "RMS_MIN_FRAME_SAMPLES",
    "RMS_MIN_HOP_SAMPLES",
    "downbeats_from_anchor",
    "segment_phrases",
]
