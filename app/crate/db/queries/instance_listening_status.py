"""Read-only status probes for the instance listening rollups.

The rollups themselves are written by ``crate.db.jobs.instance_listening_rollups``;
readers such as the range query only need to know whether they cover history.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


def instance_listening_rollups_incomplete(session: Session) -> bool:
    """True while listening exists but the rollups miss its earliest day.

    Incremental tasks only fill recent days, so "has any row" would hide a
    missing backfill. No listening at all leaves nothing to backfill. Both
    lookups are index probes.
    """
    return bool(
        session.execute(
            text(
                """
                SELECT earliest.day IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM instance_track_daily WHERE day = earliest.day
                )
                FROM (SELECT MIN(day) AS day FROM user_track_daily) earliest
                """
            )
        ).scalar()
    )


__all__ = ["instance_listening_rollups_incomplete"]
