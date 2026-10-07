"""Local-day periods for listening stats, resolved in the user's timezone."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import text

from crate.db.queries.user_library_shared import (
    _STATS_WINDOWS,
    normalize_stats_window,
    year_from_window,
)
from crate.db.tx import read_scope


@dataclass(frozen=True)
class StatsPeriod:
    key: str
    start: date | None
    end: date | None
    previous_start: date | None
    timezone: str
    today: date

    @property
    def provisional(self) -> bool:
        return self.end is None or self.today < self.end

    @property
    def days(self) -> int | None:
        if self.start is None:
            return None
        return ((self.end or self.today + timedelta(days=1)) - self.start).days


def user_stats_timezone(user_id: int, *, session=None) -> str:
    def _impl(current) -> str:
        value = current.execute(
            text("SELECT NULLIF(timezone, '') FROM users WHERE id = :user_id"),
            {"user_id": user_id},
        ).scalar_one_or_none()
        return value or "UTC"

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _add_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    return date(month_index // 12, month_index % 12 + 1, 1)


def resolve_stats_period(
    timezone_name: str,
    *,
    window: str = "30d",
    month: str | None = None,
    year: int | None = None,
    today: date | None = None,
) -> StatsPeriod:
    today = today or datetime.now(ZoneInfo(timezone_name)).date()
    if year is None:
        year = year_from_window(window)
    if month:
        try:
            start = date.fromisoformat(f"{month}-01")
        except ValueError as exc:
            raise ValueError(f"Unsupported stats month: {month}") from exc
        return StatsPeriod(
            key=f"month:{month}",
            start=start,
            end=_add_months(start, 1),
            previous_start=_add_months(start, -1),
            timezone=timezone_name,
            today=today,
        )
    if year is not None:
        if year < 1970 or year > today.year:
            raise ValueError(f"Unsupported stats year: {year}")
        return StatsPeriod(
            key=f"year:{year}",
            start=date(year, 1, 1),
            end=date(year + 1, 1, 1),
            previous_start=date(year - 1, 1, 1),
            timezone=timezone_name,
            today=today,
        )
    normalized = normalize_stats_window(window)
    days = _STATS_WINDOWS[normalized]
    if days is None:
        return StatsPeriod(
            key=normalized,
            start=None,
            end=None,
            previous_start=None,
            timezone=timezone_name,
            today=today,
        )
    start = today - timedelta(days=days - 1)
    return StatsPeriod(
        key=normalized,
        start=start,
        end=None,
        previous_start=start - timedelta(days=days),
        timezone=timezone_name,
        today=today,
    )


def period_day_filter(period: StatsPeriod, column: str = "day") -> str:
    clauses = []
    if period.start is not None:
        clauses.append(f"{column} >= :period_start")
    if period.end is not None:
        clauses.append(f"{column} < :period_end")
    return " AND ".join(clauses) if clauses else "TRUE"


def period_params(period: StatsPeriod) -> dict:
    return {
        "period_start": period.start,
        "period_end": period.end,
        "previous_start": period.previous_start,
    }


__all__ = [
    "StatsPeriod",
    "period_day_filter",
    "period_params",
    "resolve_stats_period",
    "user_stats_timezone",
]
