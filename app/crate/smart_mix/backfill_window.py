"""Night window for the Smart Mix profile backfill (SM3-D15).

Nobody listens at night, so the backfill keeps more profile analyses in flight
inside the night window than outside it. The settings live in the backfill
campaign next to ``batch_size`` and ``max_attempts``; campaigns saved before
the window existed read the defaults.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import re
from typing import Any, Literal, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


DEFAULT_NIGHT_WINDOW: dict[str, str] = {
    "start": "01:00",
    "end": "08:00",
    "timezone": "Europe/Madrid",
}
DEFAULT_NIGHT_CONCURRENCY = 8
DEFAULT_DAY_CONCURRENCY = 4
MIN_CONCURRENCY = 1
MAX_CONCURRENCY = 32

_HHMM = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")
_WINDOW_KEYS = ("start", "end", "timezone")

BackfillWindowName = Literal["night", "day"]


@dataclass(frozen=True, slots=True)
class BackfillWindowLimit:
    window: BackfillWindowName
    limit: int


def is_valid_hhmm(value: object) -> bool:
    return isinstance(value, str) and _HHMM.fullmatch(value) is not None


def is_valid_timezone(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def validate_night_window(value: object) -> dict[str, str]:
    """Return a clean copy of a night window or raise ``ValueError``."""
    if not isinstance(value, Mapping) or set(value) != set(_WINDOW_KEYS):
        raise ValueError("The night window needs start, end and timezone")
    start, end, zone = (value[key] for key in _WINDOW_KEYS)
    if not is_valid_hhmm(start) or not is_valid_hhmm(end):
        raise ValueError("Night window times must use HH:MM")
    if start == end:
        raise ValueError("The night window needs different start and end times")
    if not is_valid_timezone(zone):
        raise ValueError("A valid IANA timezone is required")
    return {"start": start, "end": end, "timezone": zone}


def validate_concurrency(value: object) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not MIN_CONCURRENCY <= value <= MAX_CONCURRENCY
    ):
        raise ValueError(
            f"Concurrency must be between {MIN_CONCURRENCY} and {MAX_CONCURRENCY}"
        )
    return value


def backfill_window_settings(campaign: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return the window settings stored in a campaign, with defaults.

    Stored values are validated when they are written; anything unreadable here
    (an older or hand-edited campaign) falls back to the default window and to
    concurrencies clamped to the allowed range.
    """
    stored = campaign or {}
    try:
        night_window = validate_night_window(stored.get("night_window"))
    except ValueError:
        night_window = dict(DEFAULT_NIGHT_WINDOW)
    return {
        "night_window": night_window,
        "night_concurrency": _bounded(
            stored.get("night_concurrency"), DEFAULT_NIGHT_CONCURRENCY
        ),
        "day_concurrency": _bounded(
            stored.get("day_concurrency"), DEFAULT_DAY_CONCURRENCY
        ),
    }


def merge_backfill_window_settings(
    campaign: Mapping[str, Any] | None,
    *,
    night_window: Mapping[str, Any] | None = None,
    night_concurrency: int | None = None,
    day_concurrency: int | None = None,
) -> dict[str, Any]:
    """Apply explicit settings over the stored ones; omitted settings are kept."""
    settings = backfill_window_settings(campaign)
    if night_window is not None:
        settings["night_window"] = validate_night_window(night_window)
    if night_concurrency is not None:
        settings["night_concurrency"] = validate_concurrency(night_concurrency)
    if day_concurrency is not None:
        settings["day_concurrency"] = validate_concurrency(day_concurrency)
    return settings


def backfill_window_limit(
    campaign: Mapping[str, Any] | None, *, now: datetime | None = None
) -> BackfillWindowLimit:
    """Return the active window and how many backfill analyses may be in flight."""
    settings = backfill_window_settings(campaign)
    if is_night(settings["night_window"], now=now):
        return BackfillWindowLimit("night", settings["night_concurrency"])
    return BackfillWindowLimit("day", settings["day_concurrency"])


def is_night(window: Mapping[str, str], *, now: datetime | None = None) -> bool:
    instant = now or datetime.now(UTC)
    if instant.tzinfo is None:
        raise ValueError("Window evaluation requires an aware instant")
    # Compare local wall-clock minutes so the window follows DST changes.
    local = instant.astimezone(ZoneInfo(window["timezone"]))
    minute = local.hour * 60 + local.minute
    start = _minutes(window["start"])
    end = _minutes(window["end"])
    if start < end:
        return start <= minute < end
    return minute >= start or minute < end


def _minutes(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:])


def _bounded(value: object, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return default
    return max(MIN_CONCURRENCY, min(value, MAX_CONCURRENCY))


__all__ = [
    "BackfillWindowLimit",
    "BackfillWindowName",
    "DEFAULT_DAY_CONCURRENCY",
    "DEFAULT_NIGHT_CONCURRENCY",
    "DEFAULT_NIGHT_WINDOW",
    "MAX_CONCURRENCY",
    "MIN_CONCURRENCY",
    "backfill_window_limit",
    "backfill_window_settings",
    "is_night",
    "is_valid_hhmm",
    "is_valid_timezone",
    "merge_backfill_window_settings",
    "validate_concurrency",
    "validate_night_window",
]
