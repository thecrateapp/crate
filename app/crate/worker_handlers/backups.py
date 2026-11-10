"""Backups engine tasks (admin backups, BK1): the local dump and its retention.

With ``CRATE_LOCAL_BACKUPS_ENABLED`` off both do nothing, whoever queued them.
Both run on the maintenance queue under one session advisory lock, so a dump and a
prune never overlap, and both record a ``backup_runs`` row. A dump that fails or is
cancelled leaves no file and a failed run; after a good dump the retention task is
queued. Settings: ``crate.backups.settings``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from crate.backups.local import (
    BackupCancelled,
    BackupError,
    apply_local_retention,
    connection_from_env,
    dump_database,
    remove_partials,
)
from crate.backups.settings import (
    ENABLED_ENV,
    backup_dir,
    dumps_dir,
    local_backups_enabled,
    prepare_dumps_dir,
    retention_policy,
)
from crate.db.advisory_locks import try_session_lock
from crate.db.repositories.backup_runs import (
    close_interrupted_backup_runs,
    finish_backup_run,
    start_backup_run,
)
from crate.worker_handlers import is_cancelled, run_again_later

log = logging.getLogger(__name__)

LOCAL_BACKUP_LOCK = "crate:backups:local"
RETENTION_TASK = "backup_local_retention"
# Below the task's time limit, so pg_dump is stopped and cleaned up before the
# actor's own limit hits.
DUMP_TIMEOUT_SECONDS = 4 * 3600 - 600
LOCK_RETRY_SECONDS = 120


def _busy() -> dict:
    return {"status": "skipped", "reason": "Another backup job is running"}


def _disabled() -> dict:
    return {"status": "skipped", "reason": f"Local backups are off ({ENABLED_ENV})"}


def _enqueue_retention() -> str | None:
    from crate.db.repositories.tasks import create_task_dedup

    return create_task_dedup(RETENTION_TASK, {}, dedup_key=RETENTION_TASK)


def _handle_backup_dump(task_id: str, params: dict, config: dict) -> dict:
    """``pg_dump -Fc`` of the Crate database into the local backup directory."""
    del params, config
    if not local_backups_enabled():
        return _disabled()
    with try_session_lock(LOCAL_BACKUP_LOCK) as acquired:
        if not acquired:
            return _busy()
        close_interrupted_backup_runs("dump")
        run_id = start_backup_run("dump", task_id=task_id)
        try:
            folder = prepare_dumps_dir()
            remove_partials(folder)
            result = dump_database(
                folder,
                now=datetime.now(timezone.utc),
                connection=connection_from_env(),
                should_cancel=lambda: is_cancelled(task_id),
                timeout_seconds=DUMP_TIMEOUT_SECONDS,
            )
        except BackupCancelled as exc:
            finish_backup_run(run_id, status="failed", error=str(exc))
            return {"run_id": run_id, "cancelled": True}
        except Exception as exc:
            message = str(exc) if isinstance(exc, BackupError) else repr(exc)
            log.warning("Backup dump failed: %s", message)
            finish_backup_run(run_id, status="failed", error=message)
            return {"status": "failed", "error": message, "run_id": run_id}
        relative = result.path.relative_to(backup_dir()).as_posix()
        finish_backup_run(
            run_id,
            status="succeeded",
            path=relative,
            size_bytes=result.size_bytes,
            checksum=result.sha256,
        )
    retention_task_id = _enqueue_retention()
    return {
        "run_id": run_id,
        "path": relative,
        "bytes": result.size_bytes,
        "sha256": result.sha256,
        "retention_task_id": retention_task_id,
    }


def _handle_backup_local_retention(task_id: str, params: dict, config: dict) -> dict:
    """Grandfather-father-son pruning of the local dumps."""
    del config
    if not local_backups_enabled():
        return _disabled()
    try:
        policy = retention_policy(params)
    except ValueError as exc:
        return {"status": "failed", "error": str(exc)}
    with try_session_lock(LOCAL_BACKUP_LOCK) as acquired:
        if not acquired:
            return run_again_later(
                LOCK_RETRY_SECONDS, progress="Waiting for the running backup job"
            )
        close_interrupted_backup_runs("local_retention")
        run_id = start_backup_run("local_retention", task_id=task_id)
        try:
            outcome = apply_local_retention(dumps_dir(), policy)
        except Exception as exc:
            message = repr(exc)
            log.warning("Backup retention failed: %s", message)
            finish_backup_run(run_id, status="failed", error=message)
            return {"status": "failed", "error": message, "run_id": run_id}
        details = {
            "keep_daily": policy.daily,
            "keep_weekly": policy.weekly,
            "keep_monthly": policy.monthly,
            "kept": outcome.kept,
            "deleted": outcome.deleted,
            "removed_leftovers": outcome.removed_leftovers,
        }
        finish_backup_run(run_id, status="succeeded", details=details)
    return {"run_id": run_id, **details}


BACKUP_TASK_HANDLERS = {
    "backup_dump": _handle_backup_dump,
    "backup_local_retention": _handle_backup_local_retention,
}

__all__ = ["BACKUP_TASK_HANDLERS", "LOCAL_BACKUP_LOCK"]
