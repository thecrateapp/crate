"""Task scheduler — configurable recurring tasks."""

import hashlib
import logging
from datetime import datetime, timezone

from crate.db.cache_settings import get_setting, set_setting
from crate.db.queries.tasks import list_tasks

log = logging.getLogger(__name__)

# Default schedule: {task_type: interval_seconds}
DEFAULT_SCHEDULES = {
    "enrich_artists": 86400,  # 24h — full enrichment of all artists
    "library_pipeline": 86400,  # 24h — gated maintenance path (watcher handles real-time)
    "compute_analytics": 14400,  # 4h — recompute analytics from DB
    "check_new_releases": 43200,  # 12h — check MusicBrainz for new releases
    "promote_due_releases": 3600,  # 1h — download pre-releases once they are out
    "rematch_album_mbids": 21600,  # 6h — retry MusicBrainz for albums without one
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
    "refresh_dirty_listening_stats": 300,  # 5min — trailing edge for debounced plays
    "compute_product_kpis": 3600,  # 1h — recompute today's and yesterday's KPIs
    "compute_observability_summary": 0,  # opt-in — summary for Admin, MCP and Agent
    "compute_recommendation_skips": 3600,  # 1h — early skips over the last 24h
    "sync_error_issues": 300,  # 5min — Sentry issues into the error inbox
    "track_error_fixes": 300,  # 5min — fix runs and their pull requests
    "cleanup_smart_mix_refinements": 86400,  # 24h — AI refinements unread for 180 days
    "analyze_playlist_stems": 1800,  # 30min — Smart Mix playlist stems: retries, file changes
    "backup_dump": 86400,  # 24h — local database dump, then its retention (BK1)
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

# Only scheduled once `error_tracking` is configured: an install without Sentry
# creates no tasks.
ERROR_TRACKING_SCHEDULED_TASKS = {"sync_error_issues"}

# Only scheduled while Launch fix is configured and a fix run is open or has a
# branch to delete: with Launch fix off, nothing polls GitHub.
ERROR_FIX_SCHEDULED_TASKS = {"track_error_fixes"}

# The default local backup policy (admin backups, BK1): a nightly dump inside the
# maintenance window, then its retention. On unless CRATE_LOCAL_BACKUPS_ENABLED is
# off, which production sets while the crate-postgres-backup sidecar runs (until
# BK6).
LOCAL_BACKUP_SCHEDULED_TASKS = {"backup_dump"}


def get_schedules() -> dict[str, int]:
    """Read current schedules; defaults and legacy aliases are never persisted."""
    from crate.db.queries.agent_runtime_policy import decode_schedules

    return decode_schedules(get_setting("schedules"))


def set_schedules(schedules: dict[str, int]):
    """Save schedule configuration."""
    from crate.db.repositories.runtime_policy import (
        read_schedules_state,
        update_schedules,
    )

    state = read_schedules_state()
    return update_schedules(schedules, expected_revision=state["revision"])


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

    # This is the last enqueue time, not evidence of successful execution.
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

    if task_type in ERROR_TRACKING_SCHEDULED_TASKS:
        return _has_error_tracking_config()

    if task_type in ERROR_FIX_SCHEDULED_TASKS:
        return _has_trackable_error_fixes()

    if task_type in LOCAL_BACKUP_SCHEDULED_TASKS:
        from crate.backups.settings import local_backups_enabled

        return local_backups_enabled()

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


def _has_error_tracking_config() -> bool:
    """Settings stored and a token to use; invalid settings never schedule."""
    try:
        from crate.error_inbox.config import load_config

        config = load_config()
    except Exception:
        log.debug("Unable to read the error tracking settings", exc_info=True)
        return False
    return config is not None and bool(config.secret_ref)


def _has_trackable_error_fixes() -> bool:
    """Launch fix configured with a token, and a fix run to follow."""
    try:
        from crate.db.queries.error_fix_runs import has_trackable_fix_runs
        from crate.error_inbox.config import load_config

        config = load_config()
        if config is None or not config.fix_ready:
            return False
        return has_trackable_fix_runs()
    except Exception:
        log.debug("Unable to inspect the error fix runs", exc_info=True)
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


def guarded_run_schedule(
    task_type: str,
    *,
    origin="scheduler",
    actor_user_id=None,
    agent_context=None,
    required_grants=None,
    expected_schedule_revision=None,
    session=None,
) -> dict:
    """One bounded enqueue path; manual calls cannot force resource gates."""
    from crate.db.repositories.runtime_policy import enqueue_schedule
    from crate.resource_governor import record_decision, should_defer_task

    if task_type not in DEFAULT_SCHEDULES:
        raise ValueError("Unknown schedule")
    if origin not in {"scheduler", "admin", "agent"}:
        raise ValueError("Unsupported schedule origin")
    if origin == "agent" and task_type != "compute_analytics":
        return {
            "status": "unavailable",
            "task_id": None,
            "reason": "The schedule has no bounded agent execution contract",
        }
    decision = should_defer_task(task_type, {})
    if not decision.allowed:
        record_decision(decision, task_type=task_type, source="scheduler")
        return {
            "status": "deferred",
            "task_id": None,
            "reason": decision.reason,
            "retry_after": decision.defer_seconds,
        }
    if (
        not _scheduled_task_enabled(task_type)
        or task_type == "global_catalog_reconcile_full"
        and _has_conflicting_full_sync()
    ):
        return {
            "status": "unavailable",
            "task_id": None,
            "reason": "Schedule dependencies are not ready",
        }
    return enqueue_schedule(
        task_type,
        origin=origin,
        actor_user_id=actor_user_id,
        agent_context=agent_context,
        required_grants=required_grants,
        decision=decision,
        expected_schedule_revision=expected_schedule_revision,
        session=session,
    )


def enqueue_scheduled_task(task_type: str, **kwargs) -> str | None:
    """Compatibility wrapper around the same guarded schedule operation."""
    return guarded_run_schedule(task_type, **kwargs)["task_id"]


def check_and_create_scheduled_tasks():
    """Check all scheduled tasks and create any that are due."""
    schedules = get_schedules()

    for task_type, interval in schedules.items():
        if interval <= 0:
            continue
        if should_run(task_type, schedules):
            log.info("Scheduling task: %s (interval=%ds)", task_type, interval)
            enqueue_scheduled_task(task_type)
