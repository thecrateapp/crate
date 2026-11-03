from __future__ import annotations

import numpy as np
import pytest

from crate.smart_mix.camelot import to_camelot


SAMPLE_RATE = 22_050
NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def _midi_hz(note: int) -> float:
    return 440.0 * 2.0 ** ((note - 69) / 12.0)


def _add_note(audio: np.ndarray, note: int, amplitude: float, start: int, length: int):
    time = np.arange(length) / SAMPLE_RATE
    for partial in range(1, 5):
        audio[start : start + length] += (amplitude / partial) * np.sin(
            2.0 * np.pi * _midi_hz(note) * partial * time
        )


def _cadence_over_a_kick(tonic: int, minor: bool) -> np.ndarray:
    """I-IV-V-I (i-iv-V-i in minor) over its bass roots with a kick on every beat at
    120 BPM: in a real mix the kick and bass carry most of the energy below 200 Hz."""
    chord = 3 * SAMPLE_RATE
    audio = np.zeros(chord * 4, dtype=np.float64)
    third = 3 if minor else 4
    for index, (degree, chord_third) in enumerate(
        ((0, third), (5, third), (7, 4), (0, third))
    ):
        root = tonic + degree
        _add_note(audio, 36 + root % 12, 0.30, index * chord, chord)
        for interval in (0, chord_third, 7):
            _add_note(audio, 60 + root % 12 + interval, 0.12, index * chord, chord)
    kick = round(0.15 * SAMPLE_RATE)
    progress = np.arange(kick) / kick
    phase = np.cumsum(2.0 * np.pi * (60.0 - 20.0 * progress) / SAMPLE_RATE)
    hit = 0.9 * np.exp(-6.0 * progress) * np.sin(phase)
    for start in range(0, audio.size, SAMPLE_RATE // 2):
        end = min(audio.size, start + kick)
        audio[start:end] += hit[: end - start]
    return audio.astype(np.float32)


def _pink_noise(seconds: int) -> np.ndarray:
    white = np.random.default_rng(7).uniform(-1.0, 1.0, SAMPLE_RATE * seconds)
    pink = np.empty_like(white)
    b0 = b1 = b2 = 0.0
    for index, value in enumerate(white):
        b0 = 0.99765 * b0 + value * 0.0990460
        b1 = 0.96300 * b1 + value * 0.2965164
        b2 = 0.57000 * b2 + value * 1.0526913
        pink[index] = b0 + b1 + b2 + value * 0.1848
    return pink.astype(np.float32)


def _rms_normalized(audio: np.ndarray) -> np.ndarray:
    return 0.2 * audio / float(np.sqrt(np.mean(np.square(audio))))


@pytest.mark.parametrize("minor", [False, True], ids=["major", "minor"])
@pytest.mark.parametrize("tonic", range(12), ids=NOTE_NAMES)
def test_every_key_survives_a_kick_drum_under_the_harmony(tonic, minor) -> None:
    from crate.smart_mix.analyzer import _key_features

    scale = "minor" if minor else "major"

    _, _, camelot, _ = _key_features(_cadence_over_a_kick(tonic, minor), SAMPLE_RATE)

    assert camelot == to_camelot(NOTE_NAMES[tonic], scale)


def test_pitchless_noise_does_not_shape_the_pitch_class_profile() -> None:
    from crate.smart_mix.key_detection import pitch_class_profile

    noise = pitch_class_profile(_rms_normalized(_pink_noise(12)), SAMPLE_RATE)
    harmony = pitch_class_profile(
        _rms_normalized(_cadence_over_a_kick(2, False)), SAMPLE_RATE
    )

    assert np.ptp(noise) < 0.2 * np.ptp(harmony)


@pytest.mark.parametrize(
    ("tonic", "minor", "expected"),
    [(2, False, "10B"), (9, True, "8A"), (6, True, "11A")],
)
def test_a_cadence_keeps_its_key_under_pink_noise(tonic, minor, expected) -> None:
    from crate.smart_mix.analyzer import _key_features

    mixed = _rms_normalized(_cadence_over_a_kick(tonic, minor)) + 0.3 * _rms_normalized(
        _pink_noise(12)
    )

    _, _, camelot, _ = _key_features(mixed.astype(np.float32), SAMPLE_RATE)

    assert camelot == expected


def test_key_detection_matches_the_rust_profile_constants() -> None:
    from pathlib import Path

    from crate.smart_mix import key_detection

    source = (
        Path(__file__).resolve().parents[2] / "tools/crate-cli/src/key_detection.rs"
    ).read_text()
    for name, value in (
        ("FFT_SIZE", key_detection.FFT_SIZE),
        ("HOP_SIZE", key_detection.HOP_SIZE),
        ("LOWEST_NOTE", key_detection.LOWEST_NOTE),
        ("NOTE_COUNT", key_detection.NOTE_COUNT),
        ("WHITENING_RADIUS", key_detection.WHITENING_RADIUS),
    ):
        assert f"const {name}: usize = {value:_};" in source, name
