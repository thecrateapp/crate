from __future__ import annotations

from crate.db.jobs.instance_listening_rollups import queue_instance_listening_rebuild
from crate.db.jobs.user_listening_projections import (
    rebuild_user_listening_projections,
    refresh_user_listening_projections,
    user_listening_projections_pending,
    users_with_dirty_listening_days,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.db.tx import read_scope, transaction_scope


def listening_stats_dedup_key(user_id: int) -> str:
    return f"listening-stats:{user_id}"


def schedule_user_listening_refresh(user_id: int, *, session=None) -> str | None:
    """Queue one refresh per user; the running task releases this key on start."""
    return create_task_dedup(
        "refresh_user_listening_stats",
        {"user_id": user_id},
        dedup_key=listening_stats_dedup_key(user_id),
        session=session,
    )


def schedule_dirty_listening_refreshes() -> list[int]:
    """Queue a refresh for every user whose dirty days no task will drain.

    Play events debounce their refresh, so the last play inside a debounce
    window, or one that lands while the refresh runs, leaves a dirty day
    without a task. This sweep is the trailing edge for those days.
    """
    with read_scope() as session:
        user_ids = users_with_dirty_listening_days(session)
    for user_id in user_ids:
        schedule_user_listening_refresh(user_id)
    return user_ids


def recompute_user_listening_aggregates_in_session(session, user_id: int):
    result = rebuild_user_listening_projections(session, user_id)
    queue_instance_listening_rebuild(result, session=session)
    return result


def recompute_users_listening_aggregates_in_session(
    session, user_ids: list[int]
) -> int:
    """Fully rebuild several users in one transaction, then queue one backfill.

    The backfill is queued after every user projection lock is taken: queuing
    per user would hold its dedup lock while waiting for the next user's lock,
    the reverse of a single user's refresh.
    """
    for user_id in user_ids:
        rebuild_user_listening_projections(session, user_id)
    if user_ids:
        queue_instance_listening_rebuild({"full": True}, session=session)
    return len(user_ids)


def recompute_user_listening_aggregates(user_id: int) -> dict:
    with transaction_scope() as session:
        return recompute_user_listening_aggregates_in_session(session, user_id)


def refresh_user_listening_aggregates(user_id: int) -> dict:
    with transaction_scope() as session:
        result = refresh_user_listening_projections(session, user_id)
        queue_instance_listening_rebuild(result, session=session)
        return result


def ensure_user_listening_aggregates(user_id: int) -> dict | None:
    with read_scope() as session:
        pending = user_listening_projections_pending(session, user_id)
    if not pending:
        return None
    return refresh_user_listening_aggregates(user_id)


__all__ = [
    "ensure_user_listening_aggregates",
    "listening_stats_dedup_key",
    "recompute_user_listening_aggregates",
    "recompute_user_listening_aggregates_in_session",
    "recompute_users_listening_aggregates_in_session",
    "refresh_user_listening_aggregates",
    "schedule_dirty_listening_refreshes",
    "schedule_user_listening_refresh",
]
