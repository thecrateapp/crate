"""Optional voice presence per phrase for Smart Mix profiles (SM3-D2).

A cheap spectral heuristic, not a source separator. A sung or spoken voice puts most of
a frame's power in the telephone band (300 to 3,400 Hz) and, being harmonic, keeps that
band peaky: its spectral flatness is low. Kicks and bass fall below the band, hi-hats and
noise spread across it flat. Each STFT frame scores the product of two ramps, the band's
share of the frame's power and how tonal the band is; a phrase scores the mean of its
audible frames, as one byte (0 to 255).

Harmonic leads and pads inside the band look like voice to it. That is why the detector
stays off: the analyzer does not call it, and profiles keep ``vocal_presence`` null,
until it reaches ``MIN_PRECISION`` and ``MIN_RECALL`` on the hand-labelled phrases of
``tools/smart-mix-eval/vocals_labels.csv`` (design §10, gate SG1).
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from crate.smart_mix.models import Phrase

VOCAL_DETECTOR_VERSION = 1
VOICE_BAND_HZ = (300.0, 3_400.0)
FFT_SIZE = 2_048
HOP_LENGTH = 1_024
BEATS_PER_BAR = 4
# Frames quieter than this carry no voice and are left out of the phrase mean.
SILENCE_DB = -50.0
# Share of the frame's power inside the voice band: none below the floor, full above.
BAND_SHARE_FLOOR = 0.40
BAND_SHARE_FULL = 0.80
# Spectral flatness of the voice band: tonal (full) below, noise (none) above.
TONAL_FLATNESS = 0.10
NOISY_FLATNESS = 0.45
# A phrase with a byte at or above this counts as having voice.
VOCAL_THRESHOLD = 128
# Design §10: the detector is switched on only above both, on 100 labelled phrases.
MIN_PRECISION = 0.8
MIN_RECALL = 0.7
_EPSILON = 1e-12


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


def phrase_vocal_presence(
    audio: np.ndarray, sample_rate: int, spans_ms: Sequence[tuple[int, int]]
) -> bytes:
    """One byte per span: 0 for no voice up to 255 for voice in every audible frame."""
    if not spans_ms:
        return b""
    samples = np.asarray(audio, dtype=np.float64)
    scores = _frame_scores(samples, sample_rate)
    return bytes(
        _span_byte(scores, sample_rate, start_ms, end_ms)
        for start_ms, end_ms in spans_ms
    )


def _beat_ms(beat_grid_ms: Sequence[int], phrase: Phrase, bars: int) -> int:
    if not beat_grid_ms:
        return phrase.start_ms
    beat = phrase.start_beat + bars * BEATS_PER_BAR
    if beat < len(beat_grid_ms):
        return int(beat_grid_ms[beat])
    beat_length = (
        float(np.median(np.diff(beat_grid_ms))) if len(beat_grid_ms) > 1 else 0
    )
    last = len(beat_grid_ms) - 1
    return int(round(beat_grid_ms[last] + (beat - last) * beat_length))


def _frame_scores(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Voice score of each STFT frame (NaN for silent frames); frame i starts at i * hop."""
    if audio.size < FFT_SIZE or sample_rate <= 0:
        return np.empty(0)
    frames = np.lib.stride_tricks.sliding_window_view(audio, FFT_SIZE)[::HOP_LENGTH]
    loudness_db = 10.0 * np.log10(np.mean(frames**2, axis=1) + _EPSILON)
    power = np.abs(np.fft.rfft(frames * np.hanning(FFT_SIZE), axis=1)) ** 2
    frequencies = np.fft.rfftfreq(FFT_SIZE, 1.0 / sample_rate)
    in_band = (frequencies >= VOICE_BAND_HZ[0]) & (frequencies <= VOICE_BAND_HZ[1])
    band = power[:, in_band] + _EPSILON
    share = band.sum(axis=1) / (power.sum(axis=1) + _EPSILON)
    flatness = np.exp(np.mean(np.log(band), axis=1)) / np.mean(band, axis=1)
    scores = _ramp(share, BAND_SHARE_FLOOR, BAND_SHARE_FULL) * _ramp(
        flatness, NOISY_FLATNESS, TONAL_FLATNESS
    )
    return np.where(loudness_db >= SILENCE_DB, scores, np.nan)


def _span_byte(scores: np.ndarray, sample_rate: int, start_ms: int, end_ms: int) -> int:
    first = int(np.ceil(start_ms * sample_rate / 1_000 / HOP_LENGTH))
    last = int((end_ms * sample_rate / 1_000 - FFT_SIZE) // HOP_LENGTH)
    audible = scores[max(first, 0) : max(last + 1, 0)]
    audible = audible[~np.isnan(audible)]
    if audible.size == 0:
        return 0
    return int(round(255 * float(np.mean(audible))))


def _ramp(values: np.ndarray, none: float, full: float) -> np.ndarray:
    """0 at ``none``, 1 at ``full``, linear in between (either direction)."""
    return np.clip((values - none) / (full - none), 0.0, 1.0)


__all__ = [
    "MIN_PRECISION",
    "MIN_RECALL",
    "VOCAL_DETECTOR_VERSION",
    "VOCAL_THRESHOLD",
    "phrase_spans_ms",
    "phrase_vocal_presence",
]
