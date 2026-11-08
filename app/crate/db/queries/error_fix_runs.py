"""Reads of error fix runs: the issue detail, the API guards and the tracker."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

OPEN_STATUSES = ("requested", "running", "pr_open")
MAX_RUNS_PER_ISSUE = 5
MAX_TRACKED_RUNS = 20

_RUN_COLUMNS = """
    r.id::text AS id, r.issue_id::text AS issue_id, i.short_id, r.executor, r.status,
    r.repository, r.base_ref, r.external_run_id, r.external_run_url, r.branch,
    r.pr_number, r.pr_url, r.pr_state, r.pr_draft, r.pr_mergeable,
    r.pr_mergeable_state, r.pr_head_sha, r.pr_author, r.pr_labeled, r.ci_state,
    r.requested_by,
    COALESCE(NULLIF(requester.name, ''), requester.username) AS requested_by_name,
    r.requested_at, r.started_at, r.pr_opened_at, r.merge_requested_by,
    COALESCE(NULLIF(approver.name, ''), approver.username) AS merge_requested_by_name,
    r.merge_requested_at, r.merge_sha, r.ready_at, r.finished_at, r.checked_at,
    r.error_code, r.summary, r.cleanup_state, r.created_at, r.updated_at
"""
_RUN_FROM = """
    FROM error_fix_runs r
    JOIN error_issues i ON i.id = r.issue_id
    LEFT JOIN users requester ON requester.id = r.requested_by
    LEFT JOIN users approver ON approver.id = r.merge_requested_by
"""


def _valid_uuid(value: Any) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return None


def get_fix_run(
    run_id: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    valid = _valid_uuid(run_id)
    if valid is None:
        return None
    sql = f"SELECT {_RUN_COLUMNS} {_RUN_FROM} WHERE r.id = CAST(:id AS uuid)"

    def _impl(current: Session) -> dict[str, Any] | None:
        row = current.execute(text(sql), {"id": valid}).mappings().first()
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def fix_runs_for_issue(
    issue_id: str,
    *,
    limit: int = MAX_RUNS_PER_ISSUE,
    session: Session | None = None,
) -> list[dict[str, Any]]:
    """The issue's most recent runs, newest first."""
    valid = _valid_uuid(issue_id)
    if valid is None:
        return []
    sql = f"""
        SELECT {_RUN_COLUMNS} {_RUN_FROM}
        WHERE r.issue_id = CAST(:id AS uuid)
        ORDER BY r.requested_at DESC, r.id
        LIMIT :limit
    """
    params = {"id": valid, "limit": max(1, min(int(limit), MAX_RUNS_PER_ISSUE))}

    def _impl(current: Session) -> list[dict[str, Any]]:
        return [dict(row) for row in current.execute(text(sql), params).mappings()]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


_TRACKABLE = """
    (r.status = ANY(CAST(:open AS text[])) OR r.cleanup_state = 'pending')
"""


def trackable_fix_runs(
    *, limit: int = MAX_TRACKED_RUNS, session: Session | None = None
) -> list[dict[str, Any]]:
    """Runs the tracker must look at: open ones and those with a branch to delete,
    least recently checked first."""
    sql = f"""
        SELECT {_RUN_COLUMNS} {_RUN_FROM}
        WHERE {_TRACKABLE}
        ORDER BY r.checked_at ASC NULLS FIRST, r.requested_at ASC, r.id
        LIMIT :limit
    """
    params = {
        "open": list(OPEN_STATUSES),
        "limit": max(1, min(int(limit), MAX_TRACKED_RUNS)),
    }

    def _impl(current: Session) -> list[dict[str, Any]]:
        return [dict(row) for row in current.execute(text(sql), params).mappings()]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def has_trackable_fix_runs(*, session: Session | None = None) -> bool:
    """Whether the scheduler should queue the tracker at all."""
    sql = f"SELECT EXISTS (SELECT 1 FROM error_fix_runs r WHERE {_TRACKABLE})"

    def _impl(current: Session) -> bool:
        return bool(
            current.execute(text(sql), {"open": list(OPEN_STATUSES)}).scalar_one()
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "MAX_RUNS_PER_ISSUE",
    "MAX_TRACKED_RUNS",
    "OPEN_STATUSES",
    "fix_runs_for_issue",
    "get_fix_run",
    "has_trackable_fix_runs",
    "trackable_fix_runs",
]
