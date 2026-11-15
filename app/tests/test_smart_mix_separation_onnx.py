"""``htdemucs-onnx-1`` on ONNX Runtime CPU, in the analysis image (Smart Mix Stems).

Skipped unless ``CRATE_REQUIRE_SEPARATION=1``: it needs onnxruntime and the 174 MB
graph the analysis image bakes in (``/app/models``, or ``CRATE_HTDEMUCS_ONNX``), and a
few minutes of CPU. Run it in that image after building it::

    docker run --rm -e CRATE_REQUIRE_SEPARATION=1 -v "$PWD/app:/workspace/app" \\
        -w /workspace/app --entrypoint python crate-analysis-worker \\
        -m pytest tests/test_smart_mix_separation_onnx.py -q

The input is Crate Decks' 10 s synthetic golden track (tones, noise and clicks, never
music), rebuilt here bit for bit. Its stems must give the level bytes of the golden
stems, which PyTorch computed on the CPU with the same DSP. With
``CRATE_HTDEMUCS_GOLDEN_DIR`` pointing at the golden set (``htdemucs-onnx-1-golden``,
a release asset next to the graph), the stems are also compared sample by sample: at
least 60 dB SDR per stem, the export check's bar.
"""

from __future__ import annotations

import base64
import hashlib
import math
import os
from pathlib import Path

import numpy as np
import pytest

from crate.smart_mix import separation
from crate.smart_mix.stems import STEM_SOURCES

pytestmark = pytest.mark.skipif(
    os.environ.get("CRATE_REQUIRE_SEPARATION") != "1",
    reason="needs the analysis image with the htdemucs graph (CRATE_REQUIRE_SEPARATION=1)",
)

RATE = separation.SAMPLE_RATE
GOLDEN_INPUT_SHA256 = "521638a994beb38439fee24469325d03d5a03b88061637fdf73530a5270e9853"
# Level bytes of the golden stems (htdemucs on PyTorch CPU, fp32), base64.
GOLDEN_LEVELS = {
    "drums": "qpOmm6Cim6OWqI+niKqDqX6qeql1q2+qbaxoqmKsiaeao56dpJmlkg==",
    "bass": "io6MjoyOjo2NjY2NjI2Mio6KjoqPi46MjYyNjIyNjIqOjY2NjYyOjg==",
    "other": "GSI9UV9obW9va2RZSTIYEBkxSVlka25vbWleUDwgFRUjPVFfaG1wbw==",
    "vocals": "dXV1dXd3d3YREBAQEBAQbXl4eHV0dHM1EBAQEBAQEHNzc3N1dXVzEA==",
}
MIN_SDR_DB = 60.0


