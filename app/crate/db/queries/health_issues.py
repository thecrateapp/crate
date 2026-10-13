"""Read models for health issues keyed by library entities."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def get_open_issue_counts_for_artists(
    artist_ids: list[int | None], *, session: Session | None = None
) -> dict[int, int]:
    ids = sorted({int(artist_id) for artist_id in artist_ids if artist_id is not None})
    if not ids:
        return {}

    def _impl(current: Session) -> dict[int, int]:
        rows = current.execute(
            text(
                """
                SELECT artist_id, COUNT(*) AS open_count
                FROM health_issues
                WHERE status = 'open' AND artist_id = ANY(:ids)
                GROUP BY artist_id
                """
            ),
            {"ids": ids},
        ).all()
        return {int(row.artist_id): int(row.open_count) for row in rows}

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_open_issue_total(*, session: Session | None = None) -> int:
    def _impl(current: Session) -> int:
        return int(
            current.execute(
                text("SELECT COUNT(*) FROM health_issues WHERE status = 'open'")
            ).scalar_one()
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_health_check_runs(*, session: Session | None = None) -> dict[str, dict]:
    def _impl(current: Session) -> dict[str, dict]:
        rows = (
            current.execute(
                text(
                    "SELECT check_type, last_run_at, duration_ms, issue_count "
                    "FROM health_check_runs"
                )
            )
            .mappings()
            .all()
        )
        return {
            row["check_type"]: {
                "last_run_at": row["last_run_at"].isoformat()
                if row["last_run_at"]
                else None,
                "duration_ms": row["duration_ms"],
                "issue_count": row["issue_count"],
            }
            for row in rows
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "get_health_check_runs",
    "get_open_issue_counts_for_artists",
    "get_open_issue_total",
]
