"""Beats and downbeats from Beat This! for Smart Mix profiles (SM3-D14).

The unit tests feed a fake model and never touch the network. The tests that run the
real checkpoint skip unless the analysis image's weights and ``beat_this`` are present.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile

from crate.smart_mix import beat_model
from crate.smart_mix.beat_model import BeatTrack

SAMPLE_RATE = 22_050


class _FakeModel:
    tracker = "beat-this-fake"

    def __init__(self, beats=(), downbeats=(), error: Exception | None = None):
        self.beats = np.asarray(beats, dtype=np.float64)
        self.downbeats = np.asarray(downbeats, dtype=np.float64)
        self.error = error
        self.calls: list[tuple[int, int]] = []

    def __call__(self, signal: np.ndarray, sample_rate: int):
        self.calls.append((int(np.asarray(signal).size), int(sample_rate)))
        if self.error is not None:
            raise self.error
        return self.beats, self.downbeats


def _clicks(seconds: float, *, bpm: float = 120.0, rate: int = SAMPLE_RATE):
    audio = np.zeros(round(seconds * rate), dtype=np.float32)
    pulse = np.exp(-np.linspace(0.0, 7.0, round(0.025 * rate))).astype(np.float32)
    time = 0.5
    beat = 0
    while time < seconds - 0.1:
        start = round(time * rate)
        end = min(audio.size, start + pulse.size)
        audio[start:end] += (0.9 if beat % 4 == 0 else 0.35) * pulse[: end - start]
        time += 60.0 / bpm
        beat += 1
    return audio


@pytest.fixture
def fresh_model_cache():
    beat_model.load_beat_model.cache_clear()
    yield
    beat_model.load_beat_model.cache_clear()


def test_missing_weights_returns_none(monkeypatch, tmp_path, fresh_model_cache) -> None:
    del fresh_model_cache
    monkeypatch.setenv(beat_model.WEIGHTS_ENV, str(tmp_path / "missing.ckpt"))
    try:
        import torch
    except ImportError:
        pass
    else:
        # The weights come with the image: a missing file must never be fetched.
        def no_download(*_args, **_kwargs):
            raise AssertionError("Beat This! weights must never be downloaded")

        monkeypatch.setattr(torch.hub, "load_state_dict_from_url", no_download)

    assert beat_model.load_beat_model() is None
    assert beat_model.track_beats(_clicks(10.0), SAMPLE_RATE) is None


def test_long_track_skips_model() -> None:
    model = _FakeModel(beats=[0.5, 1.0], downbeats=[0.5])
    rate = 1_000
    too_long = np.zeros((beat_model.BEAT_MODEL_MAX_SECONDS + 1) * rate, np.float32)
    longest = np.zeros(beat_model.BEAT_MODEL_MAX_SECONDS * rate, np.float32)

    assert beat_model.BEAT_MODEL_MAX_SECONDS == 600
    assert beat_model.track_beats(too_long, rate, model=model) is None
    assert model.calls == []
    assert beat_model.track_beats(longest, rate, model=model) is not None
    assert model.calls == [(longest.size, rate)]


def test_returns_milliseconds() -> None:
    model = _FakeModel(
        beats=[0.0004, 0.5, 1.02, 1.0200001, 1.52, 2.04],
        downbeats=[0.5, 2.04],
    )

    track = beat_model.track_beats(_clicks(4.0), SAMPLE_RATE, model=model)

    # Whole, positive, strictly increasing milliseconds, like the tracked beats.
    assert track == BeatTrack(
        tracker="beat-this-fake",
        beats_ms=(1, 500, 1_020, 1_520, 2_040),
        downbeats_ms=(500, 2_040),
    )
    assert track.to_payload() == {
        "tracker": "beat-this-fake",
        "beats_ms": [1, 500, 1_020, 1_520, 2_040],
        "downbeats_ms": [500, 2_040],
    }


def test_no_beats_returns_none() -> None:
    model = _FakeModel(beats=[], downbeats=[])

    assert beat_model.track_beats(_clicks(4.0), SAMPLE_RATE, model=model) is None


def test_a_failing_model_returns_none_with_a_warning(caplog) -> None:
    model = _FakeModel(error=RuntimeError("out of memory"))

    with caplog.at_level(logging.WARNING):
        track = beat_model.track_beats(_clicks(4.0), SAMPLE_RATE, model=model)

    assert track is None
    assert "Beat This!" in caplog.text


def test_tracker_and_weights_follow_the_checkpoint(monkeypatch) -> None:
    monkeypatch.delenv(beat_model.WEIGHTS_ENV, raising=False)
    monkeypatch.delenv(beat_model.CHECKPOINT_ENV, raising=False)

    assert beat_model.BEAT_TRACKER == "beat-this-small0"
    assert beat_model.checkpoint_name() == "small0"
    assert beat_model.weights_path() == Path("/app/models/beat_this-small0.ckpt")

    monkeypatch.setenv(beat_model.CHECKPOINT_ENV, "final0")
    assert beat_model.beat_tracker_name() == "beat-this-final0"
    assert beat_model.weights_path() == Path("/app/models/beat_this-final0.ckpt")

    monkeypatch.setenv(beat_model.WEIGHTS_ENV, "/models/custom.ckpt")
    assert beat_model.weights_path() == Path("/models/custom.ckpt")

    # A checkpoint name is a short identifier, never a path or a URL.
    for unsafe in ("../small0", "https://example.org/x.ckpt", "x" * 21, ""):
        monkeypatch.setenv(beat_model.CHECKPOINT_ENV, unsafe)
        assert beat_model.checkpoint_name() == beat_model.DEFAULT_CHECKPOINT


def test_file_beats_without_model_do_not_decode(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(beat_model, "load_beat_model", lambda: None)

    def no_decode(_path):
        raise AssertionError("audio must not be decoded without a model")

    monkeypatch.setattr(beat_model, "_load_signal", no_decode)

    assert beat_model.track_file_beats(tmp_path / "track.flac") is None


def test_file_beats_skip_long_files_before_decoding(monkeypatch, tmp_path) -> None:
    model = _FakeModel(beats=[0.5], downbeats=[0.5])
    monkeypatch.setattr(
        beat_model,
        "_duration_seconds",
        lambda _path: beat_model.BEAT_MODEL_MAX_SECONDS + 0.5,
    )

    def no_decode(_path):
        raise AssertionError("a track over the limit must not be decoded")

    monkeypatch.setattr(beat_model, "_load_signal", no_decode)

    assert beat_model.track_file_beats(tmp_path / "set.flac", model=model) is None
    assert model.calls == []


def test_file_beats_decode_mono_at_the_model_rate(tmp_path) -> None:
    path = tmp_path / "stereo.wav"
    left = _clicks(6.0, rate=44_100)
    wavfile.write(path, 44_100, np.stack([left, left], axis=1))
    model = _FakeModel(beats=[0.5, 1.0, 1.5], downbeats=[0.5])

    track = beat_model.track_file_beats(path, model=model)

    assert track is not None and track.beats_ms == (500, 1_000, 1_500)
    ((samples, rate),) = model.calls
    assert rate == beat_model.MODEL_SAMPLE_RATE == 22_050
    assert abs(samples - 6 * 22_050) <= 2


def test_unreadable_files_return_none_with_a_warning(tmp_path, caplog) -> None:
    path = tmp_path / "broken.flac"
    path.write_bytes(b"not audio")

    with caplog.at_level(logging.WARNING):
        track = beat_model.track_file_beats(path, model=_FakeModel([0.5], [0.5]))

    assert track is None
    assert "Beat This!" in caplog.text


def _baked_weights() -> Path:
    path = beat_model.weights_path()
    if not path.is_file():
        pytest.skip("Beat This! weights ship in the analysis image only")
    pytest.importorskip("beat_this")
    return path


def test_baked_weights_track_a_click_track(monkeypatch, fresh_model_cache) -> None:
    del fresh_model_cache
    _baked_weights()
    import torch

    def no_download(*_args, **_kwargs):
        raise AssertionError("Beat This! weights must never be downloaded")

    monkeypatch.setattr(torch.hub, "load_state_dict_from_url", no_download)

    track = beat_model.track_beats(_clicks(30.0), SAMPLE_RATE)

    assert track is not None
    assert track.tracker == beat_model.beat_tracker_name()
    intervals = np.diff(track.beats_ms)
    assert len(track.beats_ms) >= 50
    assert 480 <= float(np.median(intervals)) <= 520


# Design SM3-D14: small0 costs about 15 s of CPU for a 240 s track with one thread on
# the development machine; the plan allows 25 s.
BEAT_MODEL_CPU_SECONDS_PER_240_S_TRACK = 25.0


@pytest.mark.benchmark
def test_beat_model_overhead_within_budget(fresh_model_cache) -> None:
    import time

    del fresh_model_cache
    _baked_weights()
    import torch

    torch.set_num_threads(1)
    os.environ["TORCH_NUM_THREADS"] = "1"
    model = beat_model.load_beat_model()
    assert model is not None
    audio = _clicks(240.0)
    model(audio[: SAMPLE_RATE * 5], SAMPLE_RATE)

    started = time.process_time()
    track = beat_model.track_beats(audio, SAMPLE_RATE, model=model)
    elapsed = time.process_time() - started

    assert track is not None
    assert elapsed <= BEAT_MODEL_CPU_SECONDS_PER_240_S_TRACK
