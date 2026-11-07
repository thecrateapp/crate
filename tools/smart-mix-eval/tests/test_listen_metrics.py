"""Automatic listening metrics of rendered transitions (Smart Mix 3, SM5)."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import numpy as np
import pytest

from listen_metrics import (
    LOWER_IS_BETTER,
    PlanSelector,
    beat_agreement,
    compare_variants,
    full_level_mask,
    ibi_cv,
    loudness_jumps,
    measure_plan,
    parse_ebur128,
    parse_selector,
    plan_key,
    summarize_variant,
    voice_on_voice_ms,
)
from crate.smart_mix.models import TransitionPlan
from crate.smart_mix.vocals import VOCAL_THRESHOLD

OUT_UID = "00000000-0000-4000-8000-000000000001"
IN_UID = "00000000-0000-4000-8000-000000000002"


def _plan(**overrides) -> TransitionPlan:
    values = {
        "planner_version": 3,
        "outgoing_track_entity_uid": OUT_UID,
        "incoming_track_entity_uid": IN_UID,
        "mode": "beatmatch",
        "duration_ms": 12_000,
        "outgoing_cue_ms": 60_000,
        "incoming_cue_ms": 20_000,
        "incoming_tempo_ratio": 1.0,
        "beat_phase_offset_ms": 0,
        "handoff_progress": 0.5,
        "outgoing_gain_db": 0.0,
        "incoming_gain_db": 0.0,
        "curve": "equal-power",
        "bass_handoff": "none",
        "confidence": 0.9,
    }
    values.update(overrides)
    return TransitionPlan(**values)


def test_full_level_mask_is_the_middle_third_of_an_equal_power_mix() -> None:
    mask = full_level_mask(_plan(), start_ms=10_000, total_ms=40_000, step_ms=10)
    assert mask.size == 4_000
    covered = np.flatnonzero(mask) * 10
    # Equal power keeps both decks at half amplitude or more from 1/3 to 2/3.
    assert covered[0] == pytest.approx(14_000, abs=20)
    assert covered[-1] == pytest.approx(18_000, abs=20)
    crossfade = full_level_mask(
        _plan(mode="adaptive", curve="dj-blend"), start_ms=10_000, total_ms=40_000
    )
    # Outside beatmatch the engines use equal power whatever the plan says.
    assert crossfade.sum() == mask.sum()


def test_beat_agreement_measures_phase_in_the_overlap() -> None:
    beats = list(range(0, 40_000, 500))
    full = np.zeros(4_000, dtype=bool)
    full[1_400:1_800] = True  # 14-18 s

    locked = beat_agreement(
        beats, [b + 10 for b in beats], overlap=(10_000, 22_000), full_level=full
    )
    assert locked["comparedBeats"] == 24
    assert locked["phaseErrorMsMedian"] == pytest.approx(10)
    assert locked["lockedShare"] == 1.0
    assert locked["beatClashMs"] == 0

    # Half a beat apart: a trainwreck through the whole full-level window.
    off = beat_agreement(
        beats, [b + 250 for b in beats], overlap=(10_000, 22_000), full_level=full
    )
    assert off["phaseErrorMsMedian"] == pytest.approx(250)
    assert off["phaseErrorBeatMedian"] == pytest.approx(0.5)
    assert off["lockedShare"] == 0.0
    assert off["beatClashMs"] == pytest.approx(4_000, abs=10)

    # Double time on the incoming deck still lines up with every outgoing beat.
    double = beat_agreement(
        beats, list(range(5, 40_000, 250)), overlap=(10_000, 22_000), full_level=full
    )
    assert double["lockedShare"] == 1.0

    # No incoming beat near an outgoing one (a beatless intro): nothing to compare.
    empty = beat_agreement(beats, [], overlap=(10_000, 22_000), full_level=full)
    assert empty["comparedBeats"] == 0
    assert empty["phaseErrorMsMedian"] is None
    assert empty["beatClashMs"] == 0


def test_ibi_cv_grows_with_irregular_beats() -> None:
    regular = list(range(0, 20_000, 500))
    flam = sorted([*regular, *[b + 60 for b in regular[10:20]]])
    assert ibi_cv(regular, 2_000, 15_000) == pytest.approx(0.0)
    assert ibi_cv(flam, 2_000, 15_000) > 0.3
    assert ibi_cv(regular[:2], 0, 20_000) is None


def test_voice_on_voice_counts_full_level_time_with_voice_on_both_decks() -> None:
    centres = np.arange(0, 40_000, 480) + 488
    voiced = np.full(centres.size, VOCAL_THRESHOLD + 10, dtype=np.uint8)
    silent = np.zeros(centres.size, dtype=np.uint8)
    half = silent.copy()
    half[centres >= 16_000] = VOCAL_THRESHOLD
    full = np.zeros(4_000, dtype=bool)
    full[1_400:1_800] = True

    assert voice_on_voice_ms((centres, voiced), (centres, voiced), full) == 4_000
    assert voice_on_voice_ms((centres, voiced), (centres, silent), full) == 0
    assert voice_on_voice_ms((centres, voiced), (centres, half), full) == pytest.approx(
        2_000, abs=250
    )


EBUR128_LOG = """\
[Parsed_ebur128_0 @ 0x55] Summary:
[Parsed_ebur128_0 @ 0x55] t: 0.1       TARGET:-23 LUFS    M: -120.7 S: -120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x55] t: 0.2       TARGET:-23 LUFS    M:  -10.5 S:  -11.0     I: -10.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x55] t: 0.3       TARGET:-23 LUFS    M:   -9.5 S:   -10.0     I: -10.0 LUFS       LRA:   0.0 LU
"""


def test_parse_ebur128_reads_momentary_and_short_term() -> None:
    times, momentary, short_term = parse_ebur128(EBUR128_LOG)
    assert times.tolist() == [100, 200, 300]
    assert momentary.tolist() == [-120.7, -10.5, -9.5]
    assert short_term.tolist() == [-120.7, -11.0, -10.0]


def test_loudness_jumps_find_steps_bumps_and_dips() -> None:
    times = np.arange(0, 40_000, 100)
    # -10 LUFS before the mix (10-22 s), -14 after, a 3 LU bump at 15-16 s.
    short_term = np.where(times < 16_000, -10.0, -14.0)
    momentary = short_term.copy()
    momentary[(times >= 15_000) & (times < 16_000)] = -7.0
    momentary[(times >= 19_000) & (times < 19_500)] = -20.0

    jumps = loudness_jumps(times, momentary, short_term, start_ms=10_000, end_ms=22_000)

    assert jumps["preShortTermLufs"] == pytest.approx(-10.0)
    assert jumps["postShortTermLufs"] == pytest.approx(-14.0)
    assert jumps["levelStepLu"] == pytest.approx(-4.0)
    assert jumps["bumpLu"] == pytest.approx(3.0)
    assert jumps["dipLu"] == pytest.approx(6.0)
    assert jumps["maxShortTermSlopeLuPerS"] == pytest.approx(4.0)


def test_parse_selector_and_plan_key() -> None:
    assert parse_selector("smart-mix-v3=out/r.json:deterministic") == PlanSelector(
        "smart-mix-v3", Path("out/r.json"), deterministic=True
    )
    assert parse_selector("ai=out/r.json") == PlanSelector("ai", Path("out/r.json"))
    with pytest.raises(ValueError):
        parse_selector("no-path")
    plan = _plan().to_dict()
    assert plan_key(plan) == plan_key(dict(plan))
    assert plan_key(plan) != plan_key({**plan, "durationMs": 8_000})


def test_summaries_and_paired_comparisons() -> None:
    edges = {
        "e1": {"tempoBand": "0-2", "mode": "beatmatch"},
        "e2": {"tempoBand": "2-4", "mode": "crossfade"},
    }
    base = {
        "e1": {"beatClashMs": 1_000.0, "lockedShare": 0.5, "bumpLu": 1.0},
        "e2": {"beatClashMs": 0.0, "lockedShare": None, "bumpLu": 2.0},
    }
    better = {
        "e1": {"beatClashMs": 0.0, "lockedShare": 1.0, "bumpLu": 1.0},
        "e2": {"beatClashMs": 0.0, "lockedShare": None, "bumpLu": 3.0},
    }

    summary = summarize_variant(base, edges)
    assert summary["overall"]["beatClashMs"]["mean"] == 500.0
    assert summary["overall"]["lockedShare"]["n"] == 1
    assert set(summary["byTempoBand"]) == {"0-2", "2-4"}
    assert summary["byMode"]["beatmatch"]["beatClashMs"]["mean"] == 1_000.0

    comparison = compare_variants(better, base, edges)
    assert comparison["pairedEdges"] == 2
    clash = comparison["overall"]["beatClashMs"]
    assert clash["meanDelta"] == -500.0
    assert (clash["better"], clash["same"], clash["worse"]) == (1, 1, 0)
    locked = comparison["overall"]["lockedShare"]
    assert (locked["better"], locked["same"], locked["worse"]) == (1, 0, 0)
    bump = comparison["overall"]["bumpLu"]
    assert (bump["better"], bump["same"], bump["worse"]) == (0, 1, 1)
    assert "lockedShare" not in LOWER_IS_BETTER


class FakeBeats:
    """Beats every 500 ms where the stem has signal, from a pip track."""

    tracker = "fake"

    def __call__(self, signal, sample_rate):
        envelope = np.abs(np.asarray(signal))
        seconds = envelope.size / sample_rate
        beats = [
            t
            for t in np.arange(0.25, seconds, 0.5)
            if envelope[int(t * sample_rate) : int((t + 0.05) * sample_rate)].max(
                initial=0
            )
            > 0.01
        ]
        return np.asarray(beats), np.asarray(beats[::4])


class FakeVoice:
    def voice_windows(self, waveform):
        from crate.smart_mix.voice_model import VoiceWindows

        patches = max(1, (len(waveform) - 15_600) // 7_680 + 1)
        return VoiceWindows(
            centres_ms=np.arange(patches) * 480 + 488,
            scores=np.full(patches, 0.5, dtype=np.float32),
        )


def _ffmpeg() -> str:
    binary = shutil.which("ffmpeg")
    if binary:
        return binary
    if os.environ.get("CRATE_REQUIRE_FFMPEG") == "1":
        pytest.fail("ffmpeg is required for the render tests but was not found")
    pytest.skip("ffmpeg is not installed")


def _write_clicks(
    path: Path, *, seconds: float, offset: float, rate: int = 22_050
) -> None:
    import wave

    audio = 0.05 * np.sin(2 * np.pi * 110 * np.arange(round(seconds * rate)) / rate)
    for beat in np.arange(offset, seconds, 0.5):
        start = round(beat * rate)
        audio[start : start + 200] += 0.5
    pcm = (np.clip(audio, -1, 1) * 32_767).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())


def test_measure_plan_renders_and_scores_one_transition(tmp_path: Path) -> None:
    ffmpeg = _ffmpeg()
    outgoing = tmp_path / "out.wav"
    incoming = tmp_path / "in.wav"
    _write_clicks(outgoing, seconds=90, offset=0.0)
    _write_clicks(incoming, seconds=60, offset=0.0)

    metrics = measure_plan(
        _plan(),
        outgoing,
        incoming,
        tmp_path / "work",
        beat_model=FakeBeats(),
        voice_model=FakeVoice(),
        ffmpeg=ffmpeg,
    )

    assert metrics["mode"] == "beatmatch"
    assert metrics["render"]["transitionStartMs"] == 12_000
    assert metrics["comparedBeats"] > 10
    assert metrics["lockedShare"] == 1.0
    assert metrics["voiceOnVoiceMs"] == pytest.approx(4_000, abs=500)
    assert metrics["levelStepLu"] == pytest.approx(0.0, abs=1.0)
    assert metrics["mixIbiCv"] is not None
    # The audio is deleted unless asked to keep it.
    assert not any((tmp_path / "work").glob("*.wav"))
    json.dumps(metrics)
