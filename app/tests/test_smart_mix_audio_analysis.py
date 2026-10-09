from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile


SAMPLE_RATE = 11_025


def _write_click_track(
    path: Path,
    *,
    bpm: float,
    duration_seconds: float,
    leading_silence_seconds: float = 0.0,
    trailing_silence_seconds: float = 0.0,
    accent_downbeats: bool = True,
    end_bpm: float | None = None,
    outro_gain: float = 1.0,
) -> None:
    sample_count = round(duration_seconds * SAMPLE_RATE)
    audio = np.zeros(sample_count, dtype=np.float32)
    body_end = duration_seconds - trailing_silence_seconds
    beat_time = leading_silence_seconds
    beat_index = 0
    pulse_length = max(1, round(0.025 * SAMPLE_RATE))
    pulse_shape = np.exp(-np.linspace(0.0, 7.0, pulse_length)).astype(np.float32)

    while beat_time < body_end:
        progress = beat_time / max(duration_seconds, 0.001)
        current_bpm = bpm + ((end_bpm or bpm) - bpm) * progress
        amplitude = 1.0 if accent_downbeats and beat_index % 4 == 0 else 0.35
        if beat_time >= duration_seconds - 5.0:
            amplitude *= outro_gain
        start = round(beat_time * SAMPLE_RATE)
        end = min(sample_count, start + pulse_length)
        audio[start:end] += amplitude * pulse_shape[: end - start]
        beat_time += 60.0 / current_bpm
        beat_index += 1

    peak = float(np.max(np.abs(audio)))
    if peak > 0:
        audio = 0.9 * audio / peak
    wavfile.write(path, SAMPLE_RATE, (audio * 32767).astype(np.int16))


def _write_a_minor_chord(path: Path, *, duration_seconds: float = 8.0) -> None:
    time = np.arange(round(duration_seconds * SAMPLE_RATE)) / SAMPLE_RATE
    audio = sum(
        np.sin(2 * np.pi * frequency * time)
        for frequency in (220.0, 261.6256, 329.6276)
    )
    audio = (0.8 * audio / np.max(np.abs(audio))).astype(np.float32)
    wavfile.write(path, SAMPLE_RATE, (audio * 32767).astype(np.int16))


def test_analyze_mix_profile_extracts_stable_beats_and_downbeat(
    tmp_path: Path,
) -> None:
    track = tmp_path / "stable-120.wav"
    _write_click_track(
        track,
        bpm=120.0,
        duration_seconds=20.0,
        accent_downbeats=True,
    )

    from crate.smart_mix.analyzer import analyze_mix_profile

    profile = analyze_mix_profile(track)

    assert profile.quality == "full"
    assert profile.bpm == pytest.approx(120.0, abs=3.0)
    assert profile.bpm_confidence >= 0.75
    assert profile.tempo_stability >= 0.8
    assert len(profile.beat_grid_ms) >= 30
    assert all(
        current > previous
        for previous, current in zip(
            profile.beat_grid_ms,
            profile.beat_grid_ms[1:],
            strict=False,
        )
    )
    assert profile.downbeat_anchor_ms is not None
    assert profile.time_signature == 4


def test_analyze_mix_profile_marks_drifting_tempo_as_unstable(
    tmp_path: Path,
) -> None:
    track = tmp_path / "drifting.wav"
    _write_click_track(
        track,
        bpm=120.0,
        end_bpm=132.0,
        duration_seconds=24.0,
    )

    from crate.smart_mix.analyzer import analyze_mix_profile

    profile = analyze_mix_profile(track)

    assert profile.tempo_stability < 0.8
    assert profile.quality == "partial"


def test_analyze_mix_profile_cues_and_windows_avoid_boundary_silence(
    tmp_path: Path,
) -> None:
    track = tmp_path / "shaped.wav"
    _write_click_track(
        track,
        bpm=128.0,
        duration_seconds=24.0,
        leading_silence_seconds=2.0,
        trailing_silence_seconds=2.0,
        outro_gain=2.5,
    )

    from crate.smart_mix.analyzer import analyze_mix_profile

    profile = analyze_mix_profile(track)

    assert profile.intro_cue_ms is not None
    assert profile.outro_cue_ms is not None
    assert profile.intro_cue_ms >= 1_500
    assert 10_000 < profile.outro_cue_ms < 22_000
    assert profile.intro_energy is not None
    assert profile.outro_energy is not None
    assert profile.outro_energy > profile.intro_energy
    assert profile.active_start_ms is not None and profile.active_start_ms >= 1_500
    assert profile.active_end_ms is not None and profile.active_end_ms <= 22_500


def test_python_fallback_never_publishes_unmeasured_loudness(tmp_path: Path) -> None:
    track = tmp_path / "fallback-loudness.wav"
    _write_click_track(
        track,
        bpm=128.0,
        duration_seconds=24.0,
        leading_silence_seconds=2.0,
        trailing_silence_seconds=2.0,
        outro_gain=2.5,
    )

    from crate.smart_mix.analyzer import analyze_mix_profile
    from crate.smart_mix.versions import ANALYZER_VERSION

    profile = analyze_mix_profile(track)

    assert profile.analyzer_version == ANALYZER_VERSION == "smart-mix-audio-v2"
    assert profile.intro_lufs is None
    assert profile.outro_lufs is None
    assert profile.integrated_lufs is None
    assert profile.true_peak_dbfs is None
    assert profile.measurement_version is None


