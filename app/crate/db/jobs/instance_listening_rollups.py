"""Instance-wide listening rollups summed from every listener's projections.

``instance_track_daily`` is ``user_track_daily`` summed across users (days stay
user-local, the same semantics as the instance tape) and
``instance_entity_firsts`` holds the first day anyone on the instance played
an artist, album or track. A user refresh enqueues a deduplicated
``rebuild_instance_listening_days`` task for the days it rebuilt; a full user
rebuild, a deleted listener, or rollups that never covered history enqueue the
full ``backfill_instance_listening_rollups``. Both run ``rebuild_instance_listening``,
whose ``days=None`` path is the reference result for the incremental one.
"""

from __future__ import annotations

import hashlib
from datetime import date

from sqlalchemy import text

from crate.db.repositories.tasks import create_task_dedup, release_task_dedup_key
from crate.db.tx import read_scope, transaction_scope

DAYS_TASK_TYPE = "rebuild_instance_listening_days"
BACKFILL_TASK_TYPE = "backfill_instance_listening_rollups"
BACKFILL_DEDUP_KEY = "instance-listening-backfill"
_ENTITY_TYPES = ("artist", "album", "track")


def _lock_instance_rollups(session) -> None:
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('instance_listening_rollups'))")
    )


def rebuild_instance_listening_days(session, days: list[date] | None) -> int:
    """Rebuild ``instance_track_daily`` for ``days`` (``None`` = all days)."""
    if days is not None and not days:
        return 0
    _lock_instance_rollups(session)
    day_filter = "" if days is None else " WHERE day = ANY(:days)"
    params = {"days": days}
    session.execute(text(f"DELETE FROM instance_track_daily{day_filter}"), params)
    result = session.execute(
        text(
            f"""
            INSERT INTO instance_track_daily (
                day, entity_key, artist, album, track_id, global_track_uid,
                track_entity_uid, track_path, title, genre, play_count,
                complete_play_count, skip_count, minutes_listened, listener_count
            )
            SELECT
                day,
                entity_key,
                artist,
                album,
                MAX(track_id),
                MAX(global_track_uid::text)::uuid,
                MAX(track_entity_uid::text)::uuid,
                MAX(track_path),
                MAX(title),
                MAX(genre),
                SUM(play_count)::INTEGER,
                SUM(complete_play_count)::INTEGER,
                SUM(skip_count)::INTEGER,
                SUM(minutes_listened),
                COUNT(DISTINCT user_id)::INTEGER
            FROM user_track_daily{day_filter}
            GROUP BY day, entity_key, artist, album
            """
        ),
        params,
    )
    return int(result.rowcount or 0)


def rebuild_instance_entity_firsts(session, keys: dict[str, list[str]] | None) -> int:
    """Rebuild instance firsts for ``keys`` per entity type (``None`` = all).

    A key no listener has any more is deleted and not re-inserted.
    """
    _lock_instance_rollups(session)
    if keys is None:
        return _replace_instance_firsts(session, "", {})
    inserted = 0
    for entity_type in _ENTITY_TYPES:
        entity_keys = sorted(set(keys.get(entity_type) or []))
        if entity_keys:
            inserted += _replace_instance_firsts(
                session,
                " WHERE entity_type = :entity_type AND entity_key = ANY(:keys)",
                {"entity_type": entity_type, "keys": entity_keys},
            )
    return inserted


def _replace_instance_firsts(session, where_sql: str, params: dict) -> int:
    session.execute(text(f"DELETE FROM instance_entity_firsts{where_sql}"), params)
    result = session.execute(
        text(
            f"""
            INSERT INTO instance_entity_firsts (
                entity_type, entity_key, artist, album, first_day
            )
            SELECT entity_type, entity_key, MAX(artist), MAX(album), MIN(first_day)
            FROM user_entity_firsts{where_sql}
            GROUP BY entity_type, entity_key
            """
        ),
        params,
    )
    return int(result.rowcount or 0)


def _instance_day_keys(session, days: list[date]) -> dict[str, set[str]]:
    rows = session.execute(
        text(
            """
            SELECT DISTINCT entity_key, artist, album
            FROM instance_track_daily
            WHERE day = ANY(:days)
            """
        ),
        {"days": days},
    ).all()
    return {
        "track": {row.entity_key for row in rows},
        "artist": {row.artist for row in rows},
        "album": {f"{row.artist}||{row.album}" for row in rows},
    }


