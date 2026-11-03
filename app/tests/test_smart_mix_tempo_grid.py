from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile


SAMPLE_RATE = 22_050
FRAME_MS = 256 * 1_000 / SAMPLE_RATE


def _lattice(bpm: float, count: int, offset: float) -> list[float]:
    return [offset + index * 60_000.0 / bpm for index in range(count)]


def _envelopes(duration_ms: float, broad, low) -> tuple[np.ndarray, np.ndarray]:
    frames = int(duration_ms / FRAME_MS) + 4
    onsets = np.full(frames, 0.05)
    low_onsets = np.full(frames, 0.05)
    for values, peaks in ((onsets, broad), (low_onsets, low)):
        for position, strength in peaks:
            frame = round(position / FRAME_MS)
            if frame < frames:
                values[frame] = max(values[frame], strength)
    return onsets, low_onsets


def _fit(beats, broad, low, duration_ms):
    from crate.smart_mix.tempo_grid import fit_tempo

    onsets, low_onsets = _envelopes(duration_ms, broad, low)
    return fit_tempo(
        [round(beat) for beat in beats], onsets, low_onsets, frame_ms=FRAME_MS
    )


def _wrap(value: float, period: float) -> float:
    return value - round(value / period) * period


def test_a_whole_tempo_snaps_and_keeps_the_beat_phase() -> None:
    jitter = np.random.default_rng(3).uniform(-15.0, 15.0, 300)
    beats = [time + offset for time, offset in zip(_lattice(128.0, 300, 230.0), jitter)]
    strong = [(time, 1.0) for time in beats]

    grid = _fit(beats, strong, strong, 150_000.0).grid

    assert grid.bpm == 128.0
    assert abs(_wrap(grid.anchor_ms - 230.0, grid.period_ms)) <= 3.0
    assert grid.phase_support > 0.95


def test_a_section_on_the_off_beat_does_not_move_the_tempo_or_the_phase() -> None:
    period = 60_000.0 / 128.0
    lattice = _lattice(128.0, 300, 100.0)
    beats = [
        time + period / 2 if 100 <= index < 160 else time
        for index, time in enumerate(lattice)
    ]
    kicks = [(time, 1.0) for time in lattice]

    grid = _fit(beats, kicks, kicks, 150_000.0).grid

    assert grid.bpm == 128.0
    assert abs(_wrap(grid.anchor_ms - 100.0, period)) <= 1.0
    assert grid.phase_support == pytest.approx(0.8, abs=0.01)


def test_onsets_overrule_beats_tracked_on_the_off_beat() -> None:
    period = 60_000.0 / 120.0
    beats = _lattice(120.0, 200, 250.0 + period / 2)
    kicks = [(time, 1.0) for time in _lattice(120.0, 200, 250.0)]
    weak = [(time, 0.4) for time in beats]

    grid = _fit(beats, kicks + weak, kicks, 110_000.0).grid

    assert grid.phase_flipped
    assert abs(_wrap(grid.anchor_ms - 250.0, period)) <= 1.0
    assert grid.phase_support == 0.0


def test_a_fractional_tempo_is_not_snapped() -> None:
    beats = _lattice(127.6, 400, 50.0)
    strong = [(time, 1.0) for time in beats]

    grid = _fit(beats, strong, strong, 200_000.0).grid

    assert grid.bpm == pytest.approx(127.6, abs=0.005)


def test_a_drifting_tempo_gets_no_constant_grid() -> None:
    beats, time = [], 0.0
    while time < 150_000.0:
        beats.append(time)
        time += 60_000.0 / (121.0 + 0.6 * time / 150_000.0)
    strong = [(time, 1.0) for time in beats]

    fit = _fit(beats, strong, strong, 150_000.0)

    assert fit.grid is None
    assert fit.bpm == pytest.approx(121.3, abs=0.3)


def test_two_tempos_get_no_constant_grid_even_where_they_alias() -> None:
    beats = _lattice(60.0, 60, 0.0) + _lattice(70.0, 70, 60_000.0)
    strong = [(time, 1.0) for time in beats]

    assert _fit(beats, strong, strong, 125_000.0).grid is None


def test_too_few_beats_fit_nothing() -> None:
    assert _fit(_lattice(120.0, 31, 0.0), [], [], 20_000.0) is None


def test_grid_beats_cover_the_requested_span_on_the_lattice() -> None:
    from crate.smart_mix.tempo_grid import ConstantGrid

    grid = ConstantGrid(
        bpm=120.0,
        period_ms=500.0,
        anchor_ms=1_250.0,
        phase_support=1.0,
        phase_flipped=False,
    )

    assert grid.beats_ms(-300.0, 1_900.0) == (250, 750, 1_250, 1_750)
    assert grid.beat_near_ms(2_010.0) == 2_250.0


def _sliding_take() -> list[float]:
    period = 60_000.0 / 87.0
    beats, time = [], 0.0
    for index in range(200):
        beats.append(time)
        wander = 1.0 + 0.01 * math.sin(index / 9.0)
        slide = {40: 1.26, 41: 1.24}.get(index, 0.875 if 120 <= index <= 123 else 1.0)
        time += period * wander * slide
    return beats


