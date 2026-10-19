"""Live Smart Mix profile task activity for the admin Analysis view."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


PROFILE_TASK_TYPE = "compute_smart_mix_profile"
RUNNING_LIMIT = 10
RECENT_LIMIT = 8
RECENT_WINDOW_MINUTES = 15
RATE_WINDOW_MINUTES = 10
TASK_LOOKBACK_MINUTES = 60

_ACTIVITY_SQL = text(
    """
    WITH running AS (
        SELECT
            task.id,
            (task.params_json ->> 'track_id')::bigint AS track_id,
            task.started_at
        FROM tasks task
        WHERE task.status = 'running'
          AND task.type = :task_type
        ORDER BY task.started_at
        LIMIT :running_limit
    ),
    finished AS (
        SELECT
            task.id,
            (task.params_json ->> 'track_id')::bigint AS track_id,
            task.status,
            task.result_json,
            task.error,
            task.started_at,
            task.updated_at
        FROM tasks task
        WHERE task.type = :task_type
          AND task.status IN ('completed', 'failed')
          AND task.created_at >= NOW() - make_interval(mins => :lookback_minutes)
          AND task.updated_at >= NOW() - make_interval(mins => :recent_minutes)
    ),
    recent AS (
        SELECT *
        FROM finished
        ORDER BY updated_at DESC
        LIMIT :recent_limit
    )
    SELECT
        (
            SELECT COUNT(*)::int
            FROM tasks task
            WHERE task.status = 'pending'
              AND task.type = :task_type
        ) AS queued,
        (
            SELECT COUNT(*)::int
            FROM finished
            WHERE updated_at >= NOW() - make_interval(mins => :rate_minutes)
        ) AS finished_in_window,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'task_id', running.id,
                        'track_id', running.track_id,
                        'title', track.title,
                        'artist', track.artist,
                        'album', track.album,
                        'started_at', running.started_at,
                        'elapsed_ms', ROUND(
                            EXTRACT(EPOCH FROM NOW() - running.started_at) * 1000
                        )
                    )
                    ORDER BY running.started_at
                )
                FROM running
                LEFT JOIN library_tracks track ON track.id = running.track_id
            ),
            '[]'::jsonb
        ) AS running,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'task_id', recent.id,
                        'track_id', recent.track_id,
                        'title', track.title,
                        'artist', track.artist,
                        'album', track.album,
                        'task_status', recent.status,
                        'outcome', recent.result_json ->> 'outcome',
                        'quality', recent.result_json ->> 'quality',
                        'error', COALESCE(recent.result_json ->> 'error', recent.error),
                        'finished_at', recent.updated_at,
                        'duration_ms', ROUND(
                            EXTRACT(EPOCH FROM recent.updated_at - recent.started_at)
                            * 1000
                        )
                    )
                    ORDER BY recent.updated_at DESC
                )
                FROM recent
                LEFT JOIN library_tracks track ON track.id = recent.track_id
            ),
            '[]'::jsonb
        ) AS recent
    """
)


def get_smart_mix_activity(*, session: Session | None = None) -> dict:
    params = {
        "task_type": PROFILE_TASK_TYPE,
        "running_limit": RUNNING_LIMIT,
        "recent_limit": RECENT_LIMIT,
        "recent_minutes": RECENT_WINDOW_MINUTES,
        "rate_minutes": RATE_WINDOW_MINUTES,
        "lookback_minutes": TASK_LOOKBACK_MINUTES,
    }

    def _impl(current: Session) -> dict:
        row = current.execute(_ACTIVITY_SQL, params).mappings().one()
        finished = int(row["finished_in_window"])
        return {
            "queued": int(row["queued"]),
            "running": list(row["running"]),
            "recent": [_with_outcome(item) for item in row["recent"]],
            "tracks_per_minute": round(finished / RATE_WINDOW_MINUTES, 2),
            "rate_window_minutes": RATE_WINDOW_MINUTES,
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _with_outcome(item: dict) -> dict:
    if item.get("task_status") == "failed" or item.get("error"):
        outcome = "failed"
    else:
        outcome = item.get("outcome") or "completed"
    return {**item, "outcome": outcome}


__all__ = ["get_smart_mix_activity"]