def rebuild_instance_listening(
    days: list[date] | None,
    keys: dict[str, list[str]] | None = None,
    *,
    task_id: str | None = None,
) -> dict:
    """Run one instance rebuild task: ``days=None`` rebuilds everything.

    The firsts are refreshed for ``keys`` plus every key on those days before
    and after the rebuild, so a task shared by several listeners (dedup keeps
    the first one's params) still covers keys only the others touched.
    """
    if task_id:
        release_task_dedup_key(task_id)
    with transaction_scope() as session:
        _lock_instance_rollups(session)
        if days is None:
            track_rows = rebuild_instance_listening_days(session, None)
            firsts = rebuild_instance_entity_firsts(session, None)
        else:
            before = _instance_day_keys(session, days)
            track_rows = rebuild_instance_listening_days(session, days)
            after = _instance_day_keys(session, days)
            touched = {
                entity_type: sorted(
                    set((keys or {}).get(entity_type) or [])
                    | before[entity_type]
                    | after[entity_type]
                )
                for entity_type in _ENTITY_TYPES
            }
            firsts = rebuild_instance_entity_firsts(session, touched)
    return {"track_rows": track_rows, "firsts": firsts}


def instance_listening_days_dedup_key(days: list[str]) -> str:
    digest = hashlib.sha1(",".join(sorted(days)).encode()).hexdigest()
    return f"instance-listening-days:{digest}"


def queue_instance_listening_rebuild(result: dict, *, session=None) -> str | None:
    """Enqueue the instance rebuild a user projection refresh calls for.

    Pass the refresh's ``session`` so the task row commits with the rebuilt
    days and is dispatched only after that commit.
    """
    if result.get("full"):
        return create_task_dedup(
            BACKFILL_TASK_TYPE, {}, dedup_key=BACKFILL_DEDUP_KEY, session=session
        )
    days = sorted(result.get("days") or [])
    if not days:
        return None
    return create_task_dedup(
        DAYS_TASK_TYPE,
        {"days": days, "keys": result.get("keys") or {}},
        dedup_key=instance_listening_days_dedup_key(days),
        session=session,
    )


def queue_instance_listening_backfill_for_removed_user(
    session, user_id: int
) -> str | None:
    """Queue the full rebuild that drops a user's share of the rollups.

    Call it in the transaction that deletes the user, before the delete
    cascades their projections away; users without listening queue nothing.
    """
    has_listening = session.execute(
        text("SELECT EXISTS (SELECT 1 FROM user_track_daily WHERE user_id = :user_id)"),
        {"user_id": user_id},
    ).scalar()
    if not has_listening:
        return None
    return queue_instance_listening_rebuild({"full": True}, session=session)


def instance_listening_rollups_incomplete(session) -> bool:
    """True while listening exists but the rollups miss its earliest day.

    Incremental tasks only fill recent days, so "has any row" would hide a
    missing backfill. No listening at all leaves nothing to backfill. Both
    lookups are index probes.
    """
    return bool(
        session.execute(
            text(
                """
                SELECT earliest.day IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM instance_track_daily WHERE day = earliest.day
                )
                FROM (SELECT MIN(day) AS day FROM user_track_daily) earliest
                """
            )
        ).scalar()
    )


def queue_instance_listening_backfill_if_needed() -> str | None:
    with read_scope() as session:
        needed = instance_listening_rollups_incomplete(session)
    if not needed:
        return None
    return create_task_dedup(BACKFILL_TASK_TYPE, {}, dedup_key=BACKFILL_DEDUP_KEY)


__all__ = [
    "BACKFILL_DEDUP_KEY",
    "BACKFILL_TASK_TYPE",
    "DAYS_TASK_TYPE",
    "instance_listening_days_dedup_key",
    "instance_listening_rollups_incomplete",
    "queue_instance_listening_backfill_for_removed_user",
    "queue_instance_listening_backfill_if_needed",
    "queue_instance_listening_rebuild",
    "rebuild_instance_entity_firsts",
    "rebuild_instance_listening",
    "rebuild_instance_listening_days",
]
