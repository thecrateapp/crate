from __future__ import annotations

from crate.db.jobs.instance_listening_rollups import queue_instance_listening_rebuild
from crate.db.jobs.user_listening_projections import (
    rebuild_user_listening_projections,
    refresh_user_listening_projections,
    user_listening_projections_pending,
)
from crate.db.tx import read_scope, transaction_scope


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
    "recompute_user_listening_aggregates",
    "recompute_user_listening_aggregates_in_session",
    "recompute_users_listening_aggregates_in_session",
    "refresh_user_listening_aggregates",
]
