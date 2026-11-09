"""Server separation around an injected graph (Smart Mix Stems, ST2.PR2).

The real graph is ``htdemucs-onnx-1`` on ONNX Runtime (``test_smart_mix_separation_onnx``);
here a fake graph stands in for it, so these tests check what the server does around
the network: decoding, normalisation, segments, overlap-add, the levels of
``stem-analysis/1``, the drum beats and the scratch files.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from crate.smart_mix import separation
from crate.smart_mix.source import smart_mix_source_revision
from crate.smart_mix.stem_storage import StemsVolumeError, scratch_directory
from crate.smart_mix.stems import STEM_SOURCES, encode_levels

RATE = separation.SAMPLE_RATE
SOURCES = len(STEM_SOURCES)
SPEC_SHAPE = (1, SOURCES, 4, separation.BINS, separation.SEGMENT_FRAMES)


def _write(path: Path, wav: np.ndarray) -> Path:
    sf.write(str(path), np.ascontiguousarray(wav.T), RATE, subtype="FLOAT")
    return path


def _gain_graph(gains: tuple[float, ...]):
    """Each stem is the segment times its gain, through the time branch only."""

    def graph(mix: np.ndarray, spec: np.ndarray):
        assert mix.shape == (1, 2, separation.SEGMENT) and mix.dtype == np.float32
        assert spec.shape == (1, 4, separation.BINS, separation.SEGMENT_FRAMES)
        wave = np.stack([mix[0] * gain for gain in gains])[None]
        return np.zeros(SPEC_SHAPE, np.float32), wave.astype(np.float32)

    return graph


def _stem(stems: separation.SeparatedStems, name: str) -> np.ndarray:
    return stems.read(name).astype(np.float64)


@pytest.fixture
def scratch(tmp_path: Path) -> Path:
    directory = tmp_path / "scratch"
    directory.mkdir()
    return directory


def test_levels_follow_each_stem(tmp_path: Path, scratch: Path) -> None:
    seconds = 12.0
    t = np.arange(int(seconds * RATE)) / RATE
    amplitude = np.where(t < 6.0, 0.5, 0.05)
    tone = amplitude * np.sin(2 * np.pi * 440 * t)
    path = _write(tmp_path / "tone.wav", np.stack([tone, tone]))
    gains = (1.0, 0.5, 0.0, 0.1)

    with separation.separate(
        path, threads=1, scratch=scratch, graph=_gain_graph(gains)
    ) as stems:
        analysis = separation.analyze_stems(stems)

    assert analysis.producer == separation.SERVER_PRODUCER
    assert analysis.separator.model == "htdemucs"
    assert analysis.separator.version == "htdemucs-onnx-1"
    assert analysis.source_revision == smart_mix_source_revision(path)
    assert analysis.duration_ms == 12_000
    assert analysis.drum_beats_ms is None
    windows = 48  # 12 s of 250 ms
    for stem, gain in zip(STEM_SOURCES, gains, strict=True):
        levels = getattr(analysis.levels, stem)
        assert len(levels) == windows
        if gain == 0:
            assert set(levels) == {0}
            continue
        loud = encode_levels(np.array([20 * np.log10(0.5 * gain / np.sqrt(2))]))[0]
        quiet = encode_levels(np.array([20 * np.log10(0.05 * gain / np.sqrt(2))]))[0]
        assert all(abs(level - loud) <= 1 for level in levels[:24]), stem
        assert all(abs(level - quiet) <= 1 for level in levels[24:]), stem
        assert loud > quiet


def test_the_last_window_covers_the_samples_it_has(
    tmp_path: Path, scratch: Path
) -> None:
    frames = 10 * 11_025 + 3_000  # 2.568 s: ten windows and part of one
    tone = 0.5 * np.sin(2 * np.pi * 220 * np.arange(frames) / RATE)
    path = _write(tmp_path / "short.wav", np.stack([tone, tone]))

    with separation.separate(
        path, threads=1, scratch=scratch, graph=_gain_graph((1.0, 1.0, 1.0, 1.0))
    ) as stems:
        analysis = separation.analyze_stems(stems)

    assert analysis.duration_ms == round(frames * 1000 / RATE)
    assert len(analysis.levels.drums) == 11
    assert abs(analysis.levels.drums[-1] - analysis.levels.drums[0]) <= 1


def test_overlap_add_with_an_identity_graph_reconstructs_the_input(
    tmp_path: Path, scratch: Path
) -> None:
    # Three segments, the last one short, and a DC offset to undo.
    rng = np.random.default_rng(5)
    wav = 0.2 * rng.standard_normal((2, int(20.5 * RATE))) + 0.01
    path = _write(tmp_path / "noise.wav", wav)
    expected = wav.astype(np.float32).astype(np.float64)

    with separation.separate(
        path, threads=1, scratch=scratch, graph=_gain_graph((1.0, 1.0, 1.0, 1.0))
    ) as stems:
        assert stems.frames == wav.shape[-1]
        for name in STEM_SOURCES:
            assert np.abs(_stem(stems, name) - expected).max() < 1e-5, name


def _reference_separate(wav: np.ndarray, graph) -> np.ndarray:
    """Crate Decks' stems_dsp.separate, the whole track in memory."""
    ref = np.asarray(wav, np.float64).mean(axis=0)
    mean, scale = float(ref.mean()), float(ref.std(ddof=1) + 1e-8)
    x = (np.asarray(wav, np.float64) - mean) / scale
    length = x.shape[-1]
    segment, stride = separation.SEGMENT, separation.STRIDE
    weight = separation.ola_weight(segment)
    out = np.zeros((SOURCES, 2, length))
    total = np.zeros(length)
    for offset in range(0, length, stride):
        chunk = min(segment, length - offset)
        start = offset - (segment - chunk) // 2
        lo, hi = max(0, start), min(length, start + segment)
        padded = np.pad(x[:, lo:hi], ((0, 0), (lo - start, start + segment - hi)))
        mix = padded[None].astype(np.float32)
        spec_out, wave_out = graph(mix, separation.to_cac(separation.stft(mix[0])))
        y = separation.istft(separation.from_cac(spec_out[0]), segment) + np.asarray(
            wave_out[0], np.float64
        )
        delta = segment - chunk
        y = y[..., delta // 2 : segment - (delta - delta // 2)]
        out[..., offset : offset + chunk] += weight[:chunk] * y
        total[offset : offset + chunk] += weight[:chunk]
    return out / total * scale + mean


def test_streaming_separation_matches_the_reference_pipeline(
    tmp_path: Path, scratch: Path
) -> None:
    rng = np.random.default_rng(11)
    t = np.arange(int(18.2 * RATE)) / RATE
    wav = np.stack(
        [
            0.3 * np.sin(2 * np.pi * 110 * t) + 0.05 * rng.standard_normal(t.size),
            0.2 * np.sin(2 * np.pi * 330 * t + 1.0)
            + 0.05 * rng.standard_normal(t.size),
        ]
    ).astype(np.float32)
    path = _write(tmp_path / "mix.wav", wav)
    spec_gains = np.array([0.7, 0.2, 0.1, 0.0], np.float32)
    wave_gains = np.array([0.0, 0.3, -0.2, 0.9], np.float32)
    ramp = np.linspace(0.5, 1.5, separation.SEGMENT, dtype=np.float32)

    def graph(mix: np.ndarray, spec: np.ndarray):
        spec_out = spec[:, None] * spec_gains[None, :, None, None, None]
        wave_out = (mix * ramp)[:, None] * wave_gains[None, :, None, None]
        return spec_out.astype(np.float32), wave_out.astype(np.float32)

    expected = _reference_separate(wav, graph)
    with separation.separate(path, threads=1, scratch=scratch, graph=graph) as stems:
        for index, name in enumerate(STEM_SOURCES):
            assert np.abs(_stem(stems, name) - expected[index]).max() < 1e-5, name


def _scratch_files(scratch: Path) -> list[Path]:
    return sorted(path for path in scratch.rglob("*"))


def test_scratch_files_are_removed_on_success_and_on_failure(
    tmp_path: Path, scratch: Path
) -> None:
    tone = 0.3 * np.sin(2 * np.pi * 220 * np.arange(3 * RATE) / RATE)
    path = _write(tmp_path / "tone.wav", np.stack([tone, tone]))

    with separation.separate(
        path, threads=1, scratch=scratch, graph=_gain_graph((1.0, 0.5, 0.2, 0.1))
    ) as stems:
        # Only the stems stay while they are open; the decoded input is gone.
        assert sorted(p.name for p in _scratch_files(scratch) if p.is_file()) == sorted(
            f"{name}.f32" for name in STEM_SOURCES
        )
        assert all(stems.path(name).parent.parent == scratch for name in STEM_SOURCES)
    assert _scratch_files(scratch) == []

    def broken(mix: np.ndarray, spec: np.ndarray):
        raise RuntimeError("graph failed")

    with pytest.raises(RuntimeError, match="graph failed"):
        separation.separate(path, threads=1, scratch=scratch, graph=broken)
    assert _scratch_files(scratch) == []

    not_audio = tmp_path / "not-audio.flac"
    not_audio.write_bytes(b"not audio at all")
    with pytest.raises(separation.SeparationError):
        separation.separate(
            not_audio, threads=1, scratch=scratch, graph=_gain_graph((1.0,) * 4)
        )
    assert _scratch_files(scratch) == []


def test_a_track_shorter_than_a_second_is_refused(
    tmp_path: Path, scratch: Path
) -> None:
    path = _write(tmp_path / "blip.wav", np.zeros((2, RATE // 2)))

    with pytest.raises(separation.SeparationError, match="too short"):
        separation.separate(
            path, threads=1, scratch=scratch, graph=_gain_graph((1.0,) * 4)
        )
    assert _scratch_files(scratch) == []


class _FakeBeatModel:
    tracker = "beat-this-small0-dbn"

    def __init__(self) -> None:
        self.calls: list[tuple[np.ndarray, int]] = []

    def __call__(self, signal: np.ndarray, sample_rate: int):
        self.calls.append((signal, sample_rate))
        return np.array([0.5, 1.0, 1.5, 2.0]), np.array([0.5, 2.0])


def test_drum_beats_come_from_the_drum_stem(tmp_path: Path, scratch: Path) -> None:
    seconds = 4
    t = np.arange(seconds * RATE) / RATE
    tone = 0.4 * np.sin(2 * np.pi * 100 * t)
    path = _write(tmp_path / "drums.wav", np.stack([tone, tone]))
    model = _FakeBeatModel()

    with separation.separate(
        path, threads=1, scratch=scratch, graph=_gain_graph((1.0, 0.0, 0.0, 0.0))
    ) as stems:
        beats = separation.drum_beats(stems, model=model)
        analysis = separation.analyze_stems(stems, drum_beats_ms=beats)

    assert beats == [500, 1000, 1500, 2000]
    assert analysis.drum_beats_ms == (500, 1000, 1500, 2000)
    ((signal, sample_rate),) = model.calls
    assert sample_rate == 22_050
    assert signal.ndim == 1 and abs(signal.size - seconds * 22_050) <= 1
    assert np.abs(signal).max() == pytest.approx(0.4, abs=0.02)


def test_drum_beats_are_empty_without_a_beat_model(
    tmp_path: Path, scratch: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tone = 0.4 * np.sin(2 * np.pi * 100 * np.arange(2 * RATE) / RATE)
    path = _write(tmp_path / "drums.wav", np.stack([tone, tone]))
    monkeypatch.setattr("crate.smart_mix.beat_model.load_beat_model", lambda: None)

    with separation.separate(
        path, threads=1, scratch=scratch, graph=_gain_graph((1.0,) * 4)
    ) as stems:
        assert separation.drum_beats(stems) == []


def test_scratch_lives_in_the_configured_stems_directory_on_the_music_volume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    library = tmp_path / "music"
    stems = tmp_path / "smart-mix-stems"
    library.mkdir()
    stems.mkdir()

    monkeypatch.delenv("CRATE_STEMS_DIR", raising=False)
    with pytest.raises(StemsVolumeError, match="CRATE_STEMS_DIR"):
        scratch_directory(library)

    monkeypatch.setenv("CRATE_STEMS_DIR", "relative/stems")
    with pytest.raises(StemsVolumeError, match="absolute"):
        scratch_directory(library)

    monkeypatch.setenv("CRATE_STEMS_DIR", str(stems))
    assert scratch_directory(library) == stems / ".scratch"
    assert (stems / ".scratch").is_dir()


def test_scratch_is_refused_off_the_music_volume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = Path("/dev/shm")
    if not other.is_dir() or os.stat(other).st_dev == os.stat(tmp_path).st_dev:
        pytest.skip("no second filesystem to compare against")
    library = tmp_path / "music"
    library.mkdir()
    monkeypatch.setenv("CRATE_STEMS_DIR", str(other))

    with pytest.raises(StemsVolumeError, match="music volume"):
        scratch_directory(library)
