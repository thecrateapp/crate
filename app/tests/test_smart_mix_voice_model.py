"""YAMNet port behind the per-phrase voice of Smart Mix profiles (SM3-D13).

The reference values in ``fixtures/smart_mix/yamnet_reference.npz`` come from Google's
YAMNet (tensorflow/models, research/audioset/yamnet, with ``yamnet.h5``) run under
TensorFlow on the synthetic signal below, plus the names of ``yamnet_class_map.csv``.
The front end is compared on every run; the network needs the converted weights and
skips without them, like the Rust parity test.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

from crate.smart_mix import voice_model

FIXTURE = Path(__file__).parent / "fixtures/smart_mix/yamnet_reference.npz"


def _synthetic() -> np.ndarray:
    t = np.arange(int(3.3 * 16_000)) / 16_000
    noise = np.random.default_rng(1).standard_normal(t.size)
    return (0.3 * np.sin(2 * np.pi * 440 * t) + 0.05 * noise).astype(np.float32)


def test_log_mel_matches_the_reference_front_end() -> None:
    reference = np.load(FIXTURE)["log_mel"]
    log_mel = voice_model.log_mel_spectrogram(voice_model.pad_waveform(_synthetic()))

    assert log_mel.shape == (336, 64)
    np.testing.assert_allclose(log_mel[: len(reference)], reference, atol=1e-3)


def test_patches_follow_the_reference_framing() -> None:
    log_mel = voice_model.log_mel_spectrogram(voice_model.pad_waveform(_synthetic()))

    assert voice_model.log_mel_patches(log_mel).shape == (6, 96, 64)


def test_short_audio_is_padded_to_one_patch() -> None:
    padded = voice_model.pad_waveform(np.zeros(1_000, dtype=np.float32))
    patches = voice_model.log_mel_patches(voice_model.log_mel_spectrogram(padded))

    assert padded.size == 15_600
    assert patches.shape[0] == 1


@pytest.mark.parametrize(
    ("size", "stride", "expected"),
    [(96, 2, (0, 1)), (64, 2, (0, 1)), (48, 1, (1, 1)), (3, 2, (1, 1)), (1, 1, (1, 1))],
)
def test_same_padding_matches_tensorflow(size, stride, expected) -> None:
    assert voice_model.same_padding(size, kernel=3, stride=stride) == expected


def test_voice_windows_take_the_max_over_the_voice_classes() -> None:
    names = ("Music", "Speech", "Singing", "Guitar")
    scores = np.array([[0.9, 0.1, 0.3, 0.5], [0.2, 0.6, 0.1, 0.0]], dtype=np.float32)

    windows = voice_model.voice_windows(scores, names)

    np.testing.assert_allclose(windows.scores, [0.3, 0.6])
    assert windows.centres_ms.tolist() == [488, 968]


def test_every_voice_class_exists_in_the_yamnet_class_map() -> None:
    names = set(np.load(FIXTURE)["class_names"].tolist())

    assert len(names) == 521
    assert set(voice_model.VOICE_CLASSES) <= names


def test_missing_weights_leave_no_model(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv(voice_model.WEIGHTS_ENV, str(tmp_path / "missing.npz"))
    voice_model.load_voice_model.cache_clear()
    try:
        assert voice_model.load_voice_model() is None
    finally:
        voice_model.load_voice_model.cache_clear()


def test_converted_weights_reproduce_the_reference_scores() -> None:
    path = Path(os.environ.get(voice_model.WEIGHTS_ENV, voice_model.DEFAULT_WEIGHTS))
    if not path.is_file():
        pytest.skip(
            "YAMNet weights are not converted here; they ship in the analysis image"
        )
    pytest.importorskip("torch")
    model = voice_model.YamnetModel.load(path)

    scores = model.class_scores(_synthetic())

    assert set(voice_model.VOICE_CLASSES) <= set(model.class_names)
    np.testing.assert_allclose(scores, np.load(FIXTURE)["scores"], atol=2e-3)
