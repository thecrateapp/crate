"""Persisted, stale-first instance-wide stats dashboard ("Crate Pulse")."""

from __future__ import annotations

from typing import Any

from crate.db.cache_store import get_cache, set_cache
from crate.db.queries.user_library_shared import normalize_stats_window
from crate.db.queries.user_library_stats_global import (
    get_global_replay_mix,
    get_global_stats_overview,
    get_global_stats_story,
    get_global_stats_trends,
    get_global_top_albums,
    get_global_top_artists,
    get_global_top_genres,
    get_global_top_tracks,
)
from crate.db.queries.user_library_stats_signal import (
    METRICS_VERSION,
    get_stats_signal,
)
from crate.db.queries.instance_stats_listeners import get_top_listeners
from crate.db.queries.user_stats_periods import resolve_stats_period
from crate.db.repositories.tasks import create_task_dedup
from crate.db.tx import read_scope
from crate.db.ui_snapshot_reads import get_ui_snapshot
from crate.db.ui_snapshot_shared import decorate_snapshot
from crate.db.ui_snapshot_writes import upsert_ui_snapshot
from crate.db.user_stats_dashboard_surface import _cold_dashboard

SCOPE = "stats:dashboard:instance"
_MAX_AGE_SECONDS = 300
_STALE_MAX_AGE_SECONDS = 86_400
_SCHEDULE_DEBOUNCE_SECONDS = 300
_PREWARMED_WINDOWS = ("30d", "90d", "365d", "all_time")
_DEFAULT_LIMITS = {
    "tracks_limit": 12,
    "artists_limit": 10,
    "albums_limit": 12,
    "genres_limit": 10,
    "replay_limit": 36,
}


def instance_stats_subject_key(
    *,
    window: str,
    month: str | None,
    tracks_limit: int,
    artists_limit: int,
    albums_limit: int,
    genres_limit: int,
    replay_limit: int,
) -> str:
    period = f"month:{month}" if month else window
    return (
        f"instance:{period}:{tracks_limit}:{artists_limit}:{albums_limit}:"
        f"{genres_limit}:{replay_limit}"
    )


def build_instance_stats_dashboard(
    *,
    window: str,
    month: str | None,
    tracks_limit: int,
    artists_limit: int,
    albums_limit: int,
    genres_limit: int,
    replay_limit: int,
) -> dict[str, Any]:
    period_key = f"month:{month}" if month else window
    payload: dict[str, Any] = {
        "window": period_key,
        "subject": {"kind": "instance", "display_name": "Crate"},
        "overview": get_global_stats_overview(window=window, month=month),
        "trends": get_global_stats_trends(window=window, month=month),
        "top_tracks": {
            "window": period_key,
            "items": get_global_top_tracks(
                window=window, month=month, limit=tracks_limit
            ),
        },
        "top_artists": {
            "window": period_key,
            "items": get_global_top_artists(
                window=window, month=month, limit=artists_limit
            ),
        },
        "top_albums": {
            "window": period_key,
            "items": get_global_top_albums(
                window=window, month=month, limit=albums_limit
            ),
        },
        "top_genres": {
            "window": period_key,
            "items": get_global_top_genres(
                window=window, month=month, limit=genres_limit
            ),
        },
        "replay": get_global_replay_mix(window=window, month=month, limit=replay_limit),
        "story": get_global_stats_story(window=window, month=month),
    }
    with read_scope() as session:
        period = resolve_stats_period("UTC", window=window, month=month)
        payload.update(get_stats_signal(session, None, period))
        payload["top_listeners"] = get_top_listeners(session, period)
    return payload


def _params(window: str, month: str | None, limits: dict[str, int]) -> dict[str, Any]:
    return {"window": window, "month": month, **limits}


def _schedule(params: dict[str, Any], subject_key: str) -> None:
    create_task_dedup(
        "refresh_instance_stats_dashboard_snapshot",
        params,
        dedup_key=f"stats-dashboard-instance:{subject_key}",
    )


def get_instance_stats_dashboard(
    *,
    window: str = "30d",
    month: str | None = None,
    tracks_limit: int = 12,
    artists_limit: int = 10,
    albums_limit: int = 12,
    genres_limit: int = 10,
    replay_limit: int = 36,
) -> dict[str, Any]:
    window = normalize_stats_window(window)
    params = _params(
        window,
        month,
        {
            "tracks_limit": tracks_limit,
            "artists_limit": artists_limit,
            "albums_limit": albums_limit,
            "genres_limit": genres_limit,
            "replay_limit": replay_limit,
        },
    )
    subject_key = instance_stats_subject_key(**params)
    cached = get_ui_snapshot(SCOPE, subject_key, max_age_seconds=_MAX_AGE_SECONDS)
    if cached:
        return decorate_snapshot(cached)
    stale = get_ui_snapshot(SCOPE, subject_key, max_age_seconds=_STALE_MAX_AGE_SECONDS)
    _schedule(params, subject_key)
    if stale:
        return decorate_snapshot(stale, stale=True)
    cold = _cold_dashboard(window, month, subject_key)
    cold["subject"] = {"kind": "instance", "display_name": "Crate"}
    cold["metrics_version"] = METRICS_VERSION
    cold["snapshot"]["scope"] = SCOPE
    return cold


def refresh_instance_stats_dashboard_snapshot(
    *,
    window: str = "30d",
    month: str | None = None,
    tracks_limit: int = 12,
    artists_limit: int = 10,
    albums_limit: int = 12,
    genres_limit: int = 10,
    replay_limit: int = 36,
) -> dict[str, Any]:
    params = _params(
        normalize_stats_window(window),
        month,
        {
            "tracks_limit": tracks_limit,
            "artists_limit": artists_limit,
            "albums_limit": albums_limit,
            "genres_limit": genres_limit,
            "replay_limit": replay_limit,
        },
    )
    saved = upsert_ui_snapshot(
        SCOPE,
        instance_stats_subject_key(**params),
        build_instance_stats_dashboard(**params),
        stale_after_seconds=_MAX_AGE_SECONDS,
    )
    return decorate_snapshot(saved)


def schedule_instance_stats_dashboard_refresh() -> int:
    debounce_key = "stats_instance_refresh_debounce"
    if get_cache(debounce_key, max_age_seconds=_SCHEDULE_DEBOUNCE_SECONDS):
        return 0
    for window in _PREWARMED_WINDOWS:
        params = _params(window, None, _DEFAULT_LIMITS)
        _schedule(params, instance_stats_subject_key(**params))
    set_cache(debounce_key, True, ttl=_SCHEDULE_DEBOUNCE_SECONDS)
    return len(_PREWARMED_WINDOWS)


__all__ = [
    "SCOPE",
    "build_instance_stats_dashboard",
    "get_instance_stats_dashboard",
    "instance_stats_subject_key",
    "refresh_instance_stats_dashboard_snapshot",
    "schedule_instance_stats_dashboard_refresh",
]
