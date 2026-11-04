"""Voice presence per phrase for Smart Mix profiles (SM3-D13).

YAMNet (``crate.smart_mix.voice_model``) scores each 0.975 s patch of the track for the
AudioSet voice classes. A phrase's byte is the share of the patches centred inside it
that reach ``WINDOW_THRESHOLD``, from 0 (none) to 255 (all), and the phrase counts as
voiced from ``VOCAL_THRESHOLD``. The spectral heuristic this replaced (detector version
1) found no voice on clearly sung tracks at gate SG1 and was dropped.

The profile task adds the voice after the analysis, Rust or Python, so both analyzers
stay identical. Without the model (no torch or no weights) or when it fails, the profile
is stored without voice.

Both thresholds are provisional until gate SG1b calibrates them on the reviewed labels
(``tools/smart-mix-eval/vocals_labels.csv``) with
``tools/smart-mix-eval/vocals/compare_models.py``. YAMNet gives the voice classes low
probabilities over dense music, so the window threshold is small.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path
from typing import Protocol

import numpy as np

from crate.smart_mix.models import TrackMixProfileDraft
from crate.smart_mix.phrase_grid import phrase_spans_ms
from crate.smart_mix.voice_model import SAMPLE_RATE, VoiceWindows, load_voice_model

log = logging.getLogger(__name__)

VOCAL_DETECTOR = "yamnet-1"
# Scores CSV version: 1 was the spectral heuristic, 2 is YAMNet.
VOCAL_DETECTOR_VERSION = 2
# Provisional until SG1b: voice-class score that makes a patch voiced.
WINDOW_THRESHOLD = 0.003
# Provisional until SG1b: a phrase is voiced when a quarter of its patches are.
VOCAL_THRESHOLD = 64
# Design §10.
MIN_PRECISION = 0.8
MIN_RECALL = 0.7


class VoiceModel(Protocol):
    def voice_windows(self, waveform: np.ndarray) -> VoiceWindows: ...


def phrase_vocal_presence(
    windows: VoiceWindows, spans_ms: Sequence[tuple[int, int]]
) -> bytes:
    """One byte per span: the share of its patches that reach WINDOW_THRESHOLD."""
    centres = np.asarray(windows.centres_ms)
    voiced = np.asarray(windows.scores) >= WINDOW_THRESHOLD
    presence = bytearray()
    for start_ms, end_ms in spans_ms:
        inside = (centres >= start_ms) & (centres < end_ms)
        count = int(inside.sum())
        presence.append(round(255 * int(voiced[inside].sum()) / count) if count else 0)
    return bytes(presence)


def load_audio(path: str | Path) -> np.ndarray:
    """Mono audio at YAMNet's 16 kHz, with Essentia when present, else librosa."""
    try:
        from essentia.standard import MonoLoader
    except ImportError:
        import librosa

        audio, _rate = librosa.load(str(path), sr=SAMPLE_RATE, mono=True)
        return np.asarray(audio, dtype=np.float32)
    loader = MonoLoader(filename=str(path), sampleRate=SAMPLE_RATE, resampleQuality=4)
    return np.asarray(loader(), dtype=np.float32)


def add_vocal_presence(
    draft: TrackMixProfileDraft,
    path: str | Path,
    *,
    model: VoiceModel | None = None,
) -> TrackMixProfileDraft:
    """The draft with one voice byte per phrase, or unchanged when there is no voice."""
    if not draft.phrases:
        return draft
    voice_model = model if model is not None else load_voice_model()
    if voice_model is None:
        return draft
    try:
        windows = voice_model.voice_windows(load_audio(path))
        presence = phrase_vocal_presence(
            windows, phrase_spans_ms(draft.phrases, draft.beat_grid_ms)
        )
    except Exception:
        log.warning(
            "Smart Mix voice failed for %s; storing no voice", path, exc_info=True
        )
        return draft
    return replace(draft, vocal_presence=presence, vocal_detector=VOCAL_DETECTOR)


__all__ = [
    "MIN_PRECISION",
    "MIN_RECALL",
    "VOCAL_DETECTOR",
    "VOCAL_DETECTOR_VERSION",
    "VOCAL_THRESHOLD",
    "WINDOW_THRESHOLD",
    "add_vocal_presence",
    "load_audio",
    "load_voice_model",
    "phrase_spans_ms",
    "phrase_vocal_presence",
]