def synthetic_mix(seconds: float, seed: int = 0) -> np.ndarray:
    """Crate Decks' ``stems_dsp.synthetic_mix``: (2, N) float32 with energy in every stem.

    Decaying sine kicks, noise hats and snares at 124 BPM, clicks, a harmonic bass line,
    a sustained chord and a vibrato tone with vowel-like formants.
    """
    rng = np.random.default_rng(seed)
    n = int(round(seconds * RATE))
    t = np.arange(n) / RATE
    beat = 60 / 124
    out = np.zeros((2, n))

    def place(sig: np.ndarray, start_s: float, pan: float) -> None:
        i = int(start_s * RATE)
        if i >= n:
            return
        seg = sig[: n - i]
        out[0, i : i + len(seg)] += seg * math.cos((pan + 1) * math.pi / 4)
        out[1, i : i + len(seg)] += seg * math.sin((pan + 1) * math.pi / 4)

    tk = np.arange(int(0.35 * RATE)) / RATE
    kick = np.sin(2 * np.pi * (45 * tk + 60 * (1 - np.exp(-tk * 30)) / 30)) * np.exp(
        -tk * 9
    )
    th = np.arange(int(0.05 * RATE)) / RATE
    snare_t = np.arange(int(0.18 * RATE)) / RATE
    for k in range(int(seconds / beat) + 1):
        place(0.9 * kick, k * beat, 0.0)
        hat = np.diff(rng.standard_normal(len(th) + 1)) * np.exp(-th * 80)
        place(0.12 * hat, k * beat + beat / 2, 0.3)
        if k % 2 == 1:
            snare = (
                rng.standard_normal(len(snare_t)) * 0.5
                + np.sin(2 * np.pi * 190 * snare_t)
            ) * np.exp(-snare_t * 22)
            place(0.35 * snare, k * beat, -0.1)
        place(np.array([0.6, -0.6]), k * beat + beat / 4, 0.5)

    bass_notes = [41.2, 41.2, 55.0, 49.0]
    for k in range(int(seconds / (beat / 2)) + 1):
        f0 = bass_notes[(k // 4) % len(bass_notes)]
        tb = np.arange(int(beat / 2 * RATE)) / RATE
        tone = sum(np.sin(2 * np.pi * f0 * h * tb) / h for h in range(1, 6))
        place(
            0.25 * tone * np.minimum(1, tb * 200) * np.exp(-tb * 4),
            k * beat / 2,
            0.0,
        )

    chord = sum(
        np.sin(2 * np.pi * f * t + p)
        for f, p in ((261.6, 0.0), (329.6, 1.0), (392.0, 2.0))
    )
    swell = 0.5 - 0.5 * np.cos(2 * np.pi * t / (8 * beat))
    out[0] += 0.05 * chord * swell
    out[1] += 0.05 * np.roll(chord, 220) * swell

    f0 = (
        220
        * 2 ** (np.floor(t / (2 * beat)) % 3 * 2 / 12)
        * (1 + 0.012 * np.sin(2 * np.pi * 5.5 * t))
    )
    phase = 2 * np.pi * np.cumsum(f0) / RATE
    voice = np.zeros(n)
    for h in range(1, 25):
        fh = h * f0
        formant = (
            np.exp(-(((fh - 750) / 180) ** 2))
            + 0.6 * np.exp(-(((fh - 1200) / 220) ** 2))
            + 0.25 * np.exp(-(((fh - 2600) / 400) ** 2))
        )
        voice += formant * np.sin(h * phase) / h**0.5
    syllables = np.clip(np.sin(np.pi * (t / (beat / 2))) ** 2, 0, 1) * (
        np.floor(t / (4 * beat)) % 2 == 0
    )
    voice *= 0.18 * syllables
    out += voice

    out += 10 ** (-50 / 20) * rng.standard_normal((2, n))
    return (out / np.abs(out).max() * 0.6).astype(np.float32)


def _sdr(reference: np.ndarray, estimate: np.ndarray) -> float:
    error = np.sum((reference - estimate) ** 2)
    return float(10 * np.log10(np.sum(reference**2) / max(error, 1e-30)))


def test_htdemucs_onnx_separates_the_golden_track(tmp_path: Path) -> None:
    import soundfile as sf

    assert separation.separation_unavailable_reason() is None
    track = synthetic_mix(10.0, seed=0)
    assert hashlib.sha256(track.astype("<f4").tobytes()).hexdigest() == (
        GOLDEN_INPUT_SHA256
    )
    path = tmp_path / "golden.wav"
    sf.write(str(path), track.T, RATE, subtype="FLOAT")
    scratch = tmp_path / "scratch"
    scratch.mkdir()

    with separation.separate(
        path, threads=separation.separation_threads(), scratch=scratch
    ) as stems:
        analysis = separation.analyze_stems(stems)
        separated = np.stack([stems.read(name) for name in STEM_SOURCES])

    assert separated.shape == (4, 2, track.shape[-1])
    assert np.isfinite(separated).all()
    for stem in STEM_SOURCES:
        levels = getattr(analysis.levels, stem)
        golden = base64.b64decode(GOLDEN_LEVELS[stem])
        assert len(levels) == len(golden) == 40
        assert max(abs(a - b) for a, b in zip(levels, golden, strict=True)) <= 1, stem

    golden_dir = os.environ.get("CRATE_HTDEMUCS_GOLDEN_DIR")
    if golden_dir:
        raw = (Path(golden_dir) / "track_stems.bin").read_bytes()
        expected = np.frombuffer(raw, dtype="<f4").reshape(separated.shape)
        for index, stem in enumerate(STEM_SOURCES):
            sdr = _sdr(
                expected[index].astype(np.float64), separated[index].astype(np.float64)
            )
            assert sdr >= MIN_SDR_DB, (stem, sdr)
