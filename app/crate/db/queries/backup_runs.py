"""Reads of backup runs (admin backups, BK1)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

_COLUMNS = """
    id::text AS id, kind, status, task_id, policy_id::text AS policy_id,
    destination_id::text AS destination_id, started_at, finished_at, path,
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
    destination_id: str | None = None,
    policy_id: str | None = None,
    since: datetime | None = None,
    before: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
    session: Session | None = None,
) -> list[dict[str, Any]]:
    """Newest first, optionally of one kind, status, destination, policy or period."""
    bounded = max(1, min(int(limit), MAX_LIST_LIMIT))

    def _impl(current: Session) -> list[dict[str, Any]]:
        rows = current.execute(
            text(
                f"""
                SELECT {_COLUMNS} FROM backup_runs
                WHERE (CAST(:kind AS text) IS NULL OR kind = :kind)
                  AND (CAST(:status AS text) IS NULL OR status = :status)
                  AND (CAST(:destination_id AS uuid) IS NULL
                       OR destination_id = CAST(:destination_id AS uuid))
                  AND (CAST(:policy_id AS uuid) IS NULL
                       OR policy_id = CAST(:policy_id AS uuid))
                  AND (CAST(:since AS timestamptz) IS NULL
                       OR started_at >= CAST(:since AS timestamptz))
                  AND (CAST(:before AS timestamptz) IS NULL
                       OR started_at < CAST(:before AS timestamptz))
                ORDER BY started_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {
                "kind": kind,
                "status": status,
                "destination_id": destination_id,
                "policy_id": policy_id,
                "since": since,
                "before": before,
                "limit": bounded,
                "offset": max(0, int(offset)),
            },
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def latest_successful_dump(*, session: Session | None = None) -> dict[str, Any] | None:
    runs = list_backup_runs(kind="dump", status="succeeded", limit=1, session=session)
    return runs[0] if runs else None


def latest_destination_runs(
    *, session: Session | None = None
) -> dict[str, dict[str, dict[str, Any]]]:
    """Per destination: the latest run of each kind, and the latest successful one.

    ``{destination_id: {"offsite": run, "offsite_succeeded": run, "verify": ...}}``.
    One query over the runs index, for the overview and the scheduler.
    """

    def _impl(current: Session) -> dict[str, dict[str, dict[str, Any]]]:
        rows = current.execute(
            text(
                f"""
                SELECT * FROM (
                    SELECT DISTINCT ON (destination_id, kind)
                        'latest' AS slot, {_COLUMNS}
                    FROM backup_runs
                    WHERE destination_id IS NOT NULL
                    ORDER BY destination_id, kind, started_at DESC, id DESC
                ) latest
                UNION ALL
                SELECT * FROM (
                    SELECT DISTINCT ON (destination_id, kind)
                        'succeeded' AS slot, {_COLUMNS}
                    FROM backup_runs
                    WHERE destination_id IS NOT NULL AND status = 'succeeded'
                    ORDER BY destination_id, kind, started_at DESC, id DESC
                ) succeeded
                """
            )
        ).mappings()
        out: dict[str, dict[str, dict[str, Any]]] = {}
        for row in rows:
            run = dict(row)
            slot = run.pop("slot")
            key = run["kind"] if slot == "latest" else f"{run['kind']}_succeeded"
            out.setdefault(run["destination_id"], {})[key] = run
        return out

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "get_backup_run",
    "latest_destination_runs",
    "latest_successful_dump",
    "list_backup_runs",
]
