"""Voice presence per phrase for Smart Mix profiles (SM3-D13).

YAMNet (``crate.smart_mix.voice_model``) scores each 0.975 s patch of the track for the
AudioSet voice classes. A phrase's byte is the geometric mean of the scores of the
patches centred inside it on a log scale, from ``LOG_FLOOR`` or less (0) to 1 (255), and
the phrase counts as voiced from ``VOCAL_THRESHOLD``. The byte stores no threshold, so the
voiced cut can move without analysing the library again. The spectral heuristic this
replaced (detector version 1) found no voice on clearly sung tracks at gate SG1 and was
dropped; ``yamnet-1`` stored the share of patches above a fixed score.

The profile task adds the voice after the analysis, Rust or Python, so both analyzers
stay identical. Without the model (no torch or no weights) or when it fails, the profile
is stored without voice.

Gate SG1b (2026-11-05) calibrated the cut against synced lyrics on 2,721 phrases of 275
production tracks in 20 genres (``docs/technical/smart-mix-operations.md``). YAMNet gives
the voice classes low probabilities over dense music, so the scale reaches down to 10^-4.
"""

from __future__ import annotations

import importlib
import logging
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from crate.smart_mix.models import (
    VOCAL_LOG_FLOOR as LOG_FLOOR,
    VOCAL_THRESHOLD,
    TrackMixProfileDraft,
)
from crate.smart_mix.phrase_grid import phrase_spans_ms
from crate.smart_mix.voice_model import SAMPLE_RATE, VoiceWindows, load_voice_model

log = logging.getLogger(__name__)

VOCAL_DETECTOR = "yamnet-2"
# Scores CSV version: 1 was the spectral heuristic, 2 YAMNet's share of voiced patches,
# 3 YAMNet's geometric mean.
VOCAL_DETECTOR_VERSION = 3
# Design §10.
MIN_PRECISION = 0.8
MIN_RECALL = 0.7


class VoiceModel(Protocol):
    def voice_windows(self, waveform: np.ndarray) -> VoiceWindows: ...


def phrase_vocal_presence(
    windows: VoiceWindows, spans_ms: Sequence[tuple[int, int]]
) -> bytes:
    """One byte per span: the geometric mean of its patch scores on the log scale.

    A span without patches scores 0.
    """
    centres = np.asarray(windows.centres_ms)
    logs = np.log10(np.maximum(np.asarray(windows.scores, dtype=np.float64), LOG_FLOOR))
    floor = np.log10(LOG_FLOOR)
    presence = bytearray()
    for start_ms, end_ms in spans_ms:
        inside = logs[(centres >= start_ms) & (centres < end_ms)]
        if not inside.size:
            presence.append(0)
            continue
        level = (float(inside.mean()) - floor) / -floor
        presence.append(round(255 * min(1.0, max(0.0, level))))
    return bytes(presence)


def load_audio(path: str | Path) -> np.ndarray:
    """Mono audio at YAMNet's 16 kHz, with Essentia when present, else librosa."""
    try:
        # essentia.standard builds its algorithms at import time, so a type checker
        # cannot see them; read them through Any, as audio_analysis does.
        standard: Any = importlib.import_module("essentia.standard")
    except ImportError:
        import librosa

        audio, _rate = librosa.load(str(path), sr=SAMPLE_RATE, mono=True)
        return np.asarray(audio, dtype=np.float32)
    loader = standard.MonoLoader(
        filename=str(path), sampleRate=SAMPLE_RATE, resampleQuality=4
    )
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
    "LOG_FLOOR",
    "add_vocal_presence",
    "load_audio",
    "load_voice_model",
    "phrase_spans_ms",
    "phrase_vocal_presence",
]
