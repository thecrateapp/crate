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

    assert profile.analyzer_version == ANALYZER_VERSION == "smart-mix-audio-v9"
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
        lambda _path, _beats=None: {
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
    monkeypatch.setattr(
        audio_analysis, "_analyze_rust", lambda _path, _beats=None: None
    )

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


def _model_beats(phase: int, *, first_ms: int = 1_000, last_ms: int = 19_500):
    from crate.smart_mix.beat_model import BeatTrack

    beats = tuple(range(first_ms, last_ms + 1, 500))
    return BeatTrack(
        tracker="beat-this-test",
        beats_ms=beats,
        downbeats_ms=beats[phase::4],
    )


def test_external_beats_replace_tracker_and_pick_downbeat(
    monkeypatch, tmp_path: Path
) -> None:
    import librosa

    from crate.smart_mix.analyzer import analyze_mix_profile

    # The clicks accent every fourth beat from 1 s, which the onset heuristic takes
    # as the bar; the model hears the bar two beats later and decides it.
    track = tmp_path / "accented.wav"
    _write_click_track(
        track, bpm=120.0, duration_seconds=20.0, leading_silence_seconds=1.0
    )
    heuristic = analyze_mix_profile(track)

    def no_tracker(*_args, **_kwargs):
        raise AssertionError("model beats replace librosa's beat tracker")

    monkeypatch.setattr(librosa.beat, "beat_track", no_tracker)

    profile = analyze_mix_profile(track, beats=_model_beats(2))

    # librosa's grid lags the clicks by a frame or two; its bar starts on the accent.
    assert abs(heuristic.downbeat_anchor_ms - 1_000) <= 40
    assert profile.beat_tracker == "beat-this-test"
    assert profile.bpm == 120.0
    assert profile.beat_grid_ms[:3] == (1_000, 1_500, 2_000)
    assert profile.downbeat_anchor_ms == 2_000
    assert profile.time_signature == 4
    assert profile.quality == "full"
    assert heuristic.beat_tracker is None


def _model_track(times, downbeats=None, beats_per_bar=4):
    """Beat This! beats and downbeats on its 20 ms frames."""
    from crate.smart_mix.beat_model import BeatTrack

    def frames(values) -> tuple[int, ...]:
        return tuple(sorted({round(value / 20.0) * 20 for value in values}))

    return BeatTrack(
        tracker="beat-this-test",
        beats_ms=frames(times),
        downbeats_ms=frames(downbeats if downbeats is not None else times[::4]),
        beats_per_bar=beats_per_bar,
    )


def test_model_beats_stay_steady_through_a_half_tempo_intro(tmp_path: Path) -> None:
    from crate.smart_mix.analyzer import analyze_mix_profile

    # One tempo throughout; Beat This!'s DBN holds half of it for the first 48 beats,
    # and 470 ms falls between two of its 20 ms frames.
    period = 470.0
    track = tmp_path / "half-tempo-intro.wav"
    _write_click_track(
        track,
        bpm=60_000.0 / period,
        duration_seconds=60.0,
        leading_silence_seconds=1.0,
    )
    pulse = [1_000.0 + index * period for index in range(int(58_000 / period))]
    heard = [time for index, time in enumerate(pulse) if index >= 48 or index % 2 == 0]

    profile = analyze_mix_profile(track, beats=_model_track(heard, pulse[::4]))

    assert profile.tempo_stability >= 0.99
    assert profile.bpm_confidence >= 0.75
    assert profile.quality == "full"


def test_model_beats_of_a_drifting_track_stay_partial(tmp_path: Path) -> None:
    from crate.smart_mix.analyzer import analyze_mix_profile

    track = tmp_path / "drifting-model.wav"
    _write_click_track(
        track,
        bpm=120.0,
        end_bpm=140.0,
        duration_seconds=60.0,
        leading_silence_seconds=1.0,
    )
    times, time = [], 1_000.0
    while time < 59_000.0:
        times.append(time)
        time += 60_000.0 / (120.0 + 20.0 * time / 60_000.0)

    profile = analyze_mix_profile(track, beats=_model_track(times))

    assert profile.tempo_stability < 0.8
    assert profile.quality == "partial"


def test_model_downbeats_without_a_clear_bar_leave_no_downbeat(
    monkeypatch, tmp_path: Path
) -> None:
    from crate.smart_mix.analyzer import analyze_mix_profile
    from crate.smart_mix.beat_model import BeatTrack

    track = tmp_path / "unclear.wav"
    _write_click_track(
        track, bpm=120.0, duration_seconds=20.0, leading_silence_seconds=1.0
    )
    beats = _model_beats(0).beats_ms
    # Bars on two phases half and half: no phase reaches the share.
    split = BeatTrack(
        tracker="beat-this-test",
        beats_ms=beats,
        downbeats_ms=tuple(sorted(beats[0:16:4] + beats[18::4])),
    )

    profile = analyze_mix_profile(track, beats=split)

    # The onset heuristic would anchor this track; the model's word is final.
    assert profile.downbeat_anchor_ms is None
    assert profile.time_signature is None
    assert profile.phrases == ()
    assert profile.quality == "partial"
    assert profile.beat_tracker == "beat-this-test"


def test_three_four_meter_gets_no_phrases(tmp_path: Path) -> None:
    # Phrases and their consumers count bars of four beats: a track the DBN hears in
    # 3/4 says so and gets no downbeat and no phrases, so it goes to crossfade
    # (SM3-D16).
    from crate.smart_mix.analyzer import analyze_mix_profile
    from crate.smart_mix.beat_model import BeatTrack
    from tests.smart_mix_structure_audio import (
        BEAT_MS,
        DJ_SECTIONS,
        LEAD_SECONDS,
        write_structured_track,
    )

    track = tmp_path / "structured.wav"
    write_structured_track(track, DJ_SECTIONS)
    first_ms = round(LEAD_SECONDS * 1_000)
    beats = tuple(
        range(
            first_ms,
            first_ms + 4 * sum(section.bars for section in DJ_SECTIONS) * BEAT_MS,
            BEAT_MS,
        )
    )
    four = BeatTrack("beat-this-test", beats, beats[::4], beats_per_bar=4)
    three = BeatTrack("beat-this-test", beats, beats[::3], beats_per_bar=3)

    in_four = analyze_mix_profile(track, beats=four)
    in_three = analyze_mix_profile(track, beats=three)

    assert (in_four.time_signature, in_four.downbeat_anchor_ms) == (4, first_ms)
    assert in_four.phrases
    assert in_three.time_signature == 3
    assert in_three.downbeat_anchor_ms is None
    assert in_three.phrases == ()
    assert in_three.energy_curve is None
    assert in_three.beat_tracker == "beat-this-test"
    assert in_three.beat_grid_ms == in_four.beat_grid_ms


def test_external_beats_stop_at_the_analysed_head(monkeypatch, tmp_path: Path) -> None:
    from crate.smart_mix import analyzer

    monkeypatch.setattr(analyzer, "FULL_SCAN_HEAD_SECONDS", 10)
    monkeypatch.setattr(analyzer, "FULL_SCAN_TAIL_SECONDS", 10)
    track = tmp_path / "long.wav"
    _write_click_track(
        track, bpm=120.0, duration_seconds=40.0, leading_silence_seconds=1.0
    )

    profile = analyzer.analyze_mix_profile(track, beats=_model_beats(0, last_ms=39_000))

    assert profile.beat_grid_ms[0] == 1_000
    assert max(profile.beat_grid_ms) <= 10_000
    assert profile.quality == "partial"


def test_profile_analysis_passes_model_beats_to_rust(
    monkeypatch, tmp_path: Path
) -> None:
    import crate.audio_analysis as audio_analysis
    from crate import crate_cli
    from crate.smart_mix.versions import ANALYZER_VERSION

    beats = _model_beats(2)
    calls: list[dict] = []
    monkeypatch.setattr(crate_cli, "is_available", lambda: True)
    monkeypatch.setattr(crate_cli, "has_subcommands", lambda: True)
    monkeypatch.setattr(crate_cli, "supports_analyze_beats", lambda: True)

    def run_analyze(**kwargs):
        calls.append(kwargs)
        return {
            "mixProfile": {
                "analyzer": "crate-rust",
                "analyzerVersion": ANALYZER_VERSION,
                "durationMs": 20_000,
                "quality": "partial",
                "beatTracker": "beat-this-test",
            }
        }

    monkeypatch.setattr(crate_cli, "run_analyze", run_analyze)

    draft = audio_analysis.analyze_mix_profile(tmp_path / "track.flac", beats)
    plain = audio_analysis.analyze_mix_profile(tmp_path / "track.flac")

    assert calls == [
        {"file": str(tmp_path / "track.flac"), "beats": beats.to_payload()},
        {"file": str(tmp_path / "track.flac"), "beats": None},
    ]
    assert (draft.analyzer, draft.beat_tracker) == ("crate-rust", "beat-this-test")
    assert plain.analyzer == "crate-rust"


def test_profile_analysis_passes_model_beats_to_the_python_analyzer(
    monkeypatch, tmp_path: Path
) -> None:
    import crate.audio_analysis as audio_analysis
    from crate.smart_mix import analyzer

    beats = _model_beats(0)
    received: list[object] = []
    monkeypatch.setattr(audio_analysis, "_analyze_rust", lambda *_a, **_k: None)
    monkeypatch.setattr(
        analyzer,
        "analyze_mix_profile",
        lambda _path, beats=None: received.append(beats) or "draft",
    )

    assert audio_analysis.analyze_mix_profile(tmp_path / "t.flac", beats) == "draft"
    assert audio_analysis.analyze_mix_profile(tmp_path / "t.flac") == "draft"
    assert received == [beats, None]


def test_model_beats_go_to_python_when_crate_cli_cannot_take_them(
    monkeypatch, tmp_path: Path, caplog
) -> None:
    import logging

    import crate.audio_analysis as audio_analysis
    from crate import crate_cli
    from crate.smart_mix import analyzer

    beats = _model_beats(0)
    received: list[object] = []
    rust_runs: list[dict] = []
    monkeypatch.setattr(crate_cli, "is_available", lambda: True)
    monkeypatch.setattr(crate_cli, "has_subcommands", lambda: True)
    monkeypatch.setattr(crate_cli, "supports_analyze_beats", lambda: False)
    monkeypatch.setattr(
        crate_cli, "run_analyze", lambda **kwargs: rust_runs.append(kwargs)
    )
    monkeypatch.setattr(
        analyzer,
        "analyze_mix_profile",
        lambda _path, beats=None: received.append(beats) or "python draft",
    )

    with caplog.at_level(logging.WARNING, logger=audio_analysis.__name__):
        draft = audio_analysis.analyze_mix_profile(tmp_path / "t.flac", beats)

    # An older crate-cli would track its own beats after the model ran: the Python
    # analyzer takes them instead, and the worker says why.
    assert draft == "python draft"
    assert received == [beats]
    assert rust_runs == []
    assert "--beats" in caplog.text

    # Without model beats that crate-cli still runs.
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger=audio_analysis.__name__):
        audio_analysis.analyze_mix_profile(tmp_path / "t.flac")
    assert rust_runs == [{"file": str(tmp_path / "t.flac"), "beats": None}]
    assert received == [beats, None]
    assert "--beats" not in caplog.text


