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
    "refresh_user_listening_aggregates",
]
