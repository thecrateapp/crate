"""YAMNet in PyTorch for the per-phrase voice of Smart Mix profiles (SM3-D13).

A port of Google's YAMNet (tensorflow/models, research/audioset/yamnet, Apache-2.0): the
log-mel front end in NumPy and the MobileNet-v1 classifier in PyTorch, with Google's
original weights. ``scripts/convert_yamnet_weights.py`` turns ``yamnet.h5`` into the
``.npz`` this module loads, at image build. TensorFlow's periodic Hann window, its mel
filterbank and its asymmetric "same" padding are reproduced, so the scores match the
reference within float tolerance (``tests/test_smart_mix_voice_model.py``).

Only the analysis worker has torch and the weights. Elsewhere ``load_voice_model``
returns ``None`` and profiles keep no voice.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
STFT_WINDOW = 400  # 25 ms
STFT_HOP = 160  # 10 ms
FFT_LENGTH = 512
MEL_BANDS = 64
MEL_MIN_HZ = 125.0
MEL_MAX_HZ = 7_500.0
LOG_OFFSET = 0.001
PATCH_FRAMES = 96  # 0.96 s of spectrogram frames
PATCH_HOP_FRAMES = 48  # 0.48 s
# yamnet.py pads so that every patch is whole: 0.96 s of frames plus one STFT window.
MIN_SAMPLES = 15_600
PATCH_HOP_SAMPLES = 7_680
PATCH_HOP_MS = 480
# A patch covers 0.975 s of audio from its start; scores are placed at its centre.
PATCH_CENTRE_MS = 488
BATCHNORM_EPSILON = 1e-4
BATCH_PATCHES = 64
# (depthwise separable, stride, filters) for yamnet.py's layer1..layer14.
LAYERS: tuple[tuple[bool, int, int], ...] = (
    (False, 2, 32),
    (True, 1, 64),
    (True, 2, 128),
    (True, 1, 128),
    (True, 2, 256),
    (True, 1, 256),
    (True, 2, 512),
    (True, 1, 512),
    (True, 1, 512),
    (True, 1, 512),
    (True, 1, 512),
    (True, 1, 512),
    (True, 2, 1024),
    (True, 1, 1024),
)
# AudioSet classes that mean a sung or spoken voice is audible.
VOICE_CLASSES = (
    "Speech",
    "Child speech, kid speaking",
    "Narration, monologue",
    "Singing",
    "Choir",
    "Chant",
    "Child singing",
    "Synthetic singing",
    "Rapping",
)
WEIGHTS_ENV = "CRATE_YAMNET_WEIGHTS"
DEFAULT_WEIGHTS = Path("/app/models/yamnet.npz")


def pad_waveform(waveform: np.ndarray) -> np.ndarray:
    """Zero-pad like yamnet.py: at least one patch, then a whole number of patch hops."""
    samples = np.asarray(waveform, dtype=np.float32).reshape(-1)
    padding = max(0, MIN_SAMPLES - samples.size)
    after_first = max(samples.size, MIN_SAMPLES) - MIN_SAMPLES
    hops = -(-after_first // PATCH_HOP_SAMPLES)
    padding += hops * PATCH_HOP_SAMPLES - after_first
    return np.pad(samples, (0, padding))


@lru_cache(maxsize=1)
def _hann_window() -> np.ndarray:
    # tf.signal.stft uses a periodic Hann window.
    n = np.arange(STFT_WINDOW)
    return 0.5 - 0.5 * np.cos(2 * np.pi * n / STFT_WINDOW)


def _hertz_to_mel(hertz: np.ndarray | float) -> np.ndarray:
    return 1127.0 * np.log1p(np.asarray(hertz, dtype=np.float64) / 700.0)


@lru_cache(maxsize=1)
def mel_matrix() -> np.ndarray:
    """tf.signal.linear_to_mel_weight_matrix(64, 257, 16000, 125, 7500)."""
    bins = FFT_LENGTH // 2 + 1
    linear = np.linspace(0.0, SAMPLE_RATE / 2, bins)[1:]
    spectrogram_mel = _hertz_to_mel(linear)[:, np.newaxis]
    edges = np.linspace(
        _hertz_to_mel(MEL_MIN_HZ), _hertz_to_mel(MEL_MAX_HZ), MEL_BANDS + 2
    )
    lower, centre, upper = edges[:-2], edges[1:-1], edges[2:]
    lower_slopes = (spectrogram_mel - lower) / (centre - lower)
    upper_slopes = (upper - spectrogram_mel) / (upper - centre)
    weights = np.maximum(0.0, np.minimum(lower_slopes, upper_slopes))
    # The DC bin carries no weight.
    return np.vstack([np.zeros((1, MEL_BANDS)), weights])


def log_mel_spectrogram(waveform: np.ndarray) -> np.ndarray:
    """Frames x 64 log-mel bands, as yamnet's features.py computes them."""
    samples = np.asarray(waveform, dtype=np.float64).reshape(-1)
    if samples.size < STFT_WINDOW:
        return np.zeros((0, MEL_BANDS), dtype=np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(samples, STFT_WINDOW)[::STFT_HOP]
    magnitude = np.abs(np.fft.rfft(frames * _hann_window(), n=FFT_LENGTH))
    return np.log(magnitude @ mel_matrix() + LOG_OFFSET).astype(np.float32)


def log_mel_patches(log_mel: np.ndarray) -> np.ndarray:
    """Patches x 96 frames x 64 bands, one every 48 frames."""
    if len(log_mel) < PATCH_FRAMES:
        return np.zeros((0, PATCH_FRAMES, MEL_BANDS), dtype=np.float32)
    windows = np.lib.stride_tricks.sliding_window_view(
        log_mel, (PATCH_FRAMES, MEL_BANDS)
    )[::PATCH_HOP_FRAMES, 0]
    return np.ascontiguousarray(windows, dtype=np.float32)


def same_padding(size: int, *, kernel: int, stride: int) -> tuple[int, int]:
    """TensorFlow "same" padding: the odd extra pixel goes after, not before."""
    out = -(-size // stride)
    total = max((out - 1) * stride + kernel - size, 0)
    return total // 2, total - total // 2


@dataclass(frozen=True, slots=True)
class VoiceWindows:
    """Voice score of each 0.975 s patch, placed at the patch centre."""

    centres_ms: np.ndarray
    scores: np.ndarray


def voice_windows(class_scores: np.ndarray, class_names: Sequence[str]) -> VoiceWindows:
    """The highest score among the voice classes, per patch."""
    indices = [i for i, name in enumerate(class_names) if name in VOICE_CLASSES]
    scores = np.asarray(class_scores, dtype=np.float32)
    voice = scores[:, indices].max(axis=1) if len(scores) else np.zeros(0, np.float32)
    centres = np.arange(len(voice), dtype=np.int64) * PATCH_HOP_MS + PATCH_CENTRE_MS
    return VoiceWindows(centres_ms=centres, scores=voice)


class YamnetModel:
    """YAMNet's classifier with the converted weights, run with torch on the CPU."""

    def __init__(self, weights: Mapping[str, np.ndarray], class_names: Sequence[str]):
        import torch

        self._torch = torch
        self.class_names = tuple(class_names)
        self._layers: list[dict[str, Any]] = []
        for number, (separable, stride, _filters) in enumerate(LAYERS, start=1):
            name = f"layer{number}"
            if separable:
                steps = [
                    (
                        f"{name}/depthwise_conv",
                        "depthwise_kernel",
                        (2, 3, 0, 1),
                        stride,
                        True,
                    ),
                    (f"{name}/pointwise_conv", "kernel", (3, 2, 0, 1), 1, False),
                ]
            else:
                steps = [(f"{name}/conv", "kernel", (3, 2, 0, 1), stride, False)]
            for prefix, kernel_name, order, step_stride, depthwise in steps:
                kernel = np.transpose(weights[f"{prefix}/{kernel_name}"], order)
                variance = weights[f"{prefix}/bn/moving_variance"]
                self._layers.append(
                    {
                        "kernel": self._tensor(kernel),
                        "stride": step_stride,
                        "groups": kernel.shape[0] if depthwise else 1,
                        "size": kernel.shape[-1],
                        "mean": self._tensor(weights[f"{prefix}/bn/moving_mean"]),
                        "scale": self._tensor(
                            1.0 / np.sqrt(variance + BATCHNORM_EPSILON)
                        ),
                        "beta": self._tensor(weights[f"{prefix}/bn/beta"]),
                    }
                )
        self._dense = self._tensor(weights["logits/kernel"])
        self._bias = self._tensor(weights["logits/bias"])

    def _tensor(self, array: np.ndarray) -> Any:
        return self._torch.from_numpy(np.ascontiguousarray(array, dtype=np.float32))

    @classmethod
    def load(cls, path: str | Path) -> YamnetModel:
        with np.load(path, allow_pickle=False) as archive:
            weights = {
                key: archive[key] for key in archive.files if key != "class_names"
            }
            names = [str(name) for name in archive["class_names"]]
        return cls(weights, names)

    def _forward(self, patches: np.ndarray) -> np.ndarray:
        torch = self._torch
        functional = torch.nn.functional
        x = torch.from_numpy(patches).unsqueeze(1)
        for layer in self._layers:
            height = same_padding(
                x.shape[2], kernel=layer["size"], stride=layer["stride"]
            )
            width = same_padding(
                x.shape[3], kernel=layer["size"], stride=layer["stride"]
            )
            x = functional.pad(x, (*width, *height))
            x = functional.conv2d(
                x, layer["kernel"], stride=layer["stride"], groups=layer["groups"]
            )
            x = (x - layer["mean"][:, None, None]) * layer["scale"][:, None, None]
            x = torch.relu(x + layer["beta"][:, None, None])
        embeddings = x.mean(dim=(2, 3))
        return torch.sigmoid(embeddings @ self._dense + self._bias).numpy()

    def class_scores(self, waveform: np.ndarray) -> np.ndarray:
        """Patches x 521 AudioSet class scores for 16 kHz mono audio."""
        patches = log_mel_patches(log_mel_spectrogram(pad_waveform(waveform)))
        if not len(patches):
            return np.zeros((0, len(self.class_names)), dtype=np.float32)
        with self._torch.inference_mode():
            return np.concatenate(
                [
                    self._forward(patches[start : start + BATCH_PATCHES])
                    for start in range(0, len(patches), BATCH_PATCHES)
                ]
            )

    def voice_windows(self, waveform: np.ndarray) -> VoiceWindows:
        return voice_windows(self.class_scores(waveform), self.class_names)


@lru_cache(maxsize=1)
def load_voice_model() -> YamnetModel | None:
    """The process-wide model, or None without torch or without the weights."""
    path = Path(os.environ.get(WEIGHTS_ENV) or DEFAULT_WEIGHTS)
    if not path.is_file():
        return None
    try:
        return YamnetModel.load(path)
    except ImportError:
        return None
    except Exception:
        log.warning("YAMNet weights at %s could not be loaded", path, exc_info=True)
        return None


__all__ = [
    "DEFAULT_WEIGHTS",
    "SAMPLE_RATE",
    "VOICE_CLASSES",
    "WEIGHTS_ENV",
    "VoiceWindows",
    "YamnetModel",
    "load_voice_model",
    "log_mel_patches",
    "log_mel_spectrogram",
    "mel_matrix",
    "pad_waveform",
    "same_padding",
    "voice_windows",
]
