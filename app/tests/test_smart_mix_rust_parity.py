from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile
from tests.smart_mix_structure_audio import (
    DJ_KINDS,
    DJ_SECTIONS,
    write_structured_track,
)


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
    explicit = os.environ.get("CRATE_CLI_BINARY")
    candidates = (Path(explicit),) if explicit else CLI_CANDIDATES
    binary = next((candidate for candidate in candidates if candidate.is_file()), None)
    if binary is not None:
        return binary
    if os.environ.get("CRATE_REQUIRE_CRATE_CLI") == "1":
        pytest.fail("crate-cli is required for Rust parity but was not found")
    pytest.skip("crate-cli is not built; Rust parity runs in the crate-cli CI job")


def test_python_and_rust_mix_profiles_stay_within_tolerance(tmp_path: Path) -> None:
    track = tmp_path / "parity-120.wav"
    _write_click_track(
        track,
        bpm=120.0,
        duration_seconds=20.0,
        leading_silence_seconds=1.0,
        trailing_silence_seconds=1.0,
    )

    from crate.smart_mix.analyzer import analyze_mix_profile

    python_profile = analyze_mix_profile(track)
    rust_profile = _rust_profile(track)

    assert rust_profile["bpm"] == python_profile.bpm == 120.0
    assert abs(rust_profile["introCueMs"] - python_profile.intro_cue_ms) <= 550
    assert abs(rust_profile["outroCueMs"] - python_profile.outro_cue_ms) <= 550
    assert rust_profile["camelot"] == python_profile.camelot == "8A"
    assert rust_profile["quality"] == python_profile.quality
    assert 0.0 <= rust_profile["bpmConfidence"] <= 1.0
    assert 0.0 <= rust_profile["keyConfidence"] <= 1.0
    assert rust_profile["analyzerVersion"] == python_profile.analyzer_version
    assert rust_profile["measurementVersion"] == "bs1770-v1"
    assert rust_profile["integratedLufs"] is not None
    assert rust_profile["introLufs"] is not None
    assert rust_profile["outroLufs"] is not None
    assert rust_profile["truePeakDbfs"] <= 0.5
    assert python_profile.measurement_version is None


def test_python_and_rust_structure_stay_within_tolerance(tmp_path: Path) -> None:
    from crate.smart_mix.analyzer import analyze_mix_profile
    from crate.smart_mix.structure import downbeats_from_anchor

    track = tmp_path / "structure-120.wav"
    write_structured_track(track, DJ_SECTIONS)

    python_profile = analyze_mix_profile(track)
    rust_profile = _rust_profile(track)

    beat_ms = 60_000 / python_profile.bpm
    python_phrases = python_profile.phrases
    rust_phrases = rust_profile["phrases"]
    assert tuple(phrase["kind"] for phrase in rust_phrases) == DJ_KINDS
    assert [phrase.kind for phrase in python_phrases] == list(DJ_KINDS)
    assert [phrase["bars"] for phrase in rust_phrases] == [
        phrase.bars for phrase in python_phrases
    ]
    assert all(
        abs(rust["startMs"] - python.start_ms) <= beat_ms
        for rust, python in zip(rust_phrases, python_phrases, strict=True)
    )
    python_downbeats = downbeats_from_anchor(
        python_profile.beat_grid_ms, python_profile.downbeat_anchor_ms
    )
    rust_downbeats = downbeats_from_anchor(
        tuple(rust_profile["beatGridMs"]), rust_profile["downbeatAnchorMs"]
    )
    bar_ms = 4 * beat_ms
    shift = round((rust_downbeats[0] - python_downbeats[0]) / bar_ms)
    python_curve = python_profile.energy_curve
    rust_curve = rust_profile["energyCurve"]
    pairs = [
        (python_curve[bar + shift], value)
        for bar, value in enumerate(rust_curve)
        if 0 <= bar + shift < len(python_curve)
    ]
    assert len(pairs) >= min(len(python_curve), len(rust_curve)) - 1
    assert max(abs(python - rust) for python, rust in pairs) <= 2
    assert rust_profile["vocalPresence"] is None
    assert (
        abs(rust_profile["structureConfidence"] - python_profile.structure_confidence)
        <= 0.2
    )


