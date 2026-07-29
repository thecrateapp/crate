from __future__ import annotations

_PITCH_CLASSES = {
    "C": "C",
    "B#": "C",
    "C#": "C#",
    "DB": "C#",
    "D": "D",
    "D#": "D#",
    "EB": "D#",
    "E": "E",
    "FB": "E",
    "E#": "F",
    "F": "F",
    "F#": "F#",
    "GB": "F#",
    "G": "G",
    "G#": "G#",
    "AB": "G#",
    "A": "A",
    "A#": "A#",
    "BB": "A#",
    "B": "B",
    "CB": "B",
}

_CAMELOT = {
    ("G#", "minor"): "1A",
    ("D#", "minor"): "2A",
    ("A#", "minor"): "3A",
    ("F", "minor"): "4A",
    ("C", "minor"): "5A",
    ("G", "minor"): "6A",
    ("D", "minor"): "7A",
    ("A", "minor"): "8A",
    ("E", "minor"): "9A",
    ("B", "minor"): "10A",
    ("F#", "minor"): "11A",
    ("C#", "minor"): "12A",
    ("B", "major"): "1B",
    ("F#", "major"): "2B",
    ("C#", "major"): "3B",
    ("G#", "major"): "4B",
    ("D#", "major"): "5B",
    ("A#", "major"): "6B",
    ("F", "major"): "7B",
    ("C", "major"): "8B",
    ("G", "major"): "9B",
    ("D", "major"): "10B",
    ("A", "major"): "11B",
    ("E", "major"): "12B",
}


def to_camelot(key: str, scale: str) -> str:
    normalized_key = _normalize_key(key)
    normalized_scale = scale.strip().lower()
    if normalized_scale not in {"major", "minor"}:
        raise ValueError(f"Unsupported musical scale: {scale!r}")
    try:
        return _CAMELOT[(normalized_key, normalized_scale)]
    except KeyError as exc:
        raise ValueError(f"Unsupported musical key: {key!r} {scale!r}") from exc


def _normalize_key(key: str) -> str:
    normalized = (
        key.strip()
        .upper()
        .replace("♯", "#")
        .replace("♭", "B")
        .replace("-FLAT", "B")
        .replace(" FLAT", "B")
        .replace("-SHARP", "#")
        .replace(" SHARP", "#")
        .replace(" ", "")
    )
    try:
        return _PITCH_CLASSES[normalized]
    except KeyError as exc:
        raise ValueError(f"Unsupported musical key: {key!r}") from exc
