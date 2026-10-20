"""Generate deterministic drum fixtures for Smart Mix device measurements.

Each fixture is a synthetic drum loop with sharp kick onsets, so the beat phase
of each deck can be measured exactly in a PCM bus capture. The set covers close
tempos for beatmatching, a slow tempo drift and a half-tempo track.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import soundfile
from mutagen.flac import FLAC

SAMPLE_RATE = 48_000
ARTIST = "Crate Lab"
ALBUM_PREFIX = "Smart Mix Fixture"


@dataclass(frozen=True)
class Fixture:
    file: str
    title: str
    bpm: float
    bpm_end: float
    kick_hz: float
    duration_s: float


FIXTURES = (
    Fixture("01-click-120.flac", "Click 120", 120.0, 120.0, 55.0, 150.0),
    Fixture("02-click-122.flac", "Click 122", 122.0, 122.0, 65.0, 150.0),
    Fixture("03-click-118.flac", "Click 118", 118.0, 118.0, 50.0, 150.0),
    Fixture("04-click-121-drift.flac", "Click 121 drift", 121.0, 121.6, 60.0, 150.0),
    Fixture("05-click-60-half.flac", "Click 60 half", 60.0, 60.0, 58.0, 150.0),
)


def beat_times(fixture: Fixture) -> np.ndarray:
    times = [0.0]
    while True:
        progress = times[-1] / fixture.duration_s
        bpm = fixture.bpm + (fixture.bpm_end - fixture.bpm) * progress
        following = times[-1] + 60.0 / bpm
        if following >= fixture.duration_s:
            return np.array(times)
        times.append(following)


def _kick(kick_hz: float, accent: float) -> np.ndarray:
    length = int(0.18 * SAMPLE_RATE)
    t = np.arange(length) / SAMPLE_RATE
    sweep = kick_hz + (kick_hz * 2.5) * np.exp(-t * 40.0)
    phase = 2.0 * np.pi * np.cumsum(sweep) / SAMPLE_RATE
    body = np.sin(phase) * np.exp(-t * 18.0)
    click = np.zeros(length)
    click[:48] = np.hanning(96)[48:]
    return accent * (0.8 * body + 0.4 * click)


def _noise_burst(rng: np.random.Generator, length_s: float, decay: float) -> np.ndarray:
    length = int(length_s * SAMPLE_RATE)
    t = np.arange(length) / SAMPLE_RATE
    return rng.standard_normal(length) * np.exp(-t * decay)


def render(fixture: Fixture, seed: int = 20261019) -> np.ndarray:
    rng = np.random.default_rng(seed)
    total = int(fixture.duration_s * SAMPLE_RATE)
    out = np.zeros(total + SAMPLE_RATE)
    snare = 0.25 * _noise_burst(rng, 0.15, 30.0)
    hat = 0.06 * np.diff(_noise_burst(rng, 0.04, 120.0), prepend=0.0)
    crash = 0.18 * np.diff(_noise_burst(rng, 0.6, 6.0), prepend=0.0)
    beats = beat_times(fixture)
    for index, start_s in enumerate(beats):
        start = int(round(start_s * SAMPLE_RATE))
        downbeat = index % 4 == 0
        kick = _kick(fixture.kick_hz, 1.0 if downbeat else 0.6)
        out[start : start + kick.size] += kick
        if downbeat:
            out[start : start + crash.size] += crash
        if index % 2 == 1:
            out[start : start + snare.size] += snare
        if index + 1 < beats.size:
            middle = int(round((start_s + beats[index + 1]) / 2 * SAMPLE_RATE))
            out[middle : middle + hat.size] += hat
    t = np.arange(total) / SAMPLE_RATE
    out[:total] += 0.04 * (
        np.sin(2 * np.pi * 220.0 * t) + np.sin(2 * np.pi * 261.63 * t)
    )
    out = out[:total]
    out *= 0.6 / np.max(np.abs(out))
    return np.stack([out, out], axis=1)


def album_for(fixture: Fixture) -> str:
    return f"{ALBUM_PREFIX} {fixture.title}"


def write_fixture(fixture: Fixture, directory: Path) -> dict[str, object]:
    album = album_for(fixture)
    (directory / album).mkdir(parents=True, exist_ok=True)
    path = directory / album / fixture.file
    soundfile.write(path, render(fixture), SAMPLE_RATE, subtype="PCM_16")
    tags = FLAC(path)
    tags["artist"] = ARTIST
    tags["albumartist"] = ARTIST
    tags["album"] = album
    tags["title"] = fixture.title
    tags["tracknumber"] = fixture.file.split("-", 1)[0]
    tags["bpm"] = f"{fixture.bpm:g}"
    tags.save()
    entry = asdict(fixture)
    entry["album"] = album
    entry["path"] = f"{album}/{fixture.file}"
    entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return entry


def generate(directory: Path) -> dict[str, object]:
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1,
        "sampleRate": SAMPLE_RATE,
        "artist": ARTIST,
        "tracks": [write_fixture(fixture, directory) for fixture in FIXTURES],
    }
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    manifest = generate(args.output)
    print(json.dumps({"tracks": len(manifest["tracks"]), "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
