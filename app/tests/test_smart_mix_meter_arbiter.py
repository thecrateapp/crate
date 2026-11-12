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
    audio = _click_track(20.0, rate)
    path = tmp_path / "clicks.wav"
    wavfile.write(path, rate, audio)

    arbiter = meter_arbiter.load_meter_arbiter()

    assert arbiter is not None
    assert arbiter(path) in (3, 4)


def _click_track(seconds: float, rate: int) -> np.ndarray:
    audio = np.zeros(round(rate * seconds), dtype=np.float32)
    pulse = np.exp(-np.linspace(0.0, 7.0, round(0.03 * rate))).astype(np.float32)
    for index, start in enumerate(range(rate // 2, audio.size - pulse.size, rate // 2)):
        audio[start : start + pulse.size] += (0.9 if index % 4 == 0 else 0.3) * pulse
    return audio


def test_chunked_features_are_madmoms_features(
    monkeypatch, fresh_arbiter_cache
) -> None:
    # The memory bound must not change what the network reads: the features computed
    # a chunk at a time equal madmom's own pre-processing of the whole signal, and no
    # STFT sees more than a chunk of frames.
    downbeats = pytest.importorskip("madmom.features.downbeats")
    from madmom.audio.signal import Signal

    rate = meter_arbiter.ARBITER_SAMPLE_RATE
    audio = _click_track(21.37, rate)
    reference = downbeats.RNNDownBeatProcessor(num_threads=1).processors[0](
        Signal(audio, sample_rate=rate, num_channels=1)
    )
    monkeypatch.setattr(meter_arbiter, "FEATURE_CHUNK_FRAMES", 700)
    arbiter = meter_arbiter.MadmomMeterArbiter()
    frames_per_stft: list[int] = []
    for branch in arbiter._network.processors[0].processors[1].processors:
        stft = branch.processors[1]
        original = stft.process
        monkeypatch.setattr(
            stft,
            "process",
            lambda data, _original=original, **kwargs: (
                frames_per_stft.append(data.num_frames) or _original(data, **kwargs)
            ),
        )

    features = arbiter.features(audio, rate)

    assert features.shape == reference.shape
    np.testing.assert_allclose(features, reference, rtol=0, atol=1e-6)
    assert max(frames_per_stft) == 700
    assert len(frames_per_stft) == 3 * 4


@pytest.mark.parametrize("beats_per_bar", [3, 4])
def test_the_arbiter_scores_bar_lengths_as_madmoms_viterbi(beats_per_bar) -> None:
    # The arbiter keeps no back-pointers (frames x states, 3.3 GB on a 555 s track),
    # but its log probabilities are madmom's Viterbi's.
    downbeats = pytest.importorskip("madmom.features.downbeats")
    from crate.smart_mix.beat_model import decode_bar_paths

    dbn = downbeats.DBNDownBeatTrackingProcessor(
        beats_per_bar=list(meter_arbiter.ARBITER_BEATS_PER_BAR),
        fps=meter_arbiter.ARBITER_FPS,
    )
    rng = np.random.default_rng(beats_per_bar)
    activations = _activations(beats_per_bar, fps=meter_arbiter.ARBITER_FPS)
    # Noise that keeps both classes under 1 together, as a softmax does.
    activations = activations + rng.uniform(0, 0.04, activations.shape)
    thresholded, _ = downbeats.threshold_activations(activations, dbn.threshold)

    light = [
        meter_arbiter.viterbi_log_probability(hmm, thresholded) for hmm in dbn.hmms
    ]

    assert light == [
        path.log_probability for path in decode_bar_paths(dbn, activations).paths
    ]
    expected = decode_bar_paths(dbn, activations).best().beats_per_bar
    dbn.hmms = [_ScoresOnly(hmm) for hmm in dbn.hmms]
    assert meter_arbiter.meter_from_activations(dbn, activations) == expected


class _ScoresOnly:
    """An HMM whose path (madmom's Viterbi with its back-pointers) must not be asked."""

    def __init__(self, hmm) -> None:
        self.transition_model = hmm.transition_model
        self.observation_model = hmm.observation_model
        self.initial_distribution = hmm.initial_distribution

    def viterbi(self, observations):
        raise AssertionError("the arbiter needs no path")


def test_the_decoded_audio_is_freed_before_the_network_runs(monkeypatch) -> None:
    """The 44.1 kHz audio (about 100 MB for 600 s) is not held through the network
    and the DBN, which lowers the process's peak."""
    import weakref

    from crate.smart_mix import beat_model

    decoded: list[weakref.ref] = []
    alive_in_network: list[bool] = []

    def load_signal(path, rate):
        samples = np.zeros(44_100, dtype=np.float32)
        decoded.append(weakref.ref(samples))
        return samples, rate

    def network(features):
        alive_in_network.append(decoded[0]() is not None)
        return np.zeros((len(features), 2))

    class _Network:
        processors = (None, network, lambda activations: activations)

    arbiter = object.__new__(meter_arbiter.MadmomMeterArbiter)
    arbiter._network = _Network()
    arbiter._dbn = object()
    monkeypatch.setattr(beat_model, "_load_signal", load_signal)
    monkeypatch.setattr(arbiter, "features", lambda samples, rate: np.zeros((10, 4)))
    monkeypatch.setattr(meter_arbiter, "meter_from_activations", lambda dbn, act: 4)

    assert arbiter("track.flac") == 4
    assert alive_in_network == [False]
