"""Health issue maintenance writes used by the health check and the admin API."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import cast

from sqlalchemy import text
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope


def record_health_check_runs(
    issue_counts: dict[str, int],
    duration_ms: int,
    *,
    session: Session | None = None,
) -> None:
    if not issue_counts:
        return
    now = datetime.now(timezone.utc)

    def _impl(current: Session) -> None:
        current.execute(
            text(
                """
                INSERT INTO health_check_runs (check_type, last_run_at, duration_ms, issue_count)
                SELECT check_type, :now, :duration_ms, issue_count
                FROM unnest(CAST(:check_types AS text[]), CAST(:issue_counts AS integer[]))
                     AS runs(check_type, issue_count)
                ON CONFLICT (check_type) DO UPDATE
                SET last_run_at = EXCLUDED.last_run_at,
                    duration_ms = EXCLUDED.duration_ms,
                    issue_count = EXCLUDED.issue_count
                """
            ),
            {
                "now": now,
                "duration_ms": duration_ms,
                "check_types": list(issue_counts),
                "issue_counts": list(issue_counts.values()),
            },
        )

    with optional_scope(session) as current:
        _impl(current)


def dismiss_issues_by_type(check_type: str, *, session: Session | None = None) -> int:
    now = datetime.now(timezone.utc)

    def _impl(current: Session) -> int:
        result = current.execute(
            text(
                """
                UPDATE health_issues SET status = 'dismissed', resolved_at = :now
                WHERE check_type = :check_type AND status = 'open'
                """
            ),
            {"now": now, "check_type": check_type},
        )
        return int(cast(CursorResult, result).rowcount or 0)

    with optional_scope(session) as current:
        return _impl(current)


__all__ = ["dismiss_issues_by_type", "record_health_check_runs"]