def test_analyze_mix_profile_retains_key_confidence(tmp_path: Path) -> None:
    track = tmp_path / "a-minor.wav"
    _write_a_minor_chord(track)

    from crate.smart_mix.analyzer import analyze_mix_profile

    profile = analyze_mix_profile(track)

    assert profile.key is not None
    assert profile.scale in {"major", "minor"}
    assert profile.camelot is not None
    assert profile.key_confidence is not None
    assert 0.0 <= profile.key_confidence <= 1.0


def test_analyze_mix_profile_reads_the_outro_beyond_legacy_window(
    tmp_path: Path,
) -> None:
    track = tmp_path / "long-outro.wav"
    _write_click_track(
        track,
        bpm=120.0,
        duration_seconds=126.0,
        trailing_silence_seconds=1.0,
        outro_gain=3.0,
    )

    from crate.smart_mix.analyzer import analyze_mix_profile

    profile = analyze_mix_profile(track)

    assert profile.duration_ms == pytest.approx(126_000, abs=100)
    assert profile.outro_cue_ms is not None
    assert profile.outro_cue_ms > 120_000
    assert profile.outro_energy is not None
    assert profile.intro_energy is not None
    assert profile.outro_energy > profile.intro_energy


def test_analyze_mix_profile_degrades_noise_without_reliable_downbeat(
    tmp_path: Path,
) -> None:
    track = tmp_path / "noise.wav"
    rng = np.random.default_rng(42)
    audio = rng.normal(0.0, 0.05, round(10.0 * SAMPLE_RATE))
    wavfile.write(track, SAMPLE_RATE, (audio * 32767).astype(np.int16))

    from crate.smart_mix.analyzer import analyze_mix_profile

    profile = analyze_mix_profile(track)

    assert profile.quality == "partial"
    assert profile.downbeat_anchor_ms is None
    assert profile.time_signature is None


def test_backfill_analysis_prefers_the_rust_profile(
    monkeypatch, tmp_path: Path
) -> None:
    import crate.audio_analysis as audio_analysis

    monkeypatch.setattr(
        audio_analysis,
        "_analyze_rust",
        lambda _path: {
            "mix_profile": {
                "analyzer": "crate-rust",
                "analyzerVersion": "smart-mix-audio-v2",
                "durationMs": 180_000,
                "quality": "full",
                "measurementVersion": "bs1770-v1",
                "integratedLufs": -9.0,
            }
        },
    )

    draft = audio_analysis.analyze_mix_profile(tmp_path / "track.flac")

    assert draft.analyzer == "crate-rust"
    assert draft.measurement_version == "bs1770-v1"
    assert draft.integrated_lufs == -9.0


def test_backfill_analysis_falls_back_to_python_without_crate_cli(
    monkeypatch, tmp_path: Path
) -> None:
    import crate.audio_analysis as audio_analysis

    track = tmp_path / "fallback.wav"
    _write_click_track(
        track,
        bpm=120.0,
        duration_seconds=12.0,
        leading_silence_seconds=0.0,
        trailing_silence_seconds=0.0,
    )
    monkeypatch.setattr(audio_analysis, "_analyze_rust", lambda _path: None)

    draft = audio_analysis.analyze_mix_profile(track)

    assert draft.analyzer == "crate-python"


def test_long_tracks_are_analysed_from_a_bounded_head_and_tail(
    monkeypatch, tmp_path: Path
) -> None:
    from crate.smart_mix import analyzer

    monkeypatch.setattr(analyzer, "FULL_SCAN_HEAD_SECONDS", 10)
    monkeypatch.setattr(analyzer, "FULL_SCAN_TAIL_SECONDS", 10)
    track = tmp_path / "long.wav"
    _write_click_track(
        track,
        bpm=124.0,
        duration_seconds=40.0,
        trailing_silence_seconds=3.0,
    )
    loaded_sizes: list[int] = []
    original_resample = analyzer._to_analysis_rate

    def record(audio, sample_rate):
        loaded_sizes.append(audio.size)
        return original_resample(audio, sample_rate)

    monkeypatch.setattr(analyzer, "_to_analysis_rate", record)

    profile = analyzer.analyze_mix_profile(track)

    assert profile.duration_ms == 40_000
    assert profile.quality == "partial"
    assert max(loaded_sizes) <= 10 * SAMPLE_RATE
    assert all(position <= 10_000 for position in profile.beat_grid_ms)
    assert profile.active_end_ms is not None
    assert 36_000 <= profile.active_end_ms <= 37_500
    assert profile.outro_cue_ms is not None and profile.outro_cue_ms > 30_000


def test_short_tracks_are_still_scanned_in_full(monkeypatch, tmp_path: Path) -> None:
    from crate.smart_mix import analyzer

    monkeypatch.setattr(analyzer, "FULL_SCAN_HEAD_SECONDS", 10)
    monkeypatch.setattr(analyzer, "FULL_SCAN_TAIL_SECONDS", 10)
    track = tmp_path / "short.wav"
    _write_click_track(track, bpm=124.0, duration_seconds=15.0)

    profile = analyzer.analyze_mix_profile(track)

    assert profile.duration_ms == 15_000
    assert profile.quality == "full"
    assert max(profile.beat_grid_ms) > 10_000