def test_model_beats_go_to_python_while_the_beats_probe_backs_off(
    monkeypatch, tmp_path: Path, caplog
) -> None:
    import logging
    import subprocess

    import crate.audio_analysis as audio_analysis
    from crate import crate_cli
    from crate.smart_mix import analyzer

    beats = _model_beats(0)
    probes: list[list[str]] = []

    def broken_probe(args, **_kwargs):
        probes.append(list(args))
        raise subprocess.TimeoutExpired(args, 5)

    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")
    monkeypatch.setattr(crate_cli, "is_available", lambda: True)
    monkeypatch.setattr(crate_cli, "has_subcommands", lambda: True)
    monkeypatch.setattr(crate_cli, "_clock", lambda: 1_000.0)
    monkeypatch.setattr(crate_cli.subprocess, "run", broken_probe)
    monkeypatch.setattr(
        analyzer, "analyze_mix_profile", lambda _path, beats=None: "python draft"
    )
    crate_cli._analyze_help.cache_clear()
    try:
        with caplog.at_level(logging.INFO, logger=audio_analysis.__name__):
            for name in ("a.flac", "b.flac"):
                draft = audio_analysis.analyze_mix_profile(tmp_path / name, beats)
                assert draft == "python draft"
    finally:
        crate_cli._analyze_help.cache_clear()

    # The binary may well take --beats: its analyze --help timed out once and is not
    # asked again for a minute, so the worker says that rather than blaming the binary.
    assert probes == [["/usr/local/bin/crate-cli", "analyze", "--help"]]
    records = [r for r in caplog.records if r.name == audio_analysis.__name__]
    assert "does not take model beats" not in caplog.text
    assert len(records) == 2
    assert all("backing off" in record.getMessage() for record in records)
    assert all(record.levelno == logging.INFO for record in records)


