"""Writes of backup runs: the backups engine opens and closes one per job (BK1).

Since BK3 a run can belong to a policy and to a destination. Recovery after a
restart is split the same way: ``close_interrupted_backup_runs`` closes the local
runs (no destination) under the local backup lock, and
``close_interrupted_destination_runs`` closes one destination's runs under that
destination's lock.
"""

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
    kind: str,
    *,
    task_id: str | None = None,
    policy_id: str | None = None,
    destination_id: str | None = None,
    details: dict[str, Any] | None = None,
    session: Session | None = None,
) -> str:
    """Open a ``running`` run of ``kind`` and return its id."""
    _check_kind(kind)

    def _impl(current: Session) -> str:
        return str(
            current.execute(
                text(
                    """
                    INSERT INTO backup_runs
                        (kind, status, task_id, policy_id, destination_id, details)
                    VALUES (:kind, 'running', :task_id, CAST(:policy_id AS uuid),
                            CAST(:destination_id AS uuid), CAST(:details AS jsonb))
                    RETURNING id::text
                    """
                ),
                {
                    "kind": kind,
                    "task_id": task_id,
                    "policy_id": policy_id,
                    "destination_id": destination_id,
                    "details": json.dumps(details or {}),
                },
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
    snapshot_id: str | None = None,
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
                    snapshot_id = COALESCE(:snapshot_id, snapshot_id),
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
                "snapshot_id": snapshot_id,
                "error": error,
                "details": json.dumps(details or {}),
            },
        )
        return result.first() is not None

    with optional_scope(session) as current:
        return _impl(current)


def close_interrupted_backup_runs(kind: str, *, session: Session | None = None) -> int:
    """Mark the ``running`` local runs (no destination) of ``kind`` failed.

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
                WHERE kind = :kind AND status = 'running' AND destination_id IS NULL
                RETURNING id
                """
            ),
            {"kind": kind, "error": INTERRUPTED_ERROR},
        )
        return len(result.all())

    with optional_scope(session) as current:
        return _impl(current)


def close_interrupted_destination_runs(
    destination_id: str, *, session: Session | None = None
) -> int:
    """Mark every ``running`` run of one destination failed, whatever its kind.

    Call it only while holding the destination's lock (``destination_lock_key``).
    """

    def _impl(current: Session) -> int:
        result = current.execute(
            text(
                """
                UPDATE backup_runs
                SET status = 'failed', finished_at = now(), error = :error
                WHERE destination_id = CAST(:destination_id AS uuid)
                  AND status = 'running'
                RETURNING id
                """
            ),
            {"destination_id": destination_id, "error": INTERRUPTED_ERROR},
        )
        return len(result.all())

    with optional_scope(session) as current:
        return _impl(current)


__all__ = [
    "FINAL_STATUSES",
    "INTERRUPTED_ERROR",
    "RUN_KINDS",
    "close_interrupted_backup_runs",
    "close_interrupted_destination_runs",
    "finish_backup_run",
    "start_backup_run",
]
