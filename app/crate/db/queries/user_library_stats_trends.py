from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.user_library_shared import normalize_user_stats_window
from crate.db.queries.user_stats_periods import (
    period_day_filter,
    period_params,
    resolve_stats_period,
    user_stats_timezone,
)
from crate.db.tx import read_scope


def get_stats_trend_points(user_id: int, *, day_cutoff: str | None) -> list[dict]:
    with read_scope() as session:
        if day_cutoff is None:
            rows = (
                session.execute(
                    text(
                        """
                    SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                    FROM user_daily_listening
                    WHERE user_id = :user_id
                    ORDER BY day ASC
                    """
                    ),
                    {"user_id": user_id},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        """
                    SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                    FROM user_daily_listening
                    WHERE user_id = :user_id AND day >= :day_cutoff
                    ORDER BY day ASC
                    """
                    ),
                    {"user_id": user_id, "day_cutoff": day_cutoff},
                )
                .mappings()
                .all()
            )
    return [dict(row) for row in rows]


def get_stats_trends(user_id: int, window: str = "30d") -> dict:
    normalized = normalize_user_stats_window(window)
    period = resolve_stats_period(user_stats_timezone(user_id), window=normalized)
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                FROM user_daily_listening
                WHERE user_id = :user_id AND {period_day_filter(period)}
                ORDER BY day ASC
                """
            ),
            {"user_id": user_id, **period_params(period)},
        ).mappings()
        points = [dict(row) for row in rows]
    return {"window": normalized, "points": points}


__all__ = [
    "get_stats_trend_points",
    "get_stats_trends",
]
