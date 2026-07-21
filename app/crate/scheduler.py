"""Task scheduler — configurable recurring tasks."""

import hashlib
import logging
from datetime import datetime, timezone

from crate.db.cache_settings import get_setting, set_setting
from crate.db.queries.tasks import list_tasks
from crate.db.repositories.tasks import create_task_dedup

log = logging.getLogger(__name__)

# Default schedule: {task_type: interval_seconds}
DEFAULT_SCHEDULES = {
    "enrich_artists": 86400,  # 24h — full enrichment of all artists
    "library_pipeline": 86400,  # 24h — gated maintenance path (watcher handles real-time)
    "compute_analytics": 14400,  # 4h — recompute analytics from DB
    "check_new_releases": 43200,  # 12h — check MusicBrainz for new releases
    "repair_duplicate_tracks": 43200,  # 12h — clean high-confidence duplicate tracks
    "cleanup_incomplete_downloads": 172800,  # 48h — remove incomplete soulseek downloads
    "cleanup_artwork_variants": 172800,  # 48h — retain current + previous revisions
    "cleanup_stream_variants": 3600,  # 1h — enforce playback cache LRU/TTL
    "sync_shows": 86400,  # 24h — sync shows from Ticketmaster
    "federation_health_poll": 60,  # 1min — poll approved peers for health
    "federation_sync_catalog": 120,  # 2min — consume peer catalog deltas
    "federation_directory_refresh": 300,  # 5min — refresh due signed directories
    "global_catalog_reconcile_incremental": 300,  # 5min — drain dirty sources
    "global_catalog_reconcile_full": 43200,  # 12h — verify canonical catalog
}

SCHEDULED_TASKS = [
    {"name": task_type, "interval_seconds": interval_seconds}
    for task_type, interval_seconds in DEFAULT_SCHEDULES.items()
]

FEDERATION_SCHEDULED_TASKS = {
    "federation_health_poll",
    "federation_sync_catalog",
}

DIRECTORY_SCHEDULED_TASKS = {"federation_directory_refresh"}

GLOBAL_CATALOG_SCHEDULED_TASKS = {
    "global_catalog_reconcile_incremental",
    "global_catalog_reconcile_full",
}


def get_schedules() -> dict[str, int]:
    """Get configured schedules from settings, falling back to defaults."""
    import json

    raw = get_setting("schedules")
    if raw:
        try:
            schedules = json.loads(raw)
            # Migration: rename library_sync → library_pipeline
            if "library_sync" in schedules and "library_pipeline" not in schedules:
                schedules["library_pipeline"] = schedules.pop("library_sync")
            merged = dict(DEFAULT_SCHEDULES)
            merged.update(schedules)
            if merged != schedules:
                set_schedules(merged)
            return merged
        except Exception:
            pass
    return dict(DEFAULT_SCHEDULES)


def set_schedules(schedules: dict[str, int]):
    """Save schedule configuration."""
    import json

    set_setting("schedules", json.dumps(schedules))


def should_run(task_type: str, schedules: dict[str, int] | None = None) -> bool:
    """Check if a scheduled task should run now."""
    if schedules is None:
        schedules = get_schedules()

    interval = schedules.get(task_type)
    if not interval or interval <= 0:
        return False  # disabled

    if not _scheduled_task_enabled(task_type):
        return False

    if task_type == "global_catalog_reconcile_full" and _has_conflicting_full_sync():
        return False

    # Check last completion time
    last_key = f"schedule:last_run:{task_type}"
    last_run = get_setting(last_key)

    if last_run:
        from crate.utils import to_datetime

        last_time = to_datetime(last_run)
        if last_time is not None:
            elapsed = (datetime.now(timezone.utc) - last_time).total_seconds()
            effective_interval = interval + schedule_jitter_seconds(task_type, interval)
            if elapsed < effective_interval:
                return False

    # Check if already pending/running
    pending = list_tasks(status="pending", task_type=task_type, limit=1)
    running = list_tasks(status="running", task_type=task_type, limit=1)
    if pending or running:
        return False

    return True


def _scheduled_task_enabled(task_type: str) -> bool:
    if task_type in FEDERATION_SCHEDULED_TASKS:
        return _has_approved_federation_peers()

    if task_type in DIRECTORY_SCHEDULED_TASKS:
        return _has_due_federation_directories()

    if task_type in GLOBAL_CATALOG_SCHEDULED_TASKS:
        return True

    return True


def _has_due_federation_directories() -> bool:
    try:
        from crate.db.repositories.federation_directories import (
            list_due_subscriptions,
        )

        return bool(list_due_subscriptions(limit=1))
    except Exception:
        log.debug("Unable to inspect federation directories", exc_info=True)
        return False


def _has_approved_federation_peers() -> bool:
    from crate.db.repositories.federation import list_peers

    return bool(list_peers(trust_state="approved"))


def local_node_uid() -> str:
    try:
        from crate.db.repositories.federation import get_local_node

        node = get_local_node()
        if node and node.get("node_uid"):
            return str(node["node_uid"])
    except Exception:
        pass
    return "local"


def schedule_jitter_seconds(task_type: str, interval: int) -> int:
    if not task_type.startswith(
        ("global_catalog_", "federation_sync_catalog", "federation_directory")
    ):
        return 0
    window = min(max(int(interval or 0) // 12, 60), 3600)
    seed = f"{local_node_uid()}:{task_type}".encode("utf-8")
    return int(hashlib.sha256(seed).hexdigest()[:8], 16) % (window + 1)


def _has_conflicting_full_sync() -> bool:
    conflicting_types = ("library_pipeline", "scan")
    for task_type in conflicting_types:
        try:
            if list_tasks(status="running", task_type=task_type, limit=1):
                return True
        except Exception:
            log.debug("Unable to inspect conflicting task %s", task_type, exc_info=True)
    return False


def mark_run(task_type: str):
    """Mark a task type as just run."""
    last_key = f"schedule:last_run:{task_type}"
    set_setting(last_key, datetime.now(timezone.utc).isoformat())


def check_and_create_scheduled_tasks():
    """Check all scheduled tasks and create any that are due."""
    schedules = get_schedules()

    for task_type, interval in schedules.items():
        if interval <= 0:
            continue
        if should_run(task_type, schedules):
            try:
                from crate.resource_governor import record_decision, should_defer_task

                decision = should_defer_task(task_type)
                if not decision.allowed:
                    record_decision(decision, task_type=task_type, source="scheduler")
                    log.info(
                        "Deferring scheduled task %s due to resource pressure: %s",
                        task_type,
                        decision.reason,
                    )
                    continue
            except Exception:
                log.debug(
                    "Resource governor check failed for scheduled %s",
                    task_type,
                    exc_info=True,
                )
            log.info("Scheduling task: %s (interval=%ds)", task_type, interval)
            task_id = create_task_dedup(task_type, dedup_key=f"schedule:{task_type}")
            if task_id:
                mark_run(task_type)
