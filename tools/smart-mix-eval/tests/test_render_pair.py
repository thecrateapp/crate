from __future__ import annotations

import os
import shutil
import wave
from pathlib import Path

import numpy as np
import pytest

from render_pair import build_filtergraph, plan_from_dict, render_pair, render_window
from crate.smart_mix.models import TransitionPlan

SAMPLE_RATE = 22_050
OUT_UID = "00000000-0000-4000-8000-000000000001"
IN_UID = "00000000-0000-4000-8000-000000000002"


def _ffmpeg() -> str:
    binary = shutil.which("ffmpeg")
    if binary:
        return binary
    if os.environ.get("CRATE_REQUIRE_FFMPEG") == "1":
        pytest.fail("ffmpeg is required for the render tests but was not found")
    pytest.skip("ffmpeg is not installed")


def _plan(**overrides) -> TransitionPlan:
    values = {
        "planner_version": 2,
        "outgoing_track_entity_uid": OUT_UID,
        "incoming_track_entity_uid": IN_UID,
        "mode": "beatmatch",
        "duration_ms": 8_000,
        "outgoing_cue_ms": 60_000,
        "incoming_cue_ms": 20_000,
        "incoming_tempo_ratio": 1.04,
        "beat_phase_offset_ms": 100,
        "handoff_progress": 0.5,
        "outgoing_gain_db": 0.0,
        "incoming_gain_db": 0.0,
        "curve": "equal-power",
        "bass_handoff": "none",
        "confidence": 0.9,
    }
    values.update(overrides)
    return TransitionPlan(**values)