def _bar_features(bar_starts, kick_beats, beats, spacing=20):
    frames = beats * spacing + spacing
    onsets = np.full(frames, 0.2)
    low_onsets = np.full(frames, 0.1)
    chroma = np.zeros((frames, 12))
    chord = 0
    for beat in range(beats):
        frame = beat * spacing
        if beat in bar_starts:
            chord = (chord + 5) % 12
        onsets[frame] = 1.0
        if beat in kick_beats:
            low_onsets[frame] = 1.0
        chroma[frame : frame + spacing] = 0.0
        chroma[frame : frame + spacing, chord] = 1.0
        chroma[frame : frame + spacing, (chord + 4) % 12] = 0.8
        chroma[frame : frame + spacing, (chord + 7) % 12] = 0.6
    beat_frames = np.arange(beats) * spacing
    return beat_frames, {"onsets": onsets, "low_onsets": low_onsets, "chroma": chroma}


@pytest.mark.parametrize(
    ("bars", "kicks", "beats", "expected"),
    [
        (range(1, 33, 4), range(1, 33, 2), 33, 1),
        ((), range(32), 32, None),
        (
            [*range(0, 16, 4), *range(18, 34, 4)],
            [*range(0, 16, 4), *range(18, 34, 4)],
            34,
            None,
        ),
        (range(0, 12, 4), range(0, 12, 4), 12, None),
    ],
    ids=["pickup", "no-bar-structure", "bar-shifts-halfway", "short-grid"],
)
def test_downbeat_phase_needs_a_consistent_bar(bars, kicks, beats, expected) -> None:
    from crate.smart_mix.analyzer import _downbeat_phase

    beat_frames, features = _bar_features(set(bars), set(kicks), beats)

    assert _downbeat_phase(beat_frames, window_frames=2, **features) == expected


def test_frame_features_return_aligned_mfcc() -> None:
    from crate.smart_mix.analyzer import _frame_features

    rng = np.random.default_rng(5)
    audio = (0.1 * rng.standard_normal(3 * SAMPLE_RATE)).astype(np.float32)

    _, _, chroma, bands, mfcc = _frame_features(audio, SAMPLE_RATE)

    assert mfcc.shape == (bands.shape[0], 13)
    assert chroma.shape[0] == bands.shape[0]
    assert np.isfinite(mfcc).all()


def test_mfcc_is_the_orthonormal_dct_of_the_mel_levels() -> None:
    # The reference frame the Rust analyzer's MFCC is checked against
    # (tools/crate-cli/tests/smart_mix_structure.rs, mfcc_matches_orthonormal_dct).
    import json

    import librosa

    fixture = Path(__file__).parent / "fixtures/smart_mix/structure_v2.json"
    reference = json.loads(fixture.read_text())["mfccReference"]
    mel_db = np.asarray(reference["melDb"], dtype=np.float32)[:, None]

    mfcc = librosa.feature.mfcc(S=mel_db, n_mfcc=13)[:, 0]

    assert mfcc.tolist() == pytest.approx(reference["mfcc"], abs=1e-3)
