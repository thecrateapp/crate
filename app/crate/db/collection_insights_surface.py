"""Cache-only read surface for the worker-built collection listening report."""

from __future__ import annotations

import logging
from time import perf_counter
from typing import Any

from crate.db.cache_store import get_cache, set_cache
from crate.db.repositories.tasks import create_task_dedup
from crate.db.repositories.tasks_mutations import find_active_task_by_type_params
from crate.db.ui_snapshot_reads import get_ui_snapshot
from crate.db.ui_snapshot_shared import decorate_snapshot
from crate.db.ui_snapshot_writes import upsert_ui_snapshot

log = logging.getLogger(__name__)
SCOPE = "admin:collection-insights"
WINDOWS = ("30d", "90d", "365d")
_MAX_AGE = 300
_STALE_RETENTION = 365 * 86400
_WARM_WINDOW = "30d"
_WARM_INTERVAL = 3600


def _subject(window: str) -> str:
    if window not in WINDOWS:
        raise ValueError("Unsupported collection insights window")
    return f"v1:{window}"


def cold_collection_insights(window: str = "30d") -> dict[str, Any]:
    return {
        "ready": False,
        "window": window,
        "period": None,
        "catalogue": None,
        "current": None,
        "previous": None,
        "excluded": None,
        "timeline": [],
        "genres": [],
        "decades": [],
        "rising": [],
        "falling": [],
        "unheard": {"total": 0, "items": []},
        "rediscover": {"total": 0, "items": []},
        "improvements": [],
        "snapshot": {
            "scope": SCOPE,
            "subject_key": _subject(window),
            "version": 0,
            "built_at": None,
            "stale_after": None,
            "stale": True,
            "missing": True,
            "pending": True,
        },
    }


def _schedule(window: str) -> tuple[bool, str | None]:
    try:
        dedup_key = f"collection-insights:{_subject(window)}"
        task_id = create_task_dedup(
            "refresh_collection_insights",
            {"window": window},
            dedup_key=dedup_key,
        )
        if task_id is None:
            task_id = find_active_task_by_type_params(
                "refresh_collection_insights", {"window": window}, dedup_key=dedup_key
            )
        return True, task_id
    except Exception:
        log.warning("Collection insights refresh could not be scheduled", exc_info=True)
        return False, None


def get_collection_insights(
    *, window: str = "30d", fresh: bool = False
) -> dict[str, Any]:
    subject = _subject(window)
    row = get_ui_snapshot(SCOPE, subject, max_age_seconds=_MAX_AGE)
    if row and not fresh:
        return decorate_snapshot(row)
    stale = (
        None
        if row
        else get_ui_snapshot(SCOPE, subject, max_age_seconds=_STALE_RETENTION)
    )
    scheduled, task_id = _schedule(window)
    snapshot = row or stale
    result = (
        decorate_snapshot(snapshot, stale=not bool(row))
        if snapshot
        else cold_collection_insights(window)
    )
    result["snapshot"]["pending"] = scheduled
    result["snapshot"]["refresh_error"] = not scheduled
    result["snapshot"]["task_id"] = task_id
    return result


def refresh_collection_insights(*, window: str = "30d") -> dict[str, Any]:
    from crate.db.queries.collection_insights import build_collection_insights

    subject = _subject(window)
    started = perf_counter()
    payload = build_collection_insights(window=window)
    row = upsert_ui_snapshot(
        SCOPE,
        subject,
        payload,
        stale_after_seconds=_MAX_AGE,
        generation_ms=round((perf_counter() - started) * 1000),
    )
    return decorate_snapshot(row)


def schedule_collection_insights_refresh() -> int:
    key = "collection_insights_refresh_debounce_v2"
    if get_cache(key, max_age_seconds=_WARM_INTERVAL):
        return 0
    scheduled, _task_id = _schedule(_WARM_WINDOW)
    if scheduled:
        set_cache(key, True, ttl=_WARM_INTERVAL)
    return int(scheduled)


__all__ = [
    "SCOPE",
    "WINDOWS",
    "cold_collection_insights",
    "get_collection_insights",
    "refresh_collection_insights",
    "schedule_collection_insights_refresh",
]
