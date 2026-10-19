from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile

import capture_analysis
from generate_fixtures import FIXTURES, SAMPLE_RATE, render

RATE = SAMPLE_RATE
PRE_S = 10
MIX_S = 12


def _deck(fixture_index: int, offset_ms: float, length_s: float) -> np.ndarray:
    audio = render(FIXTURES[fixture_index])
    shift = int(round(offset_ms * RATE / 1000))
    audio = np.roll(audio, shift, axis=0)
    return audio[: int(length_s * RATE)]


def _write_capture(
    tmp_path: Path,
    *,
    offset_ms: float = 0.0,
    gain: float = 1.0,
    incoming_bass_cut: bool = False,
    dropped: int = 0,
    markers: bool = True,
    silent: bool = False,
) -> Path:
    total_s = PRE_S + MIX_S + 4
    frames = total_s * RATE
    outgoing = _deck(0, 0.0, total_s) * 0.7
    incoming = _deck(0, offset_ms, total_s) * 0.7
    start, end = PRE_S * RATE, (PRE_S + MIX_S) * RATE
    progress = np.clip((np.arange(frames) - start) / (end - start), 0.0, 1.0)[:, None]
    outgoing *= np.cos(progress * np.pi / 2)
    incoming *= np.sin(progress * np.pi / 2)
    incoming[:start] = 0.0
    if incoming_bass_cut:
        from scipy import signal

        sos = signal.butter(4, 150, "highpass", fs=RATE, output="sos")
        early = slice(start, start + (end - start) // 2)
        incoming[early] = signal.sosfilt(sos, incoming[early], axis=0)
    mix = (outgoing + incoming) * gain
    if silent:
        mix[:] = outgoing[:] = incoming[:] = 0.0
    capture = np.concatenate([mix, outgoing, incoming], axis=1)
    pcm = np.clip(np.round(capture * 32767), -32767, 32767).astype(np.int16)
    path = tmp_path / "capture.wav"
    soundfile.write(path, pcm, RATE, subtype="PCM_16")
    summary = {
        "frames": frames,
        "droppedFrames": dropped,
        "underruns": 0,
        "markers": (
            [
                f"{start}:start a>b mode=BEATMATCH engaged=true bass=balanced",
                f"{end}:completed",
            ]
            if markers
            else []
        ),
    }
    path.with_suffix(".json").write_text(json.dumps(summary))
    return path


def _analyze(path: Path) -> dict:
    return capture_analysis.analyze(capture_analysis.load_capture(path))


@pytest.mark.parametrize("offset_ms", [0.0, 8.0, 15.0, -25.0])
def test_recovers_an_injected_phase_offset(tmp_path: Path, offset_ms: float) -> None:
    result = _analyze(_write_capture(tmp_path, offset_ms=offset_ms))

    [transition] = result["transitions"]
    assert transition["phase"]["beatPeriodMs"] == pytest.approx(500.0, abs=1.0)
    assert transition["phase"]["p50Ms"] == pytest.approx(abs(offset_ms), abs=2.0)


def test_an_aligned_mix_passes_every_gate(tmp_path: Path) -> None:
    result = _analyze(_write_capture(tmp_path))

    assert result["gates"] == {
        "clipping": True,
        "truePeak": True,
        "captureIntact": True,
        "signal": True,
        "phaseP95": True,
    }
    assert result["passed"] is True


def test_a_late_incoming_deck_fails_the_phase_gate(tmp_path: Path) -> None:
    result = _analyze(_write_capture(tmp_path, offset_ms=40.0))

    assert result["gates"]["phaseP95"] is False
    assert result["passed"] is False


def test_detects_clipping_and_true_peak_inside_the_mix(tmp_path: Path) -> None:
    result = _analyze(_write_capture(tmp_path, gain=2.5))

    [transition] = result["transitions"]
    assert transition["clippedSamples"] > 0
    assert result["gates"]["clipping"] is False
    assert result["gates"]["truePeak"] is False


def test_a_silent_capture_never_passes(tmp_path: Path) -> None:
    result = _analyze(_write_capture(tmp_path, silent=True))

    assert result["status"] == "insufficient_signal"
    assert result["passed"] is False


def test_a_capture_without_transitions_never_passes(tmp_path: Path) -> None:
    result = _analyze(_write_capture(tmp_path, markers=False))

    assert result["status"] == "no_transitions"
    assert result["passed"] is False


def test_dropped_capture_frames_fail_the_capture(tmp_path: Path) -> None:
    result = _analyze(_write_capture(tmp_path, dropped=480))

    assert result["gates"]["captureIntact"] is False


def test_measures_the_incoming_bass_coming_back(tmp_path: Path) -> None:
    with_cut = _analyze(_write_capture(tmp_path, incoming_bass_cut=True))
    without_cut = _analyze(_write_capture(tmp_path))

    lift = with_cut["transitions"][0]["bassShareDb"]
    flat = without_cut["transitions"][0]["bassShareDb"]
    assert lift["incomingLate"] - lift["incomingEarly"] > 4.0
    assert abs(flat["incomingLate"] - flat["incomingEarly"]) < 2.0


def test_the_capture_must_have_six_channels(tmp_path: Path) -> None:
    path = tmp_path / "stereo.wav"
    soundfile.write(path, np.zeros((RATE, 2), dtype=np.int16), RATE)

    with pytest.raises(ValueError):
        capture_analysis.load_capture(path)
