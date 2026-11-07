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

The patch scores are kept per track (SM3-D16), one byte each on the same log scale, and
reused while the file and the detector stay the same. A phrase byte is the mean of its
window bytes whether YAMNet ran or not, so a profile built from stored windows is the
one the model would give; it is within one of the byte from the float scores.

Gate SG1b (2026-11-05) calibrated the cut against synced lyrics on 2,721 phrases of 275
production tracks in 20 genres (``docs/technical/smart-mix-operations.md``). YAMNet gives
the voice classes low probabilities over dense music, so the scale reaches down to 10^-4.
"""

from __future__ import annotations

import importlib
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from crate.smart_mix.models import (
    VOCAL_LOG_FLOOR as LOG_FLOOR,
    VOCAL_THRESHOLD,
    TrackMixProfileDraft,
)
from crate.smart_mix.phrase_grid import phrase_spans_ms
from crate.smart_mix.voice_model import (
    PATCH_CENTRE_MS,
    PATCH_HOP_MS,
    SAMPLE_RATE,
    VoiceWindows,
    load_voice_model,
)

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


@dataclass(frozen=True, slots=True)
class VoiceWindowBytes:
    """The voice score of each patch as stored per track (SM3-D16).

    One byte per patch on the log scale of the phrase bytes; patch ``i`` is centred at
    ``i * hop_ms`` plus the detector's centre offset.
    """

    detector: str
    hop_ms: int
    scores: bytes


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


def voice_window_bytes(windows: VoiceWindows) -> VoiceWindowBytes:
    """YAMNet's patch scores as stored: one byte each on the phrase log scale."""
    levels = np.rint(255 * _log_levels(windows.scores)).astype(np.uint8)
    return VoiceWindowBytes(
        detector=VOCAL_DETECTOR, hop_ms=PATCH_HOP_MS, scores=levels.tobytes()
    )


def phrase_vocal_presence_from_windows(
    windows: VoiceWindowBytes, spans_ms: Sequence[tuple[int, int]]
) -> bytes:
    """One byte per span: the mean of its stored window bytes, 0 without windows.

    Each window byte was rounded on its own, so a span's byte is within one of the
    byte ``phrase_vocal_presence`` gives from the float scores.
    """
    levels = np.frombuffer(windows.scores, dtype=np.uint8).astype(np.float64)
    centres = np.arange(levels.size, dtype=np.int64) * windows.hop_ms + PATCH_CENTRE_MS
    presence = bytearray()
    for start_ms, end_ms in spans_ms:
        inside = levels[(centres >= start_ms) & (centres < end_ms)]
        presence.append(round(float(inside.mean())) if inside.size else 0)
    return bytes(presence)


def _log_levels(scores) -> np.ndarray:
    """Scores from ``LOG_FLOOR`` or less (0) to 1 (1) on a log scale."""
    logs = np.log10(np.maximum(np.asarray(scores, dtype=np.float64), LOG_FLOOR))
    floor = np.log10(LOG_FLOOR)
    return np.clip((logs - floor) / -floor, 0.0, 1.0)


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
    stored: VoiceWindowBytes | None = None,
    keep: Callable[[VoiceWindowBytes], None] | None = None,
) -> TrackMixProfileDraft:
    """The draft with one voice byte per phrase, or unchanged when there is no voice.

    ``stored`` are the windows kept for this file (SM3-D16): when they come from the
    current detector, YAMNet does not run. Otherwise it runs and ``keep`` receives its
    windows; a failure to keep them leaves the voice in the profile. A track without
    phrases needs no voice, so YAMNet never runs for it.
    """
    if not draft.phrases:
        return draft
    windows = (
        stored if stored is not None and stored.detector == VOCAL_DETECTOR else None
    )
    if windows is None:
        windows = _model_windows(path, model)
        if windows is None:
            return draft
        if keep is not None:
            try:
                keep(windows)
            except Exception:
                log.warning(
                    "Smart Mix could not store the voice windows of %s; the profile "
                    "keeps its voice",
                    path,
                    exc_info=True,
                )
    try:
        presence = phrase_vocal_presence_from_windows(
            windows, phrase_spans_ms(draft.phrases, draft.beat_grid_ms)
        )
    except Exception:
        log.warning(
            "Smart Mix voice failed for %s; storing no voice", path, exc_info=True
        )
        return draft
    return replace(draft, vocal_presence=presence, vocal_detector=VOCAL_DETECTOR)


def _model_windows(
    path: str | Path, model: VoiceModel | None
) -> VoiceWindowBytes | None:
    voice_model = model if model is not None else load_voice_model()
    if voice_model is None:
        return None
    try:
        return voice_window_bytes(voice_model.voice_windows(load_audio(path)))
    except Exception:
        log.warning(
            "Smart Mix voice failed for %s; storing no voice", path, exc_info=True
        )
        return None


__all__ = [
    "MIN_PRECISION",
    "MIN_RECALL",
    "VOCAL_DETECTOR",
    "VOCAL_DETECTOR_VERSION",
    "VOCAL_THRESHOLD",
    "LOG_FLOOR",
    "VoiceWindowBytes",
    "add_vocal_presence",
    "load_audio",
    "load_voice_model",
    "phrase_spans_ms",
    "phrase_vocal_presence",
    "phrase_vocal_presence_from_windows",
    "voice_window_bytes",
]
