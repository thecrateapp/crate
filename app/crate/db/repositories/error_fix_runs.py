"""Writes for error fix runs (`error_fix_runs`). Only worker tasks call these.

Status changes are compare-and-set on the status the caller read, so the tracker
and a person's Approve & merge or Discard never overwrite each other: the loser
sees `False` and reads the run again. The lifecycle rules live in
`crate.error_inbox.fix_runs`; nothing here calls GitHub.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any, cast

from sqlalchemy import text
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope

OPEN_STATUSES = ("requested", "running", "pr_open")
# Columns a status change or a refresh may set; anything else is refused.
UPDATABLE_COLUMNS = frozenset(
    {
        "status",
        "external_run_id",
        "external_run_url",
        "branch",
        "pr_number",
        "pr_url",
        "pr_state",
        "pr_draft",
        "pr_mergeable",
        "pr_mergeable_state",
        "pr_head_sha",
        "pr_author",
        "pr_labeled",
        "ci_state",
        "started_at",
        "pr_opened_at",
        "merge_requested_by",
        "merge_requested_at",
        "merge_sha",
        "ready_at",
        "finished_at",
        "checked_at",
        "error_code",
        "summary",
        "cleanup_state",
    }
)
FIX_RUN_AUDIT_ACTIONS = frozenset(
    {
        "error_issue.fix.merge_approved",
        "error_issue.fix.merged",
        "error_issue.fix.discarded",
    }
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid(value: str) -> str:
    return str(uuid.UUID(str(value)))


def start_fix_run(
    issue_id: str,
    *,
    user_id: int | None,
    executor: str,
    repository: str,
    base_ref: str | None,
    at: datetime | None = None,
    cooldown: timedelta | None = None,
    session: Session | None = None,
) -> dict[str, Any]:
    """Claim the issue for Launch fix and open a run, in one transaction.

    Returns `{"run_id", "previous_at", "previous_by"}`, or `{"refused": reason}` with
    `not_found`, `recently_requested` (a fix was requested within `cooldown`) or
    `in_progress` (the issue still has an open run). Locking the issue row
    serializes two launches of the same issue.
    """
    stamp = at or _now()
    with optional_scope(session) as current:
        issue = (
            current.execute(
                text(
                    """
                    SELECT fix_requested_at, fix_requested_by
                    FROM error_issues
                    WHERE id = CAST(:id AS uuid)
                    FOR UPDATE
                    """
                ),
                {"id": _uuid(issue_id)},
            )
            .mappings()
            .first()
        )
        if issue is None:
            return {"refused": "not_found"}
        previous_at = issue["fix_requested_at"]
        if (
            cooldown is not None
            and previous_at is not None
            and previous_at > stamp - cooldown
        ):
            return {"refused": "recently_requested"}
        open_run = current.execute(
            text(
                """
                SELECT 1 FROM error_fix_runs
                WHERE issue_id = CAST(:id AS uuid)
                  AND status = ANY(CAST(:open AS text[]))
                LIMIT 1
                """
            ),
            {"id": _uuid(issue_id), "open": list(OPEN_STATUSES)},
        ).first()
        if open_run is not None:
            return {"refused": "in_progress"}
        current.execute(
            text(
                """
                UPDATE error_issues
                SET fix_requested_at = :at, fix_requested_by = :user_id
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": _uuid(issue_id), "at": stamp, "user_id": user_id},
        )
        run_id = current.execute(
            text(
                """
                INSERT INTO error_fix_runs (
                    issue_id, executor, status, repository, base_ref,
                    requested_by, requested_at, created_at, updated_at
                ) VALUES (
                    CAST(:id AS uuid), :executor, 'requested', :repository, :base_ref,
                    :user_id, :at, :at, :at
                )
                RETURNING id::text
                """
            ),
            {
                "id": _uuid(issue_id),
                "executor": executor,
                "repository": repository,
                "base_ref": base_ref,
                "user_id": user_id,
                "at": stamp,
            },
        ).scalar_one()
        return {
            "run_id": run_id,
            "previous_at": previous_at,
            "previous_by": issue["fix_requested_by"],
        }


