from __future__ import annotations

import pytest

from crate.smart_mix.camelot import to_camelot


@pytest.mark.parametrize(
    ("key", "scale", "expected"),
    [
        ("G#", "minor", "1A"),
        ("D#", "minor", "2A"),
        ("A#", "minor", "3A"),
        ("F", "minor", "4A"),
        ("C", "minor", "5A"),
        ("G", "minor", "6A"),
        ("D", "minor", "7A"),
        ("A", "minor", "8A"),
        ("E", "minor", "9A"),
        ("B", "minor", "10A"),
        ("F#", "minor", "11A"),
        ("C#", "minor", "12A"),
        ("B", "major", "1B"),
        ("F#", "major", "2B"),
        ("C#", "major", "3B"),
        ("G#", "major", "4B"),
        ("D#", "major", "5B"),
        ("A#", "major", "6B"),
        ("F", "major", "7B"),
        ("C", "major", "8B"),
        ("G", "major", "9B"),
        ("D", "major", "10B"),
        ("A", "major", "11B"),
        ("E", "major", "12B"),
    ],
)
def test_maps_all_major_and_minor_keys(key: str, scale: str, expected: str) -> None:
    assert to_camelot(key, scale) == expected


@pytest.mark.parametrize(
    ("key", "scale", "expected"),
    [
        ("A♭", "minor", "1A"),
        ("E-flat", "minor", "2A"),
        ("g flat", "major", "2B"),
        ("D♭", "major", "3B"),
        ("B#", "major", "8B"),
        ("Cb", "major", "1B"),
    ],
)
def test_normalizes_enharmonic_and_unicode_keys(
    key: str, scale: str, expected: str
) -> None:
    assert to_camelot(key, scale) == expected


@pytest.mark.parametrize(
    ("key", "scale"),
    [("H", "major"), ("A", "dorian"), ("", "minor")],
)
def test_rejects_unknown_keys_and_scales(key: str, scale: str) -> None:
    with pytest.raises(ValueError):
        to_camelot(key, scale)
