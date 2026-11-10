"""Reads of backup runs (admin backups, BK1)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

_COLUMNS = """
    id::text AS id, kind, status, task_id, started_at, finished_at, path,
    bytes, checksum, snapshot_id, error, details
"""
MAX_LIST_LIMIT = 200


def get_backup_run(
    run_id: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    try:
        valid = str(uuid.UUID(str(run_id)))
    except ValueError:
        return None

    def _impl(current: Session) -> dict[str, Any] | None:
        row = (
            current.execute(
                text(
                    f"SELECT {_COLUMNS} FROM backup_runs WHERE id = CAST(:id AS uuid)"
                ),
                {"id": valid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def list_backup_runs(
    *,
    kind: str | None = None,
    status: str | None = None,
    limit: int = 50,
    session: Session | None = None,
) -> list[dict[str, Any]]:
    """Newest first, optionally of one kind and status."""
    bounded = max(1, min(int(limit), MAX_LIST_LIMIT))

    def _impl(current: Session) -> list[dict[str, Any]]:
        rows = current.execute(
            text(
                f"""
                SELECT {_COLUMNS} FROM backup_runs
                WHERE (CAST(:kind AS text) IS NULL OR kind = :kind)
                  AND (CAST(:status AS text) IS NULL OR status = :status)
                ORDER BY started_at DESC, id DESC
                LIMIT :limit
                """
            ),
            {"kind": kind, "status": status, "limit": bounded},
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def latest_successful_dump(*, session: Session | None = None) -> dict[str, Any] | None:
    runs = list_backup_runs(kind="dump", status="succeeded", limit=1, session=session)
    return runs[0] if runs else None


__all__ = ["get_backup_run", "latest_successful_dump", "list_backup_runs"]
