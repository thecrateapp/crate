"""Instance-wide listener ranking for Crate Pulse."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.user_stats_periods import (
    StatsPeriod,
    period_day_filter,
    period_params,
)


def get_top_listeners(session, period: StatsPeriod, *, limit: int = 10) -> list[dict]:
    rows = session.execute(
        text(
            f"""
            SELECT u.id AS user_id, u.username, u.name AS display_name, u.avatar,
                   SUM(d.minutes_listened) AS minutes, SUM(d.play_count) AS plays,
                   COUNT(*) AS active_days
            FROM user_daily_listening d
            JOIN users u ON u.id = d.user_id
            WHERE u.pulse_listed
              AND u.status = 'active'
              AND u.deleted_at IS NULL
              AND {period_day_filter(period, "d.day")}
            GROUP BY u.id
            HAVING SUM(d.minutes_listened) > 0
            ORDER BY minutes DESC, u.id
            LIMIT :limit
            """
        ),
        {**period_params(period), "limit": limit},
    ).mappings()
    return [
        {
            **row,
            "minutes": round(float(row["minutes"] or 0), 1),
            "plays": int(row["plays"] or 0),
            "active_days": int(row["active_days"] or 0),
        }
        for row in rows
    ]


__all__ = ["get_top_listeners"]
