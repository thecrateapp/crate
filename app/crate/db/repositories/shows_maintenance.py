from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def delete_past_shows(days_old: int = 30) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_old)).date()
    with transaction_scope() as session:
        result = session.execute(
            text(
                "UPDATE shows SET archived_at=NOW() WHERE date < :cutoff AND archived_at IS NULL"
            ),
            {"cutoff": cutoff},
        )
    return int(getattr(result, "rowcount", 0) or 0)


__all__ = ["delete_past_shows"]