def test_python_and_rust_take_the_same_model_beats(tmp_path: Path) -> None:
    # Beat This! gives both analyzers the same beats and downbeats (SM3-D14); the
    # clicks accent every fourth beat from 1 s, the model hears the bar two beats later.
    from crate.smart_mix.analyzer import analyze_mix_profile

    track = tmp_path / "model-120.wav"
    _write_click_track(
        track,
        bpm=120.0,
        duration_seconds=20.0,
        leading_silence_seconds=1.0,
        trailing_silence_seconds=1.0,
    )
    beats = _model_beats(range(1_000, 18_501, 500), phase=2)

    python_profile = analyze_mix_profile(track, beats=beats)
    rust_profile = _rust_profile(track, beats=beats)

    assert rust_profile["beatTracker"] == python_profile.beat_tracker
    assert python_profile.beat_tracker == "beat-this-test"
    assert rust_profile["bpm"] == python_profile.bpm == 120.0
    assert len(rust_profile["beatGridMs"]) == len(python_profile.beat_grid_ms)
    assert all(
        abs(rust - python) <= 1
        for rust, python in zip(
            rust_profile["beatGridMs"], python_profile.beat_grid_ms, strict=True
        )
    )
    assert rust_profile["downbeatAnchorMs"] == python_profile.downbeat_anchor_ms
    assert python_profile.downbeat_anchor_ms == 2_000


def test_python_and_rust_structure_agree_with_model_beats(tmp_path: Path) -> None:
    from crate.smart_mix.analyzer import analyze_mix_profile
    from tests.smart_mix_structure_audio import BEAT_MS, LEAD_SECONDS

    track = tmp_path / "structure-model-120.wav"
    write_structured_track(track, DJ_SECTIONS)
    first_ms = round(LEAD_SECONDS * 1_000)
    beat_count = 4 * sum(section.bars for section in DJ_SECTIONS)
    beats = _model_beats(
        range(first_ms, first_ms + beat_count * BEAT_MS, BEAT_MS), phase=0
    )

    python_profile = analyze_mix_profile(track, beats=beats)
    rust_profile = _rust_profile(track, beats=beats)

    assert rust_profile["downbeatAnchorMs"] == python_profile.downbeat_anchor_ms
    assert python_profile.downbeat_anchor_ms == first_ms
    rust_phrases = rust_profile["phrases"]
    assert tuple(phrase["kind"] for phrase in rust_phrases) == DJ_KINDS
    assert tuple(phrase.kind for phrase in python_profile.phrases) == DJ_KINDS
    assert [phrase["bars"] for phrase in rust_phrases] == [
        phrase.bars for phrase in python_profile.phrases
    ]
    assert all(
        abs(rust["startMs"] - python.start_ms) <= BEAT_MS
        for rust, python in zip(rust_phrases, python_profile.phrases, strict=True)
    )
    python_curve = python_profile.energy_curve
    rust_curve = rust_profile["energyCurve"]
    assert abs(len(python_curve) - len(rust_curve)) <= 1
    assert max(abs(a - b) for a, b in zip(python_curve, rust_curve)) <= 2


def _model_beats(beats_ms, *, phase: int):
    from crate.smart_mix.beat_model import BeatTrack

    beats = tuple(beats_ms)
    return BeatTrack(
        tracker="beat-this-test", beats_ms=beats, downbeats_ms=beats[phase::4]
    )


def _rust_profile(track: Path, *, beats=None) -> dict:
    args = [_crate_cli_binary(), "analyze", "--file", track]
    if beats is not None:
        beats_path = track.with_suffix(".beats.json")
        beats_path.write_text(json.dumps(beats.to_payload()))
        args += ["--beats", beats_path]
    result = subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return json.loads(result.stdout)["mixProfile"]


def test_missing_crate_cli_fails_when_ci_requires_it(
    monkeypatch, tmp_path: Path
) -> None:
    import tests.test_smart_mix_rust_parity as parity

    monkeypatch.setattr(parity, "CLI_CANDIDATES", (tmp_path / "missing",))
    monkeypatch.delenv("CRATE_CLI_BINARY", raising=False)
    monkeypatch.setenv("CRATE_REQUIRE_CRATE_CLI", "1")

    with pytest.raises(pytest.fail.Exception):
        parity._crate_cli_binary()


def test_explicit_crate_cli_binary_is_used(monkeypatch, tmp_path: Path) -> None:
    import tests.test_smart_mix_rust_parity as parity

    binary = tmp_path / "crate-cli"
    binary.write_text("")
    monkeypatch.setenv("CRATE_CLI_BINARY", str(binary))

    assert parity._crate_cli_binary() == binary
