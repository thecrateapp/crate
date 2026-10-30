from __future__ import annotations

from datetime import timedelta
from math import isfinite
import re

from crate.track_versions import track_song_identity

RECENT_PLAY_WINDOW = timedelta(days=7)
SIGNIFICANT_PLAY_SECONDS = 30.0
SIGNIFICANT_PLAY_RATIO = 0.5
PATH_RECENCY_QUALITY_BAND = 0.05
MAX_CONSECUTIVE_SAME_ARTIST = 2
PATH_ARTIST_TRIM_CHARS = (
    " \t\n\r\v\f\x1c\x1d\x1e\x1f\x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
PATH_FEATURED_ARTIST_PATTERN = (
    r"(?:\s+|\s*[(\[]\s*)(?:feat|ft|featuring)\.?\s+.+?[)\]]?\s*$"
)
_FEATURED_ARTIST_RE = re.compile(PATH_FEATURED_ARTIST_PATTERN, re.IGNORECASE)


def path_artist_key(row: dict) -> str:
    """Lowercase the full name, stripping only explicit featured-artist credits.

    Keep &, x, with and commas: they can be part of a band's actual name.
    Lowercase matches the SQL quota key without folding distinct names together.
    """
    name = str(row.get("artist") or row.get("album_artist") or "").strip(
        PATH_ARTIST_TRIM_CHARS
    )
    return _FEATURED_ARTIST_RE.sub("", name).strip(PATH_ARTIST_TRIM_CHARS).lower()


def significant_play_threshold(duration: float | None) -> float:
    if duration is None or not isfinite(duration) or duration <= 0:
        return SIGNIFICANT_PLAY_SECONDS
    return min(SIGNIFICANT_PLAY_SECONDS, SIGNIFICANT_PLAY_RATIO * duration)


def is_significant_play(
    played_seconds: float | None,
    duration: float | None = None,
    *,
    was_completed: bool = False,
) -> bool:
    if was_completed:
        return True
    return (
        played_seconds is not None
        and isfinite(played_seconds)
        and played_seconds >= significant_play_threshold(duration)
    )


def canonical_key(row: dict) -> tuple[str, str] | None:
    return track_song_identity(row)


def fresh_path_candidates(
    scored_rows: list[tuple[dict, float]],
    *,
    preferred: dict,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
) -> list[dict]:
    """Prefer fresh songs only within a comparable musical-quality tier."""
    recent = recent_song_keys or set()
    previous = previous_song_keys or set()
    previous_ids = previous_track_ids or set()
    if not scored_rows:
        return []
    if (
        canonical_key(preferred) not in recent | previous
        and preferred.get("id", preferred.get("track_id")) not in previous_ids
    ):
        return [row for row, _score in scored_rows]

    floor = max(score for _row, score in scored_rows) - PATH_RECENCY_QUALITY_BAND
    comparable = [row for row, score in scored_rows if score >= floor]
    unheard = [row for row in comparable if canonical_key(row) not in recent]
    new = [
        row
        for row in unheard
        if canonical_key(row) not in previous
        and row.get("id", row.get("track_id")) not in previous_ids
    ]
    return new or unheard or comparable


__all__ = [
    "MAX_CONSECUTIVE_SAME_ARTIST",
    "PATH_ARTIST_TRIM_CHARS",
    "PATH_FEATURED_ARTIST_PATTERN",
    "PATH_RECENCY_QUALITY_BAND",
    "RECENT_PLAY_WINDOW",
    "SIGNIFICANT_PLAY_RATIO",
    "SIGNIFICANT_PLAY_SECONDS",
    "canonical_key",
    "fresh_path_candidates",
    "is_significant_play",
    "path_artist_key",
    "significant_play_threshold",
]
