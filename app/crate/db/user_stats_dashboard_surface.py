"""Persisted, stale-first per-user stats dashboard projections."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.queries.user_library import (
    get_replay_mix,
    get_stats_overview,
    get_stats_story,
    get_stats_trends,
    get_top_albums,
    get_top_artists,
    get_top_genres,
    get_top_tracks,
)
from crate.db.queries.user_library_stats_month import (
    get_month_replay_mix,
    get_month_stats_overview,
    get_month_stats_trends,
    get_month_top_albums,
    get_month_top_artists,
    get_month_top_genres,
    get_month_top_tracks,
    month_period_key,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.db.tx import read_scope
from crate.db.ui_snapshot_reads import get_ui_snapshot
from crate.db.ui_snapshot_shared import decorate_snapshot
from crate.db.ui_snapshot_writes import upsert_ui_snapshot

_MAX_AGE_SECONDS = 300
_STALE_MAX_AGE_SECONDS = 86_400
_DEFAULT_LIMITS = {
    "tracks_limit": 12,
    "artists_limit": 10,
    "albums_limit": 12,
    "genres_limit": 10,
    "replay_limit": 36,
}


def stats_dashboard_subject_key(
    user_id: int,
    *,
    window: str,
    month: str | None,
    tracks_limit: int,
    artists_limit: int,
    albums_limit: int,
    genres_limit: int,
    replay_limit: int,
) -> str:
    period = month_period_key(month) if month else window
    return (
        f"user:{user_id}:{period}:{month or 'default'}:{tracks_limit}:"
        f"{artists_limit}:{albums_limit}:{genres_limit}:{replay_limit}"
    )


def build_user_stats_dashboard(
    *,
    user_id: int,
    window: str,
    month: str | None,
    tracks_limit: int,
    artists_limit: int,
    albums_limit: int,
    genres_limit: int,
    replay_limit: int,
) -> dict[str, Any]:
    period = month_period_key(month) if month else window
    if month:
        return {
            "window": period,
            "overview": get_month_stats_overview(user_id, month),
            "trends": get_month_stats_trends(user_id, month),
            "top_tracks": {
                "window": period,
                "items": get_month_top_tracks(user_id, month, limit=tracks_limit),
            },
            "top_artists": {
                "window": period,
                "items": get_month_top_artists(user_id, month, limit=artists_limit),
            },
            "top_albums": {
                "window": period,
                "items": get_month_top_albums(user_id, month, limit=albums_limit),
            },
            "top_genres": {
                "window": period,
                "items": get_month_top_genres(user_id, month, limit=genres_limit),
            },
            "replay": get_month_replay_mix(user_id, month, limit=replay_limit),
            "story": get_stats_story(user_id, window=window, month=month),
        }
    return {
        "window": window,
        "overview": get_stats_overview(user_id, window=window),
        "trends": get_stats_trends(user_id, window=window),
        "top_tracks": {
            "window": window,
            "items": get_top_tracks(user_id, window=window, limit=tracks_limit),
        },
        "top_artists": {
            "window": window,
            "items": get_top_artists(user_id, window=window, limit=artists_limit),
        },
        "top_albums": {
            "window": window,
            "items": get_top_albums(user_id, window=window, limit=albums_limit),
        },
        "top_genres": {
            "window": window,
            "items": get_top_genres(user_id, window=window, limit=genres_limit),
        },
        "replay": get_replay_mix(user_id, window=window, limit=replay_limit),
        "story": get_stats_story(user_id, window=window),
    }


def _projection_params(
    user_id: int,
    *,
    window: str,
    month: str | None,
    tracks_limit: int,
    artists_limit: int,
    albums_limit: int,
    genres_limit: int,
    replay_limit: int,
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "window": window,
        "month": month,
        "tracks_limit": tracks_limit,
        "artists_limit": artists_limit,
        "albums_limit": albums_limit,
        "genres_limit": genres_limit,
        "replay_limit": replay_limit,
    }


def _schedule_projection(params: dict[str, Any], subject_key: str) -> None:
    create_task_dedup(
        "refresh_user_stats_dashboard_snapshot",
        params,
        dedup_key=f"stats-dashboard:{subject_key}",
    )


def _cold_dashboard(window: str, month: str | None, subject_key: str) -> dict:
    period = month_period_key(month) if month else window
    return {
        "window": period,
        "overview": {
            "window": period,
            "play_count": 0,
            "complete_play_count": 0,
            "skip_count": 0,
            "minutes_listened": 0,
            "active_days": 0,
            "skip_rate": 0,
            "top_artist": None,
        },
        "trends": {"window": period, "points": []},
        "top_tracks": {"window": period, "items": []},
        "top_artists": {"window": period, "items": []},
        "top_albums": {"window": period, "items": []},
        "top_genres": {"window": period, "items": []},
        "replay": {
            "window": period,
            "title": "Replay",
            "subtitle": "Listening projection pending",
            "track_count": 0,
            "minutes_listened": 0,
            "items": [],
        },
        "story": {
            "window": period,
            "movers": [],
            "discoveries": [],
            "comebacks": [],
            "rhythm": {},
            "audio_profile": {},
            "monthly_snapshots": [],
        },
        "snapshot": {
            "scope": "stats:dashboard",
            "subject_key": subject_key,
            "version": 0,
            "stale": True,
            "pending": True,
        },
    }


def get_user_stats_dashboard(
    user_id: int,
    *,
    window: str = "30d",
    month: str | None = None,
    tracks_limit: int = 12,
    artists_limit: int = 10,
    albums_limit: int = 12,
    genres_limit: int = 10,
    replay_limit: int = 36,
) -> dict[str, Any]:
    params = _projection_params(
        user_id,
        window=window,
        month=month,
        tracks_limit=tracks_limit,
        artists_limit=artists_limit,
        albums_limit=albums_limit,
        genres_limit=genres_limit,
        replay_limit=replay_limit,
    )
    subject_key = stats_dashboard_subject_key(**params)
    cached = get_ui_snapshot(
        "stats:dashboard", subject_key, max_age_seconds=_MAX_AGE_SECONDS
    )
    if cached:
        return decorate_snapshot(cached)
    stale = get_ui_snapshot(
        "stats:dashboard", subject_key, max_age_seconds=_STALE_MAX_AGE_SECONDS
    )
    _schedule_projection(params, subject_key)
    if stale:
        return decorate_snapshot(stale, stale=True)
    return _cold_dashboard(window, month, subject_key)


def refresh_user_stats_dashboard_snapshot(
    user_id: int,
    *,
    window: str = "30d",
    month: str | None = None,
    tracks_limit: int = 12,
    artists_limit: int = 10,
    albums_limit: int = 12,
    genres_limit: int = 10,
    replay_limit: int = 36,
) -> dict[str, Any]:
    params = _projection_params(
        user_id,
        window=window,
        month=month,
        tracks_limit=tracks_limit,
        artists_limit=artists_limit,
        albums_limit=albums_limit,
        genres_limit=genres_limit,
        replay_limit=replay_limit,
    )
    payload = build_user_stats_dashboard(**params)
    saved = upsert_ui_snapshot(
        "stats:dashboard",
        stats_dashboard_subject_key(**params),
        payload,
        stale_after_seconds=_MAX_AGE_SECONDS,
    )
    return decorate_snapshot(saved)


def refresh_user_stats_dashboard_snapshots(user_id: int) -> int:
    params = _projection_params(user_id, window="30d", month=None, **_DEFAULT_LIMITS)
    _schedule_projection(params, stats_dashboard_subject_key(**params))
    return 1


def _list_stats_dashboard_user_ids() -> list[int]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT id
                FROM users
                WHERE status = 'active'
                  AND deleted_at IS NULL
                ORDER BY id
                """
                )
            )
            .scalars()
            .all()
        )
    return [int(user_id) for user_id in rows]


def queue_missing_stats_dashboard_snapshots() -> int:
    queued = 0
    for user_id in _list_stats_dashboard_user_ids():
        params = _projection_params(
            user_id,
            window="30d",
            month=None,
            **_DEFAULT_LIMITS,
        )
        subject_key = stats_dashboard_subject_key(**params)
        if get_ui_snapshot(
            "stats:dashboard",
            subject_key,
            max_age_seconds=_STALE_MAX_AGE_SECONDS,
        ):
            continue
        _schedule_projection(params, subject_key)
        queued += 1
    return queued


__all__ = [
    "build_user_stats_dashboard",
    "get_user_stats_dashboard",
    "queue_missing_stats_dashboard_snapshots",
    "refresh_user_stats_dashboard_snapshot",
    "refresh_user_stats_dashboard_snapshots",
    "stats_dashboard_subject_key",
]
