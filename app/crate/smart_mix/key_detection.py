"""Musical key from a semitone pitch-class profile, matched against the Krumhansl-Kessler
key profiles. Same method and constants as ``tools/crate-cli/src/key_detection.rs``.

A long FFT is mapped onto semitone bands from A1 upward. Each band is a triangular
kernel in log frequency that sums to one, so no pitch class collects more FFT bins than
another (the Rust analyzer v5 summed raw bins into pitch classes, and below ~180 Hz the
bins fell on the harmonic series of a flat F: most tracks came out as 7B, 7A or 8A).
Bands are log-compressed and measured against the median of their neighbours, so
broadband energy such as kicks, noise and cymbals cancels out, and the difference is kept
signed so that noise averages to zero in every band.
"""

from __future__ import annotations

import math

import numpy as np

from crate.smart_mix.camelot import to_camelot


FFT_SIZE = 8_192
HOP_SIZE = 4_096
LOWEST_NOTE = 33  # A1, 55 Hz; five octaves up to G#6
NOTE_COUNT = 60
BAND_WIDTH_SEMITONES = 1.0
COMPRESSION = 100.0
WHITENING_RADIUS = 6

_KEY_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def _band_kernels(sample_rate: int) -> np.ndarray:
    notes = np.arange(
        LOWEST_NOTE - WHITENING_RADIUS, LOWEST_NOTE + NOTE_COUNT + WHITENING_RADIUS
    )
    centres = 440.0 * 2.0 ** ((notes - 69) / 12.0)
    bins = np.arange(1, FFT_SIZE // 2 + 1) * sample_rate / FFT_SIZE
    distance = np.abs(12.0 * np.log2(bins[None, :] / centres[:, None]))
    weights = np.clip(1.0 - distance / BAND_WIDTH_SEMITONES, 0.0, None)
    totals = weights.sum(axis=1, keepdims=True)
    kernels = np.zeros((notes.size, FFT_SIZE // 2 + 1))
    kernels[:, 1:] = np.divide(
        weights, totals, out=np.zeros_like(weights), where=totals > 0
    )
    return kernels


def _band_spectrogram(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    samples = np.asarray(audio, dtype=np.float64)
    if samples.size == 0 or sample_rate <= 0:
        return np.zeros((0, NOTE_COUNT + 2 * WHITENING_RADIUS))
    frames = 1 + max(0, samples.size - FFT_SIZE) // HOP_SIZE
    padded = np.zeros((frames - 1) * HOP_SIZE + FFT_SIZE)
    padded[: samples.size] = samples[: padded.size]
    windows = np.lib.stride_tricks.sliding_window_view(padded, FFT_SIZE)[::HOP_SIZE]
    hann = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(FFT_SIZE) / FFT_SIZE)
    magnitudes = np.abs(np.fft.rfft(windows[:frames] * hann, axis=1))
    return magnitudes @ _band_kernels(sample_rate).T


def pitch_class_profile(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Harmonic weight of each pitch class (0 = C). Only the shape matters: values are
    relative and may be negative for classes below the noise floor."""
    profile = np.zeros(12)
    bands = _band_spectrogram(audio, sample_rate)
    peak = float(bands.max()) if bands.size else 0.0
    if peak <= 1e-12:
        return profile
    compressed = np.log1p(COMPRESSION * bands / peak)
    neighbours = np.lib.stride_tricks.sliding_window_view(
        compressed, 2 * WHITENING_RADIUS + 1, axis=1
    )
    rise = compressed[:, WHITENING_RADIUS : WHITENING_RADIUS + NOTE_COUNT] - np.median(
        neighbours, axis=2
    )
    for index, total in enumerate(rise.sum(axis=0)):
        profile[(LOWEST_NOTE + index) % 12] += total
    return profile


def _safe_correlation(left: np.ndarray, right: np.ndarray) -> float:
    if float(np.std(left)) <= 1e-12:
        return -1.0
    value = float(np.corrcoef(left, right)[0, 1])
    return value if math.isfinite(value) else -1.0


def detect_key(
    audio: np.ndarray, sample_rate: int
) -> tuple[str | None, str | None, str | None, float]:
    """``(key, scale, camelot, confidence)``; all ``None`` and 0.0 without harmony."""
    profile = pitch_class_profile(audio, sample_rate)
    if float(np.ptp(profile)) <= 1e-12:
        return None, None, None, 0.0
    candidates: list[tuple[float, str, str]] = []
    for index, key_name in enumerate(_KEY_NAMES):
        observed = np.roll(profile, -index)
        candidates.append(
            (_safe_correlation(observed, _MAJOR_PROFILE), key_name, "major")
        )
        candidates.append(
            (_safe_correlation(observed, _MINOR_PROFILE), key_name, "minor")
        )
    candidates.sort(reverse=True, key=lambda candidate: candidate[0])
    best_score, key, scale = candidates[0]
    second_score = candidates[1][0]
    confidence = max(
        0.0,
        min(1.0, (best_score + 1.0) * 0.35 + max(0.0, best_score - second_score)),
    )
    try:
        camelot = to_camelot(key, scale)
    except ValueError:
        camelot = None
    return key, scale, camelot, round(confidence, 4)


__all__ = ["detect_key", "pitch_class_profile"]
