from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile
from mutagen.flac import FLAC

from generate_fixtures import FIXTURES, SAMPLE_RATE, beat_times, generate, render


def test_fixtures_are_deterministic() -> None:
    assert np.array_equal(render(FIXTURES[0]), render(FIXTURES[0]))


def test_kicks_start_exactly_on_the_beat_grid() -> None:
    fixture = FIXTURES[0]
    audio = render(fixture)[:, 0]
    for beat in beat_times(fixture)[1:9]:
        start = int(round(beat * SAMPLE_RATE))
        before = np.abs(audio[start - 96 : start - 48]).max()
        after = np.abs(audio[start : start + 48]).max()
        assert after > 4 * before


def test_drift_fixture_speeds_up_over_the_track() -> None:
    drift = next(fixture for fixture in FIXTURES if fixture.bpm_end != fixture.bpm)
    intervals = np.diff(beat_times(drift))
    assert intervals[0] > intervals[-1]


def test_generate_writes_tagged_tracks_and_a_manifest(tmp_path: Path) -> None:
    manifest = generate(tmp_path)

    written = json.loads((tmp_path / "manifest.json").read_text())
    assert written == manifest
    assert len({track["album"] for track in written["tracks"]}) == len(FIXTURES)
    first = written["tracks"][0]
    info = soundfile.info(tmp_path / first["path"])
    assert (info.samplerate, info.channels) == (SAMPLE_RATE, 2)
    tags = FLAC(tmp_path / first["path"])
    assert tags["artist"] == ["Crate Lab"]
    assert tags["bpm"] == ["120"]
