from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from crate.config import load_config

_STATS_WINDOWS: dict[str, int | None] = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "365d": 365,
    "all_time": None,
}


def normalize_stats_window(window: str) -> str:
    candidate = (window or "30d").strip().lower()
    if candidate not in _STATS_WINDOWS:
        raise ValueError(f"Unsupported stats window: {window}")
    return candidate


@lru_cache(maxsize=1)
def library_root() -> Path:
    try:
        return Path(load_config()["library_path"])
    except Exception:
        return Path("/music")


def relative_track_path(track_path: str) -> str:
    if not track_path:
        return ""

    root = str(library_root()).rstrip("/")
    normalized = track_path.strip()
    if root and normalized.startswith(f"{root}/"):
        return normalized[len(root) + 1 :]
    if normalized.startswith("/music/"):
        return normalized[len("/music/") :]
    if not normalized.startswith("/"):
        return normalized
    return ""


def window_day_cutoff(window: str) -> str | None:
    normalized = normalize_stats_window(window)
    days = _STATS_WINDOWS[normalized]
    if days is None:
        return None
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


__all__ = [
    "_STATS_WINDOWS",
    "library_root",
    "normalize_stats_window",
    "relative_track_path",
    "window_day_cutoff",
]