def _write_tone(
    path: Path,
    *,
    seconds: float,
    tone_hz: float,
    pips: tuple[tuple[float, float], ...] = (),
    amplitude: float = 0.2,
) -> None:
    """A steady tone with short marker pips (frequency, centre in seconds)."""
    time = np.arange(round(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    audio = amplitude * np.sin(2 * np.pi * tone_hz * time)
    pip_samples = round(0.02 * SAMPLE_RATE)
    window = np.hanning(pip_samples)
    for frequency, centre in pips:
        start = round(centre * SAMPLE_RATE) - pip_samples // 2
        pip_time = np.arange(pip_samples) / SAMPLE_RATE
        audio[start : start + pip_samples] += (
            0.5 * window * np.sin(2 * np.pi * frequency * pip_time)
        )
    pcm = np.clip(audio, -1.0, 1.0)
    stereo = np.repeat((pcm * 32_767).astype("<i2")[:, None], 2, axis=1)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(stereo.tobytes())


def _read_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2")
    audio = frames.reshape(-1, channels).astype(np.float64).mean(axis=1) / 32_768
    return audio, rate


def _band(audio: np.ndarray, rate: int, low_hz: float, high_hz: float) -> np.ndarray:
    spectrum = np.fft.rfft(audio)
    frequencies = np.fft.rfftfreq(audio.size, 1 / rate)
    spectrum[(frequencies < low_hz) | (frequencies > high_hz)] = 0
    return np.fft.irfft(spectrum, audio.size)


def _peak_seconds(audio: np.ndarray, rate: int, frequency: float) -> float:
    band = np.abs(_band(audio, rate, frequency - 250, frequency + 250))
    smoothed = np.convolve(band, np.ones(64) / 64, mode="same")
    return float(np.argmax(smoothed)) / rate


def _rms(
    audio: np.ndarray,
    rate: int,
    start: float,
    end: float,
    hz: float,
    width_hz: float = 40.0,
) -> float:
    band = _band(audio, rate, hz - width_hz, hz + width_hz)
    segment = band[round(start * rate) : round(end * rate)]
    return float(np.sqrt(np.mean(segment**2)))


def test_plan_from_dict_reads_the_api_and_report_forms() -> None:
    plan = _plan(fallback_reason=None)

    assert plan_from_dict(plan.to_dict()) == plan
    assert plan_from_dict({"edgeId": "e0001", "plan": plan.to_dict()}) == plan


def test_render_window_keeps_30_to_60_seconds() -> None:
    gapless = render_window(_plan(mode="gapless", duration_ms=0))
    short = render_window(_plan(duration_ms=12_000))
    long = render_window(_plan(duration_ms=48_000, curve="dj-blend"))
    early = render_window(_plan(outgoing_cue_ms=4_000))
    requested = render_window(_plan(), seconds=40)

    assert (gapless.total_ms, gapless.pre_ms) == (30_000, 15_000)
    assert (short.total_ms, short.pre_ms, short.post_ms) == (36_000, 12_000, 12_000)
    assert (long.total_ms, long.pre_ms, long.post_ms) == (60_000, 6_000, 6_000)
    assert (early.pre_ms, early.post_ms) == (4_000, 20_000)
    assert early.outgoing_start_ms == 0
    assert requested.total_ms == 40_000


def test_filtergraph_applies_bass_handoff_only_in_beatmatch() -> None:
    handoff = build_filtergraph(
        _plan(bass_handoff="balanced"), render_window(_plan()), SAMPLE_RATE
    )
    adaptive = build_filtergraph(
        _plan(mode="adaptive", bass_handoff="balanced", incoming_tempo_ratio=1.0),
        render_window(_plan()),
        SAMPLE_RATE,
    )

    assert "lowshelf" in handoff.graph and handoff.commands
    assert "atempo=1.04" in handoff.graph
    assert "lowshelf" not in adaptive.graph and not adaptive.commands
    assert "atempo" not in adaptive.graph


def test_render_respects_cues_and_duration(tmp_path: Path) -> None:
    ffmpeg = _ffmpeg()
    plan = _plan()
    outgoing = tmp_path / "outgoing.wav"
    incoming = tmp_path / "incoming.wav"
    # Outgoing pip at its cue (60 s). Incoming starts at 20 s + 100 ms x 1.04
    # and its pip sits 4.16 s of media later, 4 s of wall time at 1.04.
    _write_tone(outgoing, seconds=90, tone_hz=220, pips=((2_000, 60.0),))
    _write_tone(incoming, seconds=60, tone_hz=330, pips=((3_000, 24.264),))

    result = render_pair(
        plan,
        outgoing,
        incoming,
        tmp_path / "pair.wav",
        seconds=30,
        sample_rate=SAMPLE_RATE,
        ffmpeg=ffmpeg,
    )
    audio, rate = _read_mono(tmp_path / "pair.wav")

    assert rate == SAMPLE_RATE
    assert result.duration_ms == 30_000
    assert audio.size == 30 * SAMPLE_RATE
    assert (result.transition_start_ms, result.transition_end_ms) == (11_000, 19_000)
    assert _peak_seconds(audio, rate, 2_000) == pytest.approx(11.0, abs=0.015)
    assert _peak_seconds(audio, rate, 3_000) == pytest.approx(15.0, abs=0.025)
    outgoing_only = _rms(audio, rate, 1.0, 10.5, 330)
    incoming_only = _rms(audio, rate, 19.5, 29.0, 220)
    assert outgoing_only < 0.003 and incoming_only < 0.003
    assert _rms(audio, rate, 1.0, 10.5, 220) > 0.1
    assert _rms(audio, rate, 19.5, 29.0, 330) > 0.1
    # Equal power midpoint: both tones at about 0.707 of their level.
    assert _rms(audio, rate, 14.8, 15.2, 220) == pytest.approx(
        0.2 / np.sqrt(2) * np.sqrt(0.5), rel=0.15
    )
    assert _rms(audio, rate, 14.8, 15.2, 330) == pytest.approx(
        0.2 / np.sqrt(2) * np.sqrt(0.5), rel=0.15
    )


def test_render_bass_handoff_cuts_the_incoming_low_end(tmp_path: Path) -> None:
    ffmpeg = _ffmpeg()
    plan = _plan(
        bass_handoff="balanced",
        incoming_tempo_ratio=1.0,
        beat_phase_offset_ms=0,
        duration_ms=16_000,
        curve="dj-blend",
    )
    outgoing = tmp_path / "outgoing.wav"
    incoming = tmp_path / "incoming.wav"
    _write_tone(outgoing, seconds=90, tone_hz=60)
    _write_tone(incoming, seconds=60, tone_hz=50)

    result = render_pair(
        plan,
        outgoing,
        incoming,
        tmp_path / "pair.wav",
        seconds=40,
        sample_rate=SAMPLE_RATE,
        ffmpeg=ffmpeg,
    )
    audio, rate = _read_mono(tmp_path / "pair.wav")
    start = result.transition_start_ms / 1000
    # DJ blend holds both decks at -3 dB from 30 % to 70 %; the bass swaps
    # around 50 % (43.75 %-56.25 %).
    before = (start + 0.32 * 16, start + 0.42 * 16)
    after = (start + 0.58 * 16, start + 0.68 * 16)

    incoming_cut = _rms(audio, rate, *before, 50, 4) / _rms(audio, rate, *after, 50, 4)
    outgoing_cut = _rms(audio, rate, *after, 60, 4) / _rms(audio, rate, *before, 60, 4)

    assert 20 * np.log10(incoming_cut) < -18
    assert 20 * np.log10(outgoing_cut) < -18
