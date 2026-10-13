"""Local-day stats periods."""

from datetime import date

import pytest

from crate.db.queries.user_stats_periods import resolve_stats_period

TODAY = date(2026, 10, 8)


def test_rolling_window_counts_today_as_the_last_day():
    period = resolve_stats_period("Europe/Madrid", window="30d", today=TODAY)
    assert (period.key, period.start, period.end) == ("30d", date(2026, 9, 9), None)
    assert period.previous_start == date(2026, 8, 10)
    assert period.days == 30
    assert period.provisional


def test_calendar_year_is_provisional_until_it_closes():
    current = resolve_stats_period("UTC", year=2026, today=TODAY)
    assert (current.key, current.start, current.end) == (
        "year:2026",
        date(2026, 1, 1),
        date(2027, 1, 1),
    )
    assert current.provisional
    assert not resolve_stats_period("UTC", year=2025, today=TODAY).provisional


def test_month_and_all_time_bounds():
    month = resolve_stats_period("UTC", month="2026-03", today=TODAY)
    assert (month.start, month.end, month.previous_start) == (
        date(2026, 3, 1),
        date(2026, 4, 1),
        date(2026, 2, 1),
    )
    all_time = resolve_stats_period("UTC", window="all_time", today=TODAY)
    assert (all_time.start, all_time.end, all_time.days) == (None, None, None)


@pytest.mark.parametrize("year", [1969, 2027])
def test_rejects_years_outside_the_history(year):
    with pytest.raises(ValueError):
        resolve_stats_period("UTC", year=year, today=TODAY)