def test_half_beat_slides_are_counted() -> None:
    from crate.smart_mix.tempo_grid import half_beat_slides

    assert half_beat_slides([round(beat) for beat in _sliding_take()]) == 2


def test_a_steady_take_or_a_tempo_change_has_no_half_beat_slide() -> None:
    from crate.smart_mix.tempo_grid import half_beat_slides

    change = _lattice(120.0, 100, 0.0)
    change += _lattice(140.0, 100, change[-1] + 60_000.0 / 140.0)
    dropped = _lattice(128.0, 200, 0.0)
    del dropped[90]

    for beats in (_lattice(87.0, 200, 30.0), change, dropped):
        assert half_beat_slides([round(beat) for beat in beats]) == 0


def test_grid_constants_match_the_rust_analyzer() -> None:
    from crate.smart_mix import tempo_grid

    source = (
        Path(__file__).resolve().parents[2] / "tools/crate-cli/src/tempo_grid.rs"
    ).read_text()
    for name in (
        "MIN_BEATS",
        "SEARCH_SPAN",
        "MIN_COHERENCE",
        "BLOCK_BEATS",
        "BEAT_TOLERANCE_MS",
        "BLOCK_TOLERANCE_MS",
        "MIN_STEADY_BLOCKS",
        "SNAP_DRIFT_MS",
        "PHASE_FLIP_RATIO",
        "SLIDE_WINDOW_BEATS",
        "SLIDE_MIN_FRACTION",
        "SLIDE_CONTEXT_BEATS",
        "SLIDE_MAX_TEMPO_CHANGE",
    ):
        match = re.search(rf"const {name}: \w+ = ([0-9_.]+);", source)
        assert match is not None, name
        assert float(match.group(1).replace("_", "")) == getattr(tempo_grid, name), name


def _drum_loop(
    path: Path,
    bpm: float,
    seconds: float,
    offbeat_section=None,
    clap_gain: float = 0.45,
) -> None:
    """Kick with a click on every beat and a hi-hat on every off-beat; inside
    ``offbeat_section`` the kick stops and loud claps sit on the off-beats. Much louder
    claps make librosa trim every beat outside the break, which tests the tracker
    rather than the grid."""
    rng = np.random.default_rng(11)
    audio = np.zeros(round(seconds * SAMPLE_RATE))
    beat = 60.0 / bpm

    def in_break(time: float) -> bool:
        return (
            offbeat_section is not None
            and offbeat_section[0] <= time < offbeat_section[1]
        )

    kick_length = round(0.12 * SAMPLE_RATE)
    progress = np.arange(kick_length) / kick_length
    phase = np.cumsum(2 * np.pi * (90.0 - 40.0 * progress) / SAMPLE_RATE)
    kick = 0.8 * np.exp(-5.0 * progress) * np.sin(phase)
    kick[:40] += 0.4 * rng.uniform(-1.0, 1.0, 40)
    index = 0
    while index * beat < seconds:
        time = index * beat
        start = round(time * SAMPLE_RATE)
        if not in_break(time):
            end = min(audio.size, start + kick_length)
            audio[start:end] += kick[: end - start]
        offbeat = time + beat / 2
        amplitude, length = (clap_gain, 0.08) if in_break(offbeat) else (0.12, 0.03)
        length = round(length * SAMPLE_RATE)
        start = round(offbeat * SAMPLE_RATE)
        end = min(audio.size, start + length)
        envelope = np.exp(-6.0 * np.arange(end - start) / length)
        audio[start:end] += amplitude * envelope * rng.uniform(-1.0, 1.0, end - start)
        index += 1
    audio = 0.9 * audio / np.max(np.abs(audio))
    wavfile.write(path, SAMPLE_RATE, (audio * 32767).astype(np.int16))


def _beat_errors_ms(grid, bpm: float) -> np.ndarray:
    beat_ms = 60_000.0 / bpm
    return np.array([_wrap(position, beat_ms) for position in grid])


def _assert_on_the_beat(grid, bpm: float) -> None:
    """Every published beat at the same offset from the kicks (a constant grid at the
    right tempo), and that offset well inside a beat: the fallback has no attack
    refinement, so its grid lags the kick by about one onset frame or two."""
    errors = _beat_errors_ms(grid, bpm)
    assert np.ptp(errors) <= 2.0
    assert np.max(np.abs(errors)) <= 25.0


def test_analyze_mix_profile_reports_an_integer_bpm_for_an_integer_tempo(
    tmp_path: Path,
) -> None:
    from crate.smart_mix.analyzer import analyze_mix_profile

    track = tmp_path / "loop-128.wav"
    _drum_loop(track, 128.0, 90.0)

    profile = analyze_mix_profile(track)

    assert profile.bpm == 128.0
    _assert_on_the_beat(profile.beat_grid_ms, 128.0)


def test_analyze_mix_profile_holds_the_beat_through_an_offbeat_section(
    tmp_path: Path,
) -> None:
    from crate.smart_mix.analyzer import analyze_mix_profile

    track = tmp_path / "loop-break.wav"
    _drum_loop(track, 128.0, 90.0, offbeat_section=(30.0, 60.0))

    profile = analyze_mix_profile(track)

    assert profile.bpm == 128.0
    _assert_on_the_beat(profile.beat_grid_ms, 128.0)
