"""Early skips of radio and path plays within a bounded, indexed time window."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text

from crate.db.tx import read_scope

SURFACES = ("radio", "path")


def get_early_skip_counts(
    since: datetime, until: datetime, *, early_seconds: float, session=None
) -> dict[str, dict[str, int]]:
    def _impl(current) -> dict[str, dict[str, int]]:
        rows = current.execute(
            text(
                """
                SELECT play_source_type AS surface,
                       count(*) AS delivered,
                       count(*) FILTER (
                           WHERE was_skipped AND played_seconds < :early_seconds
                       ) AS early_skips
                FROM user_play_events
                WHERE created_at >= :since
                  AND created_at < :until
                  AND play_source_type = ANY(:surfaces)
                GROUP BY play_source_type
                """
            ),
            {
                "since": since,
                "until": until,
                "early_seconds": early_seconds,
                "surfaces": list(SURFACES),
            },
        ).mappings()
        counts = {surface: {"delivered": 0, "early_skips": 0} for surface in SURFACES}
        for row in rows:
            counts[row["surface"]] = {
                "delivered": int(row["delivered"]),
                "early_skips": int(row["early_skips"]),
            }
        return counts

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["SURFACES", "get_early_skip_counts"]
