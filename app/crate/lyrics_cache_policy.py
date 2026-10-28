from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Literal

RefreshMode = Literal["missing", "due", "upgrade"]
REFRESH_MODES: tuple[RefreshMode, ...] = ("missing", "due", "upgrade")


def clean_lyrics(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text.strip() else None


def lyrics_rank(payload: Mapping[str, Any] | None) -> int:
    if not payload:
        return 0
    if clean_lyrics(payload.get("syncedLyrics")):
        return 2
    if clean_lyrics(payload.get("plainLyrics")):
        return 1
    return 0


def has_lyrics(payload: Mapping[str, Any] | None) -> bool:
    return lyrics_rank(payload) > 0


def should_replace_lyrics(
    existing: Mapping[str, Any] | None, candidate: Mapping[str, Any]
) -> bool:
    if existing is None:
        return True
    return lyrics_rank(candidate) > lyrics_rank(existing)


def is_fresh(
    updated_at: datetime | str | None,
    max_age_seconds: int | None,
    *,
    now: datetime | None = None,
) -> bool:
    if max_age_seconds is None:
        return True
    if isinstance(updated_at, str):
        try:
            updated_at = datetime.fromisoformat(updated_at)
        except ValueError:
            return False
    if updated_at is None:
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    return (current - updated_at).total_seconds() <= max_age_seconds


def normalize_refresh_mode(value: Any) -> RefreshMode:
    mode = str(value or "missing").strip().lower()
    if mode not in REFRESH_MODES:
        raise ValueError(f"unknown lyrics refresh mode: {value}")
    return mode  # type: ignore[return-value]


__all__ = [
    "REFRESH_MODES",
    "RefreshMode",
    "clean_lyrics",
    "has_lyrics",
    "is_fresh",
    "lyrics_rank",
    "normalize_refresh_mode",
    "should_replace_lyrics",
]
