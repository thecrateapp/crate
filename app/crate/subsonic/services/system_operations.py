"""OpenSubsonic system operations backed by Crate tasks and user records."""

from __future__ import annotations

import json
from typing import Any

from crate.db.queries.tasks import list_tasks
from crate.db.repositories.tasks import create_task
from crate.subsonic.errors import ErrorCode, OpenSubsonicError

_ACTIVE_SCAN_STATUSES = {"pending", "running", "delegated", "completing"}


def scan_status() -> dict[str, int | bool]:
    tasks = list_tasks(task_type="scan", limit=50)
    active = next(
        (task for task in tasks if task.get("status") in _ACTIVE_SCAN_STATUSES), None
    )
    if active:
        return {"scanning": True, "count": _progress_count(active.get("progress"))}

    most_recent = tasks[0] if tasks else None
    count = (
        _progress_count(most_recent.get("progress"))
        if most_recent and most_recent.get("status") == "failed"
        else 0
    )
    return {"scanning": False, "count": count}


def start_scan(user: dict[str, Any]) -> dict[str, int | bool]:
    if user.get("role") not in {"owner", "admin"}:
        raise OpenSubsonicError(
            ErrorCode.NOT_AUTHORIZED, "User is not authorized to start a scan"
        )

    tasks = list_tasks(task_type="scan", limit=50)
    active = next(
        (task for task in tasks if task.get("status") in _ACTIVE_SCAN_STATUSES), None
    )
    if active:
        return {"scanning": True, "count": _progress_count(active.get("progress"))}

    create_task("scan", {})
    return {"scanning": True, "count": 0}


def _progress_count(progress: Any) -> int:
    if isinstance(progress, str):
        try:
            progress = json.loads(progress)
        except (json.JSONDecodeError, TypeError):
            return 0
    if not isinstance(progress, dict):
        return 0
    try:
        return max(0, int(progress.get("done") or 0))
    except (TypeError, ValueError, OverflowError):
        return 0
