"""Phrase segmentation and per-bar energy (Smart Mix 3, SM3-D2)."""

from __future__ import annotations

import statistics
import time
from pathlib import Path

import numpy as np
import pytest
from tests.smart_mix_structure_audio import (
    BEAT_MS,
    DJ_KINDS,
    DJ_SECTIONS,
    SAMPLE_RATE,
    Section,
    section_start_ms,
    write_structured_track,
)


BAR_MS = 4 * BEAT_MS
FIRST_BEAT_MS = 1_000


@pytest.fixture(scope="module")
def dj_track(tmp_path_factory):
    from crate.smart_mix.analyzer import analyze_mix_profile

    path = tmp_path_factory.mktemp("structure") / "dj-120.wav"
    write_structured_track(path, DJ_SECTIONS)
    return analyze_mix_profile(path)


def _downbeats(profile) -> tuple[int, ...]:
    phase = profile.beat_grid_ms.index(profile.downbeat_anchor_ms) % 4
    return profile.beat_grid_ms[phase::4]


def _bar_level_inputs(bar_db: list[float], *, sample_rate: int = SAMPLE_RATE):
    """A steady 120 BPM grid whose bars hold the given RMS levels (dBFS)."""
    from crate.smart_mix.cue_detection import rms_frame_geometry
    from crate.smart_mix.structure import EnergyFrames

    beats = tuple(FIRST_BEAT_MS + index * BEAT_MS for index in range(4 * len(bar_db)))
    total_samples = (
        (FIRST_BEAT_MS + len(bar_db) * BAR_MS + 1_000) * sample_rate // 1_000
    )
    frame_length, hop_length = rms_frame_geometry(sample_rate)
    starts = np.arange(0, total_samples - frame_length + 1, hop_length)
    centres_ms = (starts + frame_length / 2) * 1_000 / sample_rate
    bars = np.floor((centres_ms - FIRST_BEAT_MS) / BAR_MS).astype(int)
    levels = np.full(starts.size, -90.0)
    inside = (bars >= 0) & (bars < len(bar_db))
    levels[inside] = np.asarray(bar_db)[bars[inside]]
    band_frames = 1 + total_samples // 256
    frames = EnergyFrames(
        rms=10.0 ** (levels / 20.0),
        bands_db=np.zeros((band_frames, 3)),
        band_hop=256,
    )
    return beats, beats[::4], frames


def _blocks(lengths: list[int], *, loud: float = -12.0, quiet: float = -24.0):
    levels: list[float] = []
    for index, length in enumerate(lengths):
        levels.extend([quiet if index % 2 == 0 else loud] * length)
    return levels


def test_segments_on_eight_bar_multiples(dj_track) -> None:
    phrases = dj_track.phrases

    assert phrases
    assert {phrase.bars for phrase in phrases} <= {8, 16, 32}
    for current, following in zip(phrases, phrases[1:], strict=False):
        assert following.start_beat == current.start_beat + 4 * current.bars
    expected = section_start_ms(DJ_SECTIONS)
    starts = [phrase.start_ms for phrase in phrases]
    assert len(starts) == len(expected), starts
    assert all(
        abs(start - target) <= BEAT_MS
        for start, target in zip(starts, expected, strict=True)
    ), starts
    assert all(
        phrase.start_ms == dj_track.beat_grid_ms[phrase.start_beat]
        for phrase in phrases
    )


def test_detects_break_and_peak_kinds(dj_track) -> None:
    phrases = dj_track.phrases

    assert tuple(phrase.kind for phrase in phrases) == DJ_KINDS
    assert dj_track.structure_confidence >= 0.7
    peaks = [phrase.energy for phrase in phrases if phrase.kind == "peak"]
    others = [phrase.energy for phrase in phrases if phrase.kind != "peak"]
    assert min(peaks) > max(others)
    assert phrases[0].delta_energy is None
    assert all(
        following.delta_energy
        == pytest.approx(following.energy - current.energy, abs=2e-4)
        for current, following in zip(phrases, phrases[1:], strict=False)
    )
    assert dj_track.vocal_presence is None


def test_low_confidence_on_irregular_meter(tmp_path: Path) -> None:
    from crate.smart_mix.analyzer import analyze_mix_profile

    track = tmp_path / "five-four.wav"
    sections = tuple(
        Section(5, 0.02 if index % 2 == 0 else 0.15) for index in range(12)
    )
    write_structured_track(track, sections, beats_per_bar=5)

    profile = analyze_mix_profile(track)

    assert profile.structure_confidence is not None
    assert profile.structure_confidence < 0.4


