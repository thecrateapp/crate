"""madmom's downbeat model as a second opinion on bars of three.

The unit tests that run madmom skip unless the analysis image's madmom is installed.
"""

from __future__ import annotations

import logging
import sys

import numpy as np
import pytest
from scipy.io import wavfile

from crate.smart_mix import meter_arbiter


@pytest.fixture
def fresh_arbiter_cache():
    meter_arbiter.load_meter_arbiter.cache_clear()
    yield
    meter_arbiter.load_meter_arbiter.cache_clear()


def _activations(beats_per_bar: int, *, fps: int, seconds: float = 30.0):
    frames = round(fps * seconds)
    activations = np.full((frames, 2), 1e-3)
    period = round(fps * 0.5)  # 120 BPM
    for index, frame in enumerate(range(period // 2, frames, period)):
        activations[frame, 1 if index % beats_per_bar == 0 else 0] = 0.9
    return activations


@pytest.mark.parametrize("beats_per_bar", [3, 4])
def test_meter_follows_the_dbn_path_with_the_higher_probability(beats_per_bar) -> None:
    downbeats = pytest.importorskip("madmom.features.downbeats")
    dbn = downbeats.DBNDownBeatTrackingProcessor(
        beats_per_bar=list(meter_arbiter.ARBITER_BEATS_PER_BAR),
        fps=meter_arbiter.ARBITER_FPS,
    )

    meter = meter_arbiter.meter_from_activations(
        dbn, _activations(beats_per_bar, fps=meter_arbiter.ARBITER_FPS)
    )

    assert meter == beats_per_bar


def test_no_beats_give_no_meter() -> None:
    downbeats = pytest.importorskip("madmom.features.downbeats")
    dbn = downbeats.DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)

    assert meter_arbiter.meter_from_activations(dbn, np.zeros((500, 2))) is None


def test_missing_madmom_gives_no_arbiter_with_a_warning(
    monkeypatch, caplog, fresh_arbiter_cache
) -> None:
    monkeypatch.setitem(sys.modules, "madmom.features.downbeats", None)

    with caplog.at_level(logging.WARNING, logger=meter_arbiter.__name__):
        assert meter_arbiter.load_meter_arbiter() is None

    assert "madmom" in caplog.text


def test_the_arbiter_reads_a_file_with_madmoms_network(
    tmp_path, fresh_arbiter_cache
) -> None:
    # The real network on a click track with an accent every fourth beat. It only
    # checks the plumbing (decoding at 44.1 kHz, network, DBN); the measurement on real
    # music is in the three-beat bar plan.
    pytest.importorskip("madmom.features.downbeats")
    rate = meter_arbiter.ARBITER_SAMPLE_RATE
    audio = np.zeros(rate * 20, dtype=np.float32)
    pulse = np.exp(-np.linspace(0.0, 7.0, round(0.03 * rate))).astype(np.float32)
    for index, start in enumerate(range(rate // 2, audio.size - pulse.size, rate // 2)):
        audio[start : start + pulse.size] += (0.9 if index % 4 == 0 else 0.3) * pulse
    path = tmp_path / "clicks.wav"
    wavfile.write(path, rate, audio)

    arbiter = meter_arbiter.load_meter_arbiter()

    assert arbiter is not None
    assert arbiter(path) in (3, 4)
