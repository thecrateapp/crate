"""The DSP around the htdemucs graph against the Crate Decks reference fixtures.

Both producers of ``stem-analysis/1`` run the same graph with the same STFT, iSTFT,
overlap-add and normalisation (STEM-D3). The fixtures come from the numpy reference in
Crate Decks (``tests/fixtures/smart_mix/htdemucs-dsp/README.md``).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from crate.smart_mix import separation

FIXTURES = Path(__file__).parent / "fixtures" / "smart_mix" / "htdemucs-dsp"
TOLERANCE = 1e-5


@pytest.fixture(scope="module")
def index() -> dict:
    return json.loads((FIXTURES / "index.json").read_text())


def _load(index: dict, key: str) -> np.ndarray:
    entry = index["files"][key]
    raw = (FIXTURES / entry["file"]).read_bytes()
    return np.frombuffer(raw, dtype="<f4").reshape(entry["shape"]).astype(np.float64)


def test_fixtures_are_the_published_bytes(index: dict) -> None:
    for entry in index["files"].values():
        raw = (FIXTURES / entry["file"]).read_bytes()
        assert len(raw) == entry["bytes"]
        assert hashlib.sha256(raw).hexdigest() == entry["sha256"]


def test_parameters_match_the_reference(index: dict) -> None:
    dsp = index["dsp"]
    assert dsp["sample_rate"] == separation.SAMPLE_RATE
    assert dsp["n_fft"] == separation.NFFT
    assert dsp["hop"] == separation.HOP
    assert dsp["bins"] == separation.BINS
    assert dsp["pre_pad"] == separation.PRE_PAD
    assert dsp["edge_frames"] == separation.EDGE_FRAMES
    assert dsp["segment"] == separation.SEGMENT
    assert dsp["stride"] == separation.STRIDE
    assert tuple(dsp["sources"]) == separation.SOURCES


def test_stft_matches_the_reference(index: dict) -> None:
    x = _load(index, "stft_input")
    expected = _load(index, "stft_cac")

    spec = separation.to_cac(separation.stft(x))

    assert spec.shape == expected.shape
    assert spec.dtype == np.float32
    assert np.abs(spec - expected).max() < TOLERANCE


def test_istft_round_trip_matches_the_reference(index: dict) -> None:
    cac = _load(index, "stft_cac")
    expected = _load(index, "istft_roundtrip")

    spectrum = separation.from_cac(cac)[0]
    y = separation.istft(spectrum, expected.shape[-1])

    assert y.shape == expected.shape
    assert np.abs(y - expected).max() < TOLERANCE


def test_istft_of_a_random_spectrum_matches_the_reference(index: dict) -> None:
    cac = _load(index, "istft_random_cac")
    expected = _load(index, "istft_random_output")

    y = separation.istft(separation.from_cac(cac[0]), expected.shape[-1])

    assert y.shape == expected.shape
    assert np.abs(y - expected).max() < TOLERANCE


def test_overlap_add_matches_the_reference(index: dict) -> None:
    ola = index["overlap_add"]
    segment, stride, length = ola["segment"], ola["stride"], ola["length"]
    x = _load(index, "ola_input")
    expected = _load(index, "ola_output")
    ramp = 0.5 + np.arange(segment) / segment

    def mock(chunk: np.ndarray) -> np.ndarray:
        return np.stack([chunk * ramp, chunk * (1.5 - ramp)])

    assert separation.segment_offsets(length, stride) == ola["offsets"]
    blocks = list(
        separation.overlap_add(
            lambda lo, hi: x[:, lo:hi], length, mock, segment=segment, stride=stride
        )
    )
    assert [start for start, _ in blocks] == [0, 1500, 3000, 4500]
    y = np.concatenate([block for _, block in blocks], axis=-1)

    assert y.shape == expected.shape
    assert np.abs(y - expected).max() < TOLERANCE
    assert np.abs(separation.ola_weight(segment) - _load(index, "ola_weight")).max() < (
        TOLERANCE
    )


def test_the_real_overlap_add_weight_has_the_reference_values(index: dict) -> None:
    real = index["overlap_add"]["real_weight"]
    weight = separation.ola_weight()

    assert weight.shape == (real["segment"],)
    for position, value in real["values"].items():
        assert weight[int(position)] == pytest.approx(value, rel=1e-12)


def test_normalisation_matches_the_reference(index: dict) -> None:
    reference = index["normalisation"]
    x = _load(index, "ola_input")

    mean, scale = separation.normalisation(x)

    assert mean == pytest.approx(reference["mean"], rel=1e-9)
    assert scale == pytest.approx(reference["scale"], rel=1e-9)