def update_fix_run(
    run_id: str,
    changes: Mapping[str, Any],
    *,
    expected_status: str | None = None,
    at: datetime | None = None,
    session: Session | None = None,
) -> bool:
    """Set `changes` on a run, only while its status is `expected_status` when given.

    Returns False when the run is gone or its status moved on meanwhile.
    """
    unknown = set(changes) - UPDATABLE_COLUMNS
    if unknown:
        raise ValueError(f"Unknown fix run columns: {sorted(unknown)}")
    if not changes:
        return False
    assignments = ", ".join(f"{column} = :{column}" for column in sorted(changes))
    params: dict[str, Any] = {
        **changes,
        "id": _uuid(run_id),
        "expected": expected_status,
        "updated_at": at or _now(),
    }
    with optional_scope(session) as current:
        result = current.execute(
            text(
                f"""
                UPDATE error_fix_runs
                SET {assignments}, updated_at = :updated_at
                WHERE id = CAST(:id AS uuid)
                  AND (CAST(:expected AS text) IS NULL OR status = :expected)
                """
            ),
            params,
        )
        return cast(CursorResult, result).rowcount == 1


def record_merge_approval(
    run_id: str,
    *,
    user_id: int,
    head_sha: str,
    ready_at: datetime | None,
    at: datetime | None = None,
    session: Session | None = None,
) -> bool:
    """A person approved merging `head_sha`. Only once, while the PR is open there."""
    stamp = at or _now()
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                UPDATE error_fix_runs
                SET merge_requested_by = :user_id,
                    merge_requested_at = :at,
                    merge_sha = :sha,
                    ready_at = :ready_at,
                    error_code = NULL,
                    updated_at = :at
                WHERE id = CAST(:id AS uuid)
                  AND status = 'pr_open'
                  AND merge_requested_at IS NULL
                  AND pr_head_sha = :sha
                """
            ),
            {
                "id": _uuid(run_id),
                "user_id": user_id,
                "sha": head_sha,
                "ready_at": ready_at,
                "at": stamp,
            },
        )
        return cast(CursorResult, result).rowcount == 1


def clear_merge_approval(
    run_id: str,
    *,
    error_code: str | None,
    summary: str | None,
    at: datetime | None = None,
    session: Session | None = None,
) -> bool:
    """Drop an approval that can no longer be honoured, saying why."""
    stamp = at or _now()
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                UPDATE error_fix_runs
                SET merge_requested_by = NULL,
                    merge_requested_at = NULL,
                    merge_sha = NULL,
                    ready_at = NULL,
                    error_code = :error_code,
                    summary = :summary,
                    updated_at = :at
                WHERE id = CAST(:id AS uuid) AND merge_requested_at IS NOT NULL
                """
            ),
            {
                "id": _uuid(run_id),
                "error_code": error_code,
                "summary": summary,
                "at": stamp,
            },
        )
        return cast(CursorResult, result).rowcount == 1


def audit_fix_run(
    run_id: str,
    *,
    action: str,
    actor_id: int | None,
    details: Mapping[str, Any],
    task_id: str | None = None,
    at: datetime | None = None,
    session: Session | None = None,
) -> bool:
    """Audit a review action on a run, named after its issue's short id.

    `details` carries ids, the pull request number and commit, never event text.
    """
    if action not in FIX_RUN_AUDIT_ACTIONS:
        raise ValueError(f"Unknown fix run audit action: {action}")
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                INSERT INTO audit_log
                    (timestamp, action, target_type, target_name, details_json,
                     user_id, task_id)
                SELECT :ts, :action, 'error_issue', i.short_id,
                       CAST(:details AS jsonb), :user_id, :task_id
                FROM error_fix_runs r
                JOIN error_issues i ON i.id = r.issue_id
                WHERE r.id = CAST(:id AS uuid)
                """
            ),
            {
                "id": _uuid(run_id),
                "ts": at or _now(),
                "action": action,
                "details": json.dumps(dict(details), separators=(",", ":")),
                "user_id": actor_id,
                "task_id": task_id,
            },
        )
        return cast(CursorResult, result).rowcount == 1


__all__ = [
    "FIX_RUN_AUDIT_ACTIONS",
    "OPEN_STATUSES",
    "UPDATABLE_COLUMNS",
    "audit_fix_run",
    "clear_merge_approval",
    "record_merge_approval",
    "start_fix_run",
    "update_fix_run",
]
