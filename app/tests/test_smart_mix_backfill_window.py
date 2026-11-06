from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from crate.smart_mix.backfill_window import (
    DEFAULT_DAY_CONCURRENCY,
    DEFAULT_NIGHT_CONCURRENCY,
    DEFAULT_NIGHT_WINDOW,
    backfill_window_limit,
    backfill_window_settings,
    merge_backfill_window_settings,
)


MADRID = {"start": "01:00", "end": "08:00", "timezone": "Europe/Madrid"}
ACROSS_MIDNIGHT = {"start": "22:00", "end": "06:00", "timezone": "Europe/Madrid"}


def _campaign(window: dict, *, night: int = 8, day: int = 4) -> dict:
    return {
        "status": "running",
        "batch_size": 25,
        "max_attempts": 3,
        "night_window": window,
        "night_concurrency": night,
        "day_concurrency": day,
    }


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=UTC)


@pytest.mark.parametrize(
    ("instant", "window", "expected"),
    [
        # Winter (CET, UTC+1): 01:00-08:00 local is 00:00-07:00 UTC.
        ("2026-01-15T23:59", MADRID, "day"),
        ("2026-01-16T00:00", MADRID, "night"),
        ("2026-01-16T06:30", MADRID, "night"),
        ("2026-01-16T07:00", MADRID, "day"),
        # Summer (CEST, UTC+2): the same local window is 23:00-06:00 UTC.
        ("2026-07-15T22:59", MADRID, "day"),
        ("2026-07-15T23:00", MADRID, "night"),
        ("2026-07-16T05:59", MADRID, "night"),
        ("2026-07-16T06:00", MADRID, "day"),
        ("2026-07-16T06:30", MADRID, "day"),
        # Spring forward, 2026-03-29: 02:00 CET jumps to 03:00 CEST at 01:00 UTC.
        ("2026-03-29T00:59", MADRID, "night"),
        ("2026-03-29T01:00", MADRID, "night"),
        ("2026-03-29T05:59", MADRID, "night"),
        ("2026-03-29T06:00", MADRID, "day"),
        # Fall back, 2026-10-25: 03:00 CEST returns to 02:00 CET at 01:00 UTC.
        ("2026-10-24T22:59", MADRID, "day"),
        ("2026-10-24T23:00", MADRID, "night"),
        ("2026-10-25T06:30", MADRID, "night"),
        ("2026-10-25T06:59", MADRID, "night"),
        ("2026-10-25T07:00", MADRID, "day"),
        # A window that crosses midnight (22:00-06:00 local, winter).
        ("2026-01-15T20:59", ACROSS_MIDNIGHT, "day"),
        ("2026-01-15T21:00", ACROSS_MIDNIGHT, "night"),
        ("2026-01-15T23:30", ACROSS_MIDNIGHT, "night"),
        ("2026-01-16T04:59", ACROSS_MIDNIGHT, "night"),
        ("2026-01-16T05:00", ACROSS_MIDNIGHT, "day"),
        ("2026-01-16T12:00", ACROSS_MIDNIGHT, "day"),
    ],
)
def test_window_follows_local_time_across_midnight_and_dst(
    instant: str, window: dict, expected: str
) -> None:
    limit = backfill_window_limit(_campaign(window, night=8, day=4), now=_utc(instant))

    assert limit.window == expected
    assert limit.limit == (8 if expected == "night" else 4)


def test_window_accepts_any_aware_instant() -> None:
    madrid_winter = timezone(timedelta(hours=1))
    instant = datetime(2026, 1, 16, 1, 0, tzinfo=madrid_winter)

    assert backfill_window_limit(_campaign(MADRID), now=instant).window == "night"
    with pytest.raises(ValueError):
        backfill_window_limit(_campaign(MADRID), now=datetime(2026, 1, 16, 1, 0))


def test_campaigns_saved_without_the_window_use_the_defaults() -> None:
    legacy = {"status": "running", "batch_size": 25, "max_attempts": 3}

    assert backfill_window_settings(legacy) == {
        "night_window": DEFAULT_NIGHT_WINDOW,
        "night_concurrency": DEFAULT_NIGHT_CONCURRENCY,
        "day_concurrency": DEFAULT_DAY_CONCURRENCY,
    }
    assert backfill_window_settings(None) == backfill_window_settings(legacy)
    assert DEFAULT_NIGHT_WINDOW == MADRID
    assert (DEFAULT_NIGHT_CONCURRENCY, DEFAULT_DAY_CONCURRENCY) == (8, 4)
    assert backfill_window_limit(legacy, now=_utc("2026-01-16T00:30")).limit == 8
    assert backfill_window_limit(legacy, now=_utc("2026-01-16T12:00")).limit == 4


def test_corrupt_stored_settings_fall_back_to_bounded_values() -> None:
    stored = {
        "night_window": {"start": "25:00", "end": "08:00", "timezone": "Mars/Base"},
        "night_concurrency": 500,
        "day_concurrency": 0,
    }

    assert backfill_window_settings(stored) == {
        "night_window": DEFAULT_NIGHT_WINDOW,
        "night_concurrency": 32,
        "day_concurrency": 1,
    }


def test_explicit_settings_replace_stored_ones_and_omitted_ones_are_kept() -> None:
    stored = _campaign(ACROSS_MIDNIGHT, night=6, day=2)

    kept = merge_backfill_window_settings(stored)
    changed = merge_backfill_window_settings(
        stored, night_window=MADRID, day_concurrency=3
    )

    assert kept == {
        "night_window": ACROSS_MIDNIGHT,
        "night_concurrency": 6,
        "day_concurrency": 2,
    }
    assert changed == {
        "night_window": MADRID,
        "night_concurrency": 6,
        "day_concurrency": 3,
    }


@pytest.mark.parametrize(
    "changes",
    [
        {"night_window": {"start": "1:00", "end": "08:00", "timezone": "UTC"}},
        {"night_window": {"start": "01:00", "end": "24:00", "timezone": "UTC"}},
        {"night_window": {"start": "01:00", "end": "08:60", "timezone": "UTC"}},
        {"night_window": {"start": "01:00", "end": "01:00", "timezone": "UTC"}},
        {"night_window": {"start": "01:00", "end": "08:00", "timezone": "Mars/Base"}},
        {"night_window": {"start": "01:00", "end": "08:00", "timezone": "../etc"}},
        {"night_window": {"start": "01:00", "end": "08:00"}},
        {"night_concurrency": 0},
        {"day_concurrency": 33},
    ],
)
def test_explicit_settings_are_validated(changes: dict) -> None:
    with pytest.raises(ValueError):
        merge_backfill_window_settings(None, **changes)
