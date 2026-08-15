"""Canonical release-date normalization helpers."""

from datetime import date


def normalize_release_date(value: object) -> str | None:
    """Return a complete ISO public release date, or ``None``.

    MusicBrainz may return year-only or year-month values. We deliberately do
    not invent missing precision because those values would sort as if they
    were released on an arbitrary day.
    """

    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if len(candidate) != 10:
        return None
    try:
        return date.fromisoformat(candidate).isoformat()
    except ValueError:
        return None
