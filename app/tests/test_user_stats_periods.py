"""Local-day stats periods."""

from datetime import date

import pytest

from crate.db.queries.user_stats_periods import previous_window, resolve_stats_period

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


def _prev(today, **kwargs):
    return previous_window(resolve_stats_period("UTC", today=today, **kwargs))


def test_previous_window_rolling_is_the_n_days_before_start():
    # 30d at 2026-10-08 covers 09-09..10-08; previous is 08-10..09-08 inclusive.
    assert _prev(TODAY, window="30d") == (date(2026, 8, 10), date(2026, 9, 8))
    assert _prev(TODAY, window="7d") == (date(2026, 9, 25), date(2026, 10, 1))


def test_previous_window_current_month_uses_the_same_elapsed_day():
    assert _prev(TODAY, month="2026-10") == (date(2026, 9, 1), date(2026, 9, 8))


def test_previous_window_current_month_caps_at_previous_month_length():
    assert _prev(date(2026, 3, 31), month="2026-03") == (
        date(2026, 2, 1),
        date(2026, 2, 28),
    )


def test_previous_window_closed_month_is_the_whole_previous_month():
    assert _prev(TODAY, month="2026-03") == (date(2026, 2, 1), date(2026, 2, 28))
    assert _prev(TODAY, month="2026-01") == (date(2025, 12, 1), date(2025, 12, 31))


def test_previous_window_current_year_runs_to_today_minus_one_year():
    assert _prev(TODAY, year=2026) == (date(2025, 1, 1), date(2025, 10, 8))


def test_previous_window_current_year_maps_feb_29_to_feb_28():
    assert _prev(date(2028, 2, 29), year=2028) == (date(2027, 1, 1), date(2027, 2, 28))


def test_previous_window_closed_year_is_the_whole_previous_year():
    assert _prev(TODAY, year=2025) == (date(2024, 1, 1), date(2024, 12, 31))


def test_previous_window_all_time_has_none():
    assert _prev(TODAY, window="all_time") is None
