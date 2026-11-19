from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.repositories.tasks import create_task
from crate.db.tx import optional_scope

USER_DATA_EXPORT_TASK_TYPE = "export_user_data"
USER_DATA_EXPORT_PENDING_WINDOW = timedelta(hours=1)

_EXPORT_COLUMNS = """
    id, user_id, status, task_id, filename, bytes, error,
    created_at, completed_at, expires_at
"""


def queue_user_data_export(user_id: int, *, session=None) -> tuple[dict, bool]:
    now = datetime.now(timezone.utc)

    def _impl(s) -> tuple[dict, bool]:
        s.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
            {"lock_key": f"user_data_export:{user_id}"},
        )
        pending = (
            s.execute(
                text(
                    f"""
                    SELECT {_EXPORT_COLUMNS}
                    FROM user_data_exports
                    WHERE user_id = :user_id
                      AND status = 'pending'
                      AND created_at > :since
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                {"user_id": user_id, "since": now - USER_DATA_EXPORT_PENDING_WINDOW},
            )
            .mappings()
            .first()
        )
        if pending is not None:
            return dict(pending), False

        export_id = uuid.uuid4().hex
        task_id = create_task(
            USER_DATA_EXPORT_TASK_TYPE,
            {"export_id": export_id, "user_id": user_id},
            session=s,
        )
        row = (
            s.execute(
                text(
                    f"""
                    INSERT INTO user_data_exports (id, user_id, status, task_id, created_at)
                    VALUES (:id, :user_id, 'pending', :task_id, :now)
                    RETURNING {_EXPORT_COLUMNS}
                    """
                ),
                {"id": export_id, "user_id": user_id, "task_id": task_id, "now": now},
            )
            .mappings()
            .one()
        )
        return dict(row), True

    with optional_scope(session) as s:
        return _impl(s)


def mark_user_data_export_ready(
    export_id: str,
    *,
    filename: str,
    size_bytes: int,
    expires_at: datetime,
    session=None,
) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    f"""
                    UPDATE user_data_exports
                    SET status = 'ready',
                        filename = :filename,
                        bytes = :bytes,
                        error = NULL,
                        completed_at = now(),
                        expires_at = :expires_at
                    WHERE id = :id AND status = 'pending'
                    RETURNING {_EXPORT_COLUMNS}
                    """
                ),
                {
                    "id": export_id,
                    "filename": filename,
                    "bytes": size_bytes,
                    "expires_at": expires_at,
                },
            )
            .mappings()
            .first()
        )
        return dict(row) if row is not None else None


def mark_user_data_export_failed(export_id: str, error: str, *, session=None) -> None:
    with optional_scope(session) as s:
        s.execute(
            text(
                """
                UPDATE user_data_exports
                SET status = 'failed', error = :error, completed_at = now()
                WHERE id = :id AND status = 'pending'
                """
            ),
            {"id": export_id, "error": error[:500]},
        )


def expire_user_data_exports(
    *,
    user_id: int | None = None,
    keep_export_id: str | None = None,
    now: datetime | None = None,
    session=None,
) -> list[str]:
    checked_at = now or datetime.now(timezone.utc)
    if user_id is None:
        where = "status = 'ready' AND expires_at <= :now"
    else:
        where = (
            "user_id = :user_id AND status IN ('pending', 'ready')"
            " AND (CAST(:keep_id AS TEXT) IS NULL OR id <> :keep_id)"
        )
    with optional_scope(session) as s:
        rows = s.execute(
            text(
                f"""
                UPDATE user_data_exports
                SET status = 'expired',
                    expires_at = LEAST(COALESCE(expires_at, :now), :now)
                WHERE {where}
                RETURNING id
                """
            ),
            {"now": checked_at, "user_id": user_id, "keep_id": keep_export_id},
        ).scalars()
        return [str(row) for row in rows]


def fail_stale_user_data_exports(*, now: datetime | None = None, session=None) -> int:
    checked_at = now or datetime.now(timezone.utc)
    with optional_scope(session) as s:
        result = s.execute(
            text(
                """
                UPDATE user_data_exports
                SET status = 'failed', error = 'Export did not finish', completed_at = :now
                WHERE status = 'pending' AND created_at <= :since
                """
            ),
            {"now": checked_at, "since": checked_at - USER_DATA_EXPORT_PENDING_WINDOW},
        )
        return int(getattr(result, "rowcount", 0) or 0)


__all__ = [
    "USER_DATA_EXPORT_PENDING_WINDOW",
    "USER_DATA_EXPORT_TASK_TYPE",
    "expire_user_data_exports",
    "fail_stale_user_data_exports",
    "mark_user_data_export_failed",
    "mark_user_data_export_ready",
    "queue_user_data_export",
]
