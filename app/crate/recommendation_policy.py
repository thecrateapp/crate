from __future__ import annotations

from datetime import timedelta
from math import isfinite

from crate.track_versions import track_song_identity

RECENT_PLAY_WINDOW = timedelta(days=7)
SIGNIFICANT_PLAY_SECONDS = 30.0
SIGNIFICANT_PLAY_RATIO = 0.5


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


__all__ = [
    "RECENT_PLAY_WINDOW",
    "SIGNIFICANT_PLAY_RATIO",
    "SIGNIFICANT_PLAY_SECONDS",
    "canonical_key",
    "is_significant_play",
    "significant_play_threshold",
]
