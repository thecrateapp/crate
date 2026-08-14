from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile


ROOT = Path(__file__).resolve().parents[2]
CLI_CANDIDATES = (
    ROOT / "tools/crate-cli/target/debug/crate-cli",
    ROOT / "tools/crate-cli/target/release/crate-cli",
)
SAMPLE_RATE = 11_025


def _write_click_track(
    path: Path,
    *,
    bpm: float,
    duration_seconds: float,
    leading_silence_seconds: float,
    trailing_silence_seconds: float,
) -> None:
    audio = np.zeros(round(duration_seconds * SAMPLE_RATE), dtype=np.float32)
    body_start = round(leading_silence_seconds * SAMPLE_RATE)
    body_end = round((duration_seconds - trailing_silence_seconds) * SAMPLE_RATE)
    time = np.arange(body_end - body_start, dtype=np.float32) / SAMPLE_RATE
    for frequency in (220.0, 261.6256, 329.6276):
        audio[body_start:body_end] += 0.025 * np.sin(2.0 * np.pi * frequency * time)
    beat_time = leading_silence_seconds
    beat_index = 0
    beat_end = duration_seconds - trailing_silence_seconds
    pulse_length = round(0.025 * SAMPLE_RATE)
    pulse = np.exp(-np.linspace(0.0, 7.0, pulse_length))
    while beat_time < beat_end:
        start = round(beat_time * SAMPLE_RATE)
        end = min(audio.size, start + pulse_length)
        amplitude = 0.9 if beat_index % 4 == 0 else 0.35
        audio[start:end] += amplitude * pulse[: end - start]
        beat_time += 60.0 / bpm
        beat_index += 1
    wavfile.write(path, SAMPLE_RATE, (audio * 32767).astype(np.int16))


def _crate_cli_binary() -> Path:
    binary = next(
        (candidate for candidate in CLI_CANDIDATES if candidate.is_file()), None
    )
    if binary is None:
        pytest.skip("crate-cli is not built; Rust parity runs in the crate-cli CI job")
    return binary


def test_python_and_rust_mix_profiles_stay_within_tolerance(tmp_path: Path) -> None:
    track = tmp_path / "parity-120.wav"
    _write_click_track(
        track,
        bpm=120.0,
        duration_seconds=20.0,
        leading_silence_seconds=1.0,
        trailing_silence_seconds=1.0,
    )

    from crate.audio_analysis import analyze_mix_profile

    python_profile = analyze_mix_profile(track)
    result = subprocess.run(
        [_crate_cli_binary(), "analyze", "--file", track],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    rust_profile = json.loads(result.stdout)["mixProfile"]

    assert abs(rust_profile["bpm"] - python_profile.bpm) <= 1.0
    assert abs(rust_profile["introCueMs"] - python_profile.intro_cue_ms) <= 550
    assert abs(rust_profile["outroCueMs"] - python_profile.outro_cue_ms) <= 550
    assert rust_profile["camelot"] == python_profile.camelot
    assert rust_profile["quality"] == python_profile.quality
    assert 0.0 <= rust_profile["bpmConfidence"] <= 1.0
    assert 0.0 <= rust_profile["keyConfidence"] <= 1.0