def test_low_confidence_on_irregular_phrase_lengths() -> None:
    from crate.smart_mix.structure import segment_phrases

    irregular = segment_phrases(
        *_bar_level_inputs(_blocks([5] * 16)), sample_rate=SAMPLE_RATE
    )
    regular = segment_phrases(
        *_bar_level_inputs(_blocks([16, 8, 16, 8, 16, 16])), sample_rate=SAMPLE_RATE
    )

    assert irregular.structure_confidence < 0.4
    assert regular.structure_confidence > 0.7
    assert [phrase.start_beat // 4 for phrase in regular.phrases] == [
        0,
        16,
        24,
        40,
        48,
        64,
    ]


def test_energy_curve_one_byte_per_bar(dj_track) -> None:
    from crate.smart_mix.structure import segment_phrases

    curve = dj_track.energy_curve
    downbeats = _downbeats(dj_track)

    assert isinstance(curve, bytes)
    assert len(curve) == len(downbeats)
    first_bar = round((downbeats[0] - FIRST_BEAT_MS) / BAR_MS)
    peak = [curve[bar - first_bar] for bar in range(26, 38)]
    intro = [curve[bar - first_bar] for bar in range(2, 14)]
    build = [curve[bar - first_bar] for bar in range(16, 24)]
    # A 0.15 chord is about -14.7 dBFS: byte 255 * (60 - 14.7) / 60.
    assert all(abs(value - 193) <= 3 for value in peak), peak
    assert max(intro) + 40 < min(peak)
    assert build == sorted(build)

    levels = [-60.0, -45.5, -30.2, -12.25, -3.0, 0.0] * 4
    exact = segment_phrases(*_bar_level_inputs(levels), sample_rate=SAMPLE_RATE)
    assert exact.energy_curve == bytes(
        int(255 * (level + 60.0) / 60.0 + 0.5) for level in levels
    )


def test_caps_phrase_count() -> None:
    from crate.smart_mix.models import MAX_ENERGY_CURVE_BARS, MAX_PHRASES
    from crate.smart_mix.structure import segment_phrases

    draft = segment_phrases(
        *_bar_level_inputs(_blocks([8] * 263)), sample_rate=SAMPLE_RATE
    )

    assert len(draft.energy_curve) == MAX_ENERGY_CURVE_BARS
    assert 64 <= len(draft.phrases) <= MAX_PHRASES
    assert {phrase.bars for phrase in draft.phrases} <= {8, 16, 32}
    for current, following in zip(draft.phrases, draft.phrases[1:], strict=False):
        assert following.start_beat == current.start_beat + 4 * current.bars


def test_segment_phrases_without_downbeats_has_no_structure() -> None:
    from crate.smart_mix.structure import segment_phrases

    beats, _, frames = _bar_level_inputs(_blocks([16, 16]))

    draft = segment_phrases(beats, (), frames, SAMPLE_RATE)

    assert draft.phrases == ()
    assert draft.energy_curve is None
    assert draft.structure_confidence == 0.0


@pytest.mark.benchmark
def test_runtime_overhead_under_ten_percent(tmp_path: Path, monkeypatch) -> None:
    from crate.smart_mix import analyzer

    track = tmp_path / "overhead.wav"
    sections = DJ_SECTIONS * 2
    write_structured_track(track, sections, sample_rate=22_050)
    spent: list[float] = []

    def timed(function):
        def wrapper(*args, **kwargs):
            started = time.perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                spent.append(time.perf_counter() - started)

        return wrapper

    monkeypatch.setattr(analyzer, "segment_phrases", timed(analyzer.segment_phrases))
    monkeypatch.setattr(analyzer, "_band_energies", timed(analyzer._band_energies))
    analyzer.analyze_mix_profile(track)
    ratios = []
    for _ in range(3):
        spent.clear()
        started = time.perf_counter()
        analyzer.analyze_mix_profile(track)
        total = time.perf_counter() - started
        ratios.append(sum(spent) / (total - sum(spent)))

    assert statistics.median(ratios) < 0.10


def test_downbeats_follow_the_anchor_phase() -> None:
    from crate.smart_mix.structure import downbeats_from_anchor

    grid = tuple(range(500, 6_000, 500))

    assert downbeats_from_anchor(grid, 3_000) == (1_000, 3_000, 5_000)
    assert downbeats_from_anchor(grid, None) == ()
    assert downbeats_from_anchor(grid, 3_100) == ()


def test_cue_detection_reuses_precomputed_rms_frames() -> None:
    from crate.smart_mix.cue_detection import detect_mix_cues, frame_rms
    from tests.smart_mix_structure_audio import structured_audio

    audio = structured_audio(DJ_SECTIONS[:2])
    grid = tuple(range(1_000, 48_000, BEAT_MS))

    assert detect_mix_cues(
        audio, SAMPLE_RATE, grid, rms=frame_rms(audio, SAMPLE_RATE)
    ) == detect_mix_cues(audio, SAMPLE_RATE, grid)
