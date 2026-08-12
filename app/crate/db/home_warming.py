from __future__ import annotations

import logging

from sqlalchemy import text

from crate.db.tx import read_scope

log = logging.getLogger(__name__)


def list_recent_home_user_ids(
    *, window_minutes: int = 30, limit: int = 10
) -> list[int]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT user_id
                FROM sessions
                WHERE revoked_at IS NULL
                  AND expires_at > NOW()
                  AND COALESCE(last_seen_at, created_at) >= NOW() - (:window_minutes * INTERVAL '1 minute')
                GROUP BY user_id
                ORDER BY MAX(COALESCE(last_seen_at, created_at)) DESC
                LIMIT :limit
                """
                ),
                {
                    "window_minutes": max(1, int(window_minutes)),
                    "limit": max(1, min(int(limit), 50)),
                },
            )
            .mappings()
            .all()
        )
    return [int(row["user_id"]) for row in rows if row.get("user_id") is not None]


def warm_recent_home_discovery_snapshots(
    *, window_minutes: int = 30, limit: int = 10
) -> int:
    try:
        user_ids = list_recent_home_user_ids(window_minutes=window_minutes, limit=limit)
    except Exception:
        log.warning("Failed to list recent home users for warming", exc_info=True)
        return 0

    warmed = 0
    for user_id in user_ids:
        try:
            from crate.db.home import get_cached_home_discovery

            get_cached_home_discovery(user_id, fresh=True)
        except Exception:
            log.warning(
                "Failed to warm home discovery snapshot",
                extra={"user_id": user_id},
                exc_info=True,
            )
            continue
        warmed += 1
    return warmed


__all__ = ["list_recent_home_user_ids", "warm_recent_home_discovery_snapshots"]
