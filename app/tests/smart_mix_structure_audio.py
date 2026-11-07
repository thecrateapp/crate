"""Synthetic tracks for the Smart Mix structure tests: clicks plus energy blocks.

Each section is a run of bars over which a sustained A minor chord holds or ramps its
level, so section changes are energy changes on downbeats while the clicks keep the
beat tracker and the downbeat detector on a steady grid.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.io import wavfile


SAMPLE_RATE = 11_025
BPM = 120.0
BEAT_MS = round(60_000 / BPM)
LEAD_SECONDS = 1.0
TAIL_SECONDS = 1.0
CHORD_HZ = (220.0, 261.6256, 329.6276)
ACCENT_LEVEL = 0.5
BEAT_LEVEL = 0.2


@dataclass(frozen=True, slots=True)
class Section:
    bars: int
    level: float
    end_level: float | None = None


# Intro, build, peak, break, peak and outro, each a multiple of eight bars.
DJ_SECTIONS = (
    Section(16, 0.015),
    Section(8, 0.015, 0.08),
    Section(16, 0.15),
    Section(8, 0.02),
    Section(8, 0.15),
    Section(8, 0.03),
)
DJ_KINDS = ("intro", "build", "peak", "break", "peak", "outro")


def section_start_bars(sections: tuple[Section, ...]) -> list[int]:
    starts, bar = [], 0
    for section in sections:
        starts.append(bar)
        bar += section.bars
    return starts


def section_start_ms(
    sections: tuple[Section, ...], *, bpm: float = BPM, beats_per_bar: int = 4
) -> list[int]:
    bar_ms = beats_per_bar * 60_000 / bpm
    return [
        round(LEAD_SECONDS * 1_000 + bar * bar_ms)
        for bar in section_start_bars(sections)
    ]


def structured_audio(
    sections: tuple[Section, ...],
    *,
    bpm: float = BPM,
    beats_per_bar: int = 4,
    sample_rate: int = SAMPLE_RATE,
) -> np.ndarray:
    beat_seconds = 60.0 / bpm
    total_beats = sum(section.bars for section in sections) * beats_per_bar
    duration = LEAD_SECONDS + total_beats * beat_seconds + TAIL_SECONDS
    sample_count = round(duration * sample_rate)
    envelope = np.zeros(sample_count, dtype=np.float64)
    position = LEAD_SECONDS
    for section in sections:
        start = round(position * sample_rate)
        seconds = section.bars * beats_per_bar * beat_seconds
        end = min(sample_count, round((position + seconds) * sample_rate))
        end_level = section.level if section.end_level is None else section.end_level
        envelope[start:end] = np.linspace(section.level, end_level, end - start)
        position += seconds
    time = np.arange(sample_count, dtype=np.float64) / sample_rate
    chord = sum(np.sin(2.0 * np.pi * frequency * time) for frequency in CHORD_HZ)
    audio = envelope * chord
    pulse_length = round(0.025 * sample_rate)
    pulse = np.exp(-np.linspace(0.0, 7.0, pulse_length))
    for beat in range(total_beats):
        start = round((LEAD_SECONDS + beat * beat_seconds) * sample_rate)
        end = min(sample_count, start + pulse_length)
        level = ACCENT_LEVEL if beat % beats_per_bar == 0 else BEAT_LEVEL
        audio[start:end] += level * pulse[: end - start]
    return audio.astype(np.float32)


def write_structured_track(
    path: Path,
    sections: tuple[Section, ...],
    *,
    bpm: float = BPM,
    beats_per_bar: int = 4,
    sample_rate: int = SAMPLE_RATE,
) -> np.ndarray:
    audio = structured_audio(
        sections, bpm=bpm, beats_per_bar=beats_per_bar, sample_rate=sample_rate
    )
    if float(np.max(np.abs(audio))) >= 1.0:
        raise ValueError("synthetic track would clip")
    wavfile.write(path, sample_rate, (audio * 32767).astype(np.int16))
    return audio
