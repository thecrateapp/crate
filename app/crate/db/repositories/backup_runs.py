"""Writes of backup runs: the backups engine opens and closes one per job (BK1)."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope

RUN_KINDS = frozenset({"dump", "local_retention", "offsite", "verify", "restore_drill"})
FINAL_STATUSES = frozenset({"succeeded", "failed"})
MAX_ERROR_LENGTH = 2000
INTERRUPTED_ERROR = "Interrupted: the worker stopped before the run finished"


def _check_kind(kind: str) -> str:
    if kind not in RUN_KINDS:
        raise ValueError(f"Unknown backup run kind: {kind!r}")
    return kind


def start_backup_run(
    kind: str, *, task_id: str | None = None, session: Session | None = None
) -> str:
    """Open a ``running`` run of ``kind`` and return its id."""
    _check_kind(kind)

    def _impl(current: Session) -> str:
        return str(
            current.execute(
                text(
                    """
                    INSERT INTO backup_runs (kind, status, task_id)
                    VALUES (:kind, 'running', :task_id)
                    RETURNING id::text
                    """
                ),
                {"kind": kind, "task_id": task_id},
            ).scalar_one()
        )

    with optional_scope(session) as current:
        return _impl(current)


def finish_backup_run(
    run_id: str,
    *,
    status: str,
    path: str | None = None,
    size_bytes: int | None = None,
    checksum: str | None = None,
    error: str | None = None,
    details: dict[str, Any] | None = None,
    session: Session | None = None,
) -> bool:
    """Close a running run as ``succeeded`` or ``failed``; False if it was not running."""
    if status not in FINAL_STATUSES:
        raise ValueError(f"A run finishes as succeeded or failed, not {status!r}")
    if error is not None:
        error = error[:MAX_ERROR_LENGTH]

    def _impl(current: Session) -> bool:
        result = current.execute(
            text(
                """
                UPDATE backup_runs
                SET status = :status,
                    finished_at = now(),
                    path = COALESCE(:path, path),
                    bytes = COALESCE(:bytes, bytes),
                    checksum = COALESCE(:checksum, checksum),
                    error = :error,
                    details = details || CAST(:details AS jsonb)
                WHERE id = CAST(:id AS uuid) AND status = 'running'
                RETURNING id
                """
            ),
            {
                "id": run_id,
                "status": status,
                "path": path,
                "bytes": size_bytes,
                "checksum": checksum,
                "error": error,
                "details": json.dumps(details or {}),
            },
        )
        return result.first() is not None

    with optional_scope(session) as current:
        return _impl(current)


def close_interrupted_backup_runs(kind: str, *, session: Session | None = None) -> int:
    """Mark the ``running`` runs of ``kind`` failed.

    Call it only while holding the backup lock: then no run of that kind is alive,
    so any row still running belongs to a worker that was killed.
    """
    _check_kind(kind)

    def _impl(current: Session) -> int:
        result = current.execute(
            text(
                """
                UPDATE backup_runs
                SET status = 'failed', finished_at = now(), error = :error
                WHERE kind = :kind AND status = 'running'
                RETURNING id
                """
            ),
            {"kind": kind, "error": INTERRUPTED_ERROR},
        )
        return len(result.all())

    with optional_scope(session) as current:
        return _impl(current)


__all__ = [
    "FINAL_STATUSES",
    "INTERRUPTED_ERROR",
    "RUN_KINDS",
    "close_interrupted_backup_runs",
    "finish_backup_run",
    "start_backup_run",
]
