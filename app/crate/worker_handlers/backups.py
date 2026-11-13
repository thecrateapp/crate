"""Backups engine tasks: the local dump and its retention (BK1), destination tests
(BK2), and the policies' copies, verifications and restore drills (BK3).

Policies (BK3): ``backup_policies_tick`` starts each due policy by queueing a
``backup_dump`` with its id; after a good dump that task queues one
``backup_offsite`` per destination whose tiers are due. The tick also queues
``backup_verify`` and ``backup_restore_drill`` on their cadence. Each of those
three holds its destination's advisory lock, so no two jobs write to one
repository; after a restart the first one closes that destination's interrupted
runs and removes restic's stale locks. Drills also hold ``DRILL_LOCK``, under which
the databases and files of a killed drill are dropped.

With ``CRATE_LOCAL_BACKUPS_ENABLED`` off both do nothing, whoever queued them.
Both run on the maintenance queue under one session advisory lock, so a dump and a
prune never overlap, and both record a ``backup_runs`` row. A dump that fails or is
cancelled leaves no file and a failed run; after a good dump the retention task is
queued. Settings: ``crate.backups.settings``.

Alerts (BK6): ``backup_alerts`` runs every 5 minutes while backups are in use and
pushes the alerts of ``crate.backups.alerts``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import PurePosixPath

from crate.backups import offsite
from crate.backups import policies as policy_rules
from crate.backups.local import (
    BackupCancelled,
    BackupError,
    apply_local_retention,
    connection_from_env,
    dump_database,
    parse_dump_name,
    remove_partials,
)
from crate.backups.policies import local_now
from crate.backups.settings import (
    ENABLED_ENV,
    backup_dir,
    dumps_dir,
    local_backups_enabled,
    prepare_dumps_dir,
    retention_policy,
)
from crate.db.advisory_locks import try_session_lock
from crate.db.queries.backup_destinations import (
    get_backup_destination,
    list_backup_destinations,
)
from crate.db.queries.backup_policies import get_backup_policy, list_backup_policies
from crate.db.queries.backup_runs import latest_destination_runs, latest_tier_copies
from crate.db.repositories.backup_destinations import record_destination_check
from crate.db.repositories.backup_policies import mark_policy_scheduled
from crate.db.repositories.backup_runs import (
    close_interrupted_backup_runs,
    close_interrupted_destination_runs,
    finish_backup_run,
    start_backup_run,
)
from crate.worker_handlers import is_cancelled, run_again_later

log = logging.getLogger(__name__)
UTC = timezone.utc

LOCAL_BACKUP_LOCK = "crate:backups:local"
DRILL_LOCK = "crate:backups:drill"
RETENTION_TASK = "backup_local_retention"
DUMP_TASK = "backup_dump"
OFFSITE_TASK = "backup_offsite"
VERIFY_TASK = "backup_verify"
DRILL_TASK = "backup_restore_drill"
# Below the task's time limit, so pg_dump is stopped and cleaned up before the
# actor's own limit hits.
DUMP_TIMEOUT_SECONDS = 4 * 3600 - 600
LOCK_RETRY_SECONDS = 120


def _busy() -> dict:
    return {"status": "skipped", "reason": "Another backup job is running"}


def _disabled() -> dict:
    return {"status": "skipped", "reason": f"Local backups are off ({ENABLED_ENV})"}


def _enqueue(task_type: str, params: dict, dedup_key: str) -> str | None:
    from crate.db.repositories.tasks import create_task_dedup

    return create_task_dedup(task_type, params, dedup_key=dedup_key)


def _enqueue_retention() -> str | None:
    return _enqueue(RETENTION_TASK, {}, RETENTION_TASK)


def _queue_policy_copies(
    policy: dict, dump_path: str, taken_at: datetime, *, ignore_window: bool = False
) -> list[str]:
    """One ``backup_offsite`` per usable destination whose tiers are due."""
    now = local_now()
    destinations = {row["id"]: row for row in list_backup_destinations()}
    copies = latest_tier_copies()
    task_ids: list[str] = []
    for destination_id, tiers in policy["destinations"].items():
        row = destinations.get(destination_id)
        # Disabled, or never passed a test (BG1-11): nothing goes there.
        if (
            row is None
            or not row["enabled"]
            or row["repository_initialized_at"] is None
        ):
            continue
        due = policy_rules.run_tiers(policy, now, copies.get(destination_id, {}))
        tags = policy_rules.destination_tags(tiers, due)
        if not tags:
            continue
        task_id = _enqueue(
            OFFSITE_TASK,
            {
                "policy_id": policy["id"],
                "destination_id": destination_id,
                "dump": dump_path,
                "tags": tags,
                "destination_tiers": list(tiers),
                "taken_at": taken_at.isoformat(),
                "ignore_maintenance_window": True,
                **({"ignore_window": True} if ignore_window else {}),
            },
            f"backup_offsite:{policy['id']}:{destination_id}",
        )
        if task_id:
            task_ids.append(task_id)
    return task_ids


def _handle_backup_dump(task_id: str, params: dict, config: dict) -> dict:
    """``pg_dump -Fc`` of the Crate database into the local backup directory.

    With a ``policy_id`` (a policy run), the copies of the dump follow it.
    """
    del config
    if not local_backups_enabled():
        return _disabled()
    policy = None
    if params.get("policy_id"):
        policy = get_backup_policy(str(params["policy_id"]))
        if policy is None:
            return {"status": "skipped", "reason": "The policy no longer exists"}
    with try_session_lock(LOCAL_BACKUP_LOCK) as acquired:
        if not acquired:
            return _busy()
        close_interrupted_backup_runs("dump")
        run_id = start_backup_run(
            "dump", task_id=task_id, policy_id=policy["id"] if policy else None
        )
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
    offsite_task_ids = (
        _queue_policy_copies(
            policy,
            relative,
            parse_dump_name(result.path.name) or datetime.now(UTC),
            # Run now from Admin: the operator asked for it now, window or not.
            ignore_window=bool(params.get("ignore_window")),
        )
        if policy
        else []
    )
    return {
        "run_id": run_id,
        "path": relative,
        "bytes": result.size_bytes,
        "sha256": result.sha256,
        "retention_task_id": retention_task_id,
        "offsite_task_ids": offsite_task_ids,
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


def destination_lock_key(destination_id: str) -> str:
    """One advisory lock per destination: one job at a time per repository."""
    return f"crate:backups:destination:{destination_id}"


def _handle_backup_test_destination(task_id: str, params: dict, config: dict) -> dict:
    """Test connection of one destination; the result is stored on it."""
    del config
    from crate.backups.connection import test_destination
    from crate.backups.destinations import DestinationNotFound

    destination_id = str(params.get("destination_id") or "")
    with try_session_lock(destination_lock_key(destination_id)) as acquired:
        if not acquired:
            return run_again_later(
                LOCK_RETRY_SECONDS,
                progress="Waiting for the job running on this destination",
            )
        try:
            result = test_destination(
                destination_id, should_cancel=lambda: is_cancelled(task_id)
            )
        except DestinationNotFound:
            return {"status": "failed", "error": "The destination no longer exists"}
        except BackupCancelled:
            return {"cancelled": True}
    # Nested: a failing destination is a result of the test, not a failed task.
    return {"destination_id": destination_id, "connection": result.to_dict()}


def _handle_backup_probe_destination(task_id: str, params: dict, config: dict) -> dict:
    """Test unsaved settings (BG1-9); they come from the ephemeral store, once."""
    del config
    from crate.backups import ephemeral
    from crate.backups.connection import ConnectionResult, probe_unsaved

    payload = ephemeral.take(str(params.get("probe_id") or ""))
    if payload is None:
        result = ConnectionResult(
            "failing", "The unsaved settings expired; test the connection again"
        )
    else:
        result = probe_unsaved(
            str(payload.get("kind") or ""),
            dict(payload.get("config") or {}),
            dict(payload.get("secrets") or {}),
            should_cancel=lambda: is_cancelled(task_id),
        )
    return {"connection": result.to_dict()}


# ── policies (BK3) ──────────────────────────────────────────────────


def _message(exc: BaseException) -> str:
    return str(exc) if isinstance(exc, BackupError) else repr(exc)


def _wait_for_window(policy: dict | None) -> dict | None:
    if policy is None:
        return None
    wait = policy_rules.seconds_until_window(policy, local_now())
    if wait:
        return run_again_later(
            wait,
            progress=(
                f"Waiting for the {policy['name']} window "
                f"({policy['window_start']}-{policy['window_end']})"
            ),
        )
    return None


def _lock_busy() -> dict:
    return run_again_later(
        LOCK_RETRY_SECONDS, progress="Waiting for the job running on this destination"
    )


def _dump_path(relative: str):
    path = PurePosixPath(str(relative))
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise BackupError("The dump path must stay inside the backup directory")
    return backup_dir().joinpath(*path.parts)


def _taken_at(params: dict, dump_name: str) -> datetime:
    raw = params.get("taken_at")
    if raw:
        try:
            return datetime.fromisoformat(str(raw))
        except ValueError:
            pass
    return parse_dump_name(dump_name) or datetime.now(UTC)


def _handle_backup_offsite(task_id: str, params: dict, config: dict) -> dict:
    """Copy one dump to one destination of a policy, then prune there."""
    del config
    policy = get_backup_policy(str(params.get("policy_id") or ""))
    if policy is None:
        return {"status": "skipped", "reason": "The policy no longer exists"}
    destination_id = str(params.get("destination_id") or "")
    row = get_backup_destination(destination_id)
    if row is None:
        return {"status": "failed", "error": "The destination no longer exists"}
    if not row["enabled"]:
        return {"status": "skipped", "reason": "The destination is disabled"}
    waiting = None if params.get("ignore_window") else _wait_for_window(policy)
    if waiting:
        return waiting
    tags = [str(t) for t in params.get("tags") or []]
    tiers = [str(t) for t in params.get("destination_tiers") or tags]
    with try_session_lock(destination_lock_key(destination_id)) as acquired:
        if not acquired:
            return _lock_busy()
        recovered = close_interrupted_destination_runs(destination_id)
        run_id = start_backup_run(
            "offsite",
            task_id=task_id,
            policy_id=policy["id"],
            destination_id=destination_id,
            details={"tags": tags},
        )
        try:
            dump_path = _dump_path(str(params.get("dump") or ""))
            if not dump_path.is_file():
                raise BackupError(
                    f"The dump {dump_path.name} no longer exists; local retention "
                    "removed it before this copy ran"
                )
            result = offsite.copy_dump(
                row,
                policy,
                dump_path,
                destination_tiers=tiers,
                tags=tags,
                taken_at=_taken_at(params, dump_path.name),
                recover_locks=recovered > 0,
                should_cancel=lambda: is_cancelled(task_id),
            )
        except BackupCancelled as exc:
            finish_backup_run(run_id, status="failed", error=str(exc))
            return {"run_id": run_id, "cancelled": True}
        except Exception as exc:
            message = _message(exc)
            log.warning("Off-site copy to %s failed: %s", row["name"], message)
            finish_backup_run(run_id, status="failed", error=message)
            record_destination_check(destination_id, status="failing", error=message)
            return {"status": "failed", "error": message, "run_id": run_id}
        finish_backup_run(
            run_id,
            status="succeeded",
            snapshot_id=result.snapshot_id or None,
            size_bytes=result.bytes_added,
            details=result.to_dict(),
        )
        record_destination_check(
            destination_id,
            status="ok",
            snapshot_count=result.snapshot_count,
            repository_bytes=result.repository_bytes,
            initialized=True,
            snapshots=result.snapshots,
        )
    return {"run_id": run_id, **result.to_dict()}


def _handle_backup_verify(task_id: str, params: dict, config: dict) -> dict:
    """``restic check`` reading a subset of one destination's data."""
    del config
    destination_id = str(params.get("destination_id") or "")
    row = get_backup_destination(destination_id)
    if row is None:
        return {"status": "failed", "error": "The destination no longer exists"}
    policy = (
        get_backup_policy(str(params["policy_id"])) if params.get("policy_id") else None
    )
    waiting = _wait_for_window(policy)
    if waiting:
        return waiting
    read_percent = int(
        params.get("read_percent") or (policy or {}).get("verify_read_percent") or 5
    )
    with try_session_lock(destination_lock_key(destination_id)) as acquired:
        if not acquired:
            return _lock_busy()
        recovered = close_interrupted_destination_runs(destination_id)
        run_id = start_backup_run(
            "verify",
            task_id=task_id,
            policy_id=policy["id"] if policy else None,
            destination_id=destination_id,
        )
        try:
            result = offsite.verify_destination(
                row,
                read_percent=read_percent,
                recover_locks=recovered > 0,
                should_cancel=lambda: is_cancelled(task_id),
            )
        except BackupCancelled as exc:
            finish_backup_run(run_id, status="failed", error=str(exc))
            return {"run_id": run_id, "cancelled": True}
        except Exception as exc:
            message = _message(exc)
            log.warning("Verification of %s failed: %s", row["name"], message)
            finish_backup_run(run_id, status="failed", error=message)
            record_destination_check(destination_id, status="failing", error=message)
            return {"status": "failed", "error": message, "run_id": run_id}
        snapshots = result.pop("snapshots", None)
        finish_backup_run(run_id, status="succeeded", details=result)
        record_destination_check(
            destination_id,
            status="ok",
            snapshot_count=result.get("snapshot_count"),
            snapshots=snapshots,
        )
    return {"run_id": run_id, **result}


def _handle_backup_restore_drill(task_id: str, params: dict, config: dict) -> dict:
    """Restore the newest dump of one destination into a throwaway database."""
    del config
    destination_id = str(params.get("destination_id") or "")
    row = get_backup_destination(destination_id)
    if row is None:
        return {"status": "failed", "error": "The destination no longer exists"}
    policy = (
        get_backup_policy(str(params["policy_id"])) if params.get("policy_id") else None
    )
    waiting = _wait_for_window(policy)
    if waiting:
        return waiting
    connection = connection_from_env()
    with try_session_lock(DRILL_LOCK) as drill_free:
        if not drill_free:
            return run_again_later(
                LOCK_RETRY_SECONDS, progress="Waiting for the running restore drill"
            )
        with try_session_lock(destination_lock_key(destination_id)) as acquired:
            if not acquired:
                return _lock_busy()
            recovered = close_interrupted_destination_runs(destination_id)
            run_id = start_backup_run(
                "restore_drill",
                task_id=task_id,
                policy_id=policy["id"] if policy else None,
                destination_id=destination_id,
            )
            try:
                # Under the drill lock no drill runs: what is left was killed.
                leftovers = offsite.clean_drill_leftovers(connection)
                result = offsite.restore_drill(
                    row,
                    connection=connection,
                    recover_locks=recovered > 0,
                    should_cancel=lambda: is_cancelled(task_id),
                )
            except BackupCancelled as exc:
                finish_backup_run(run_id, status="failed", error=str(exc))
                return {"run_id": run_id, "cancelled": True}
            except Exception as exc:
                message = _message(exc)
                log.warning("Restore drill from %s failed: %s", row["name"], message)
                finish_backup_run(run_id, status="failed", error=message)
                return {"status": "failed", "error": message, "run_id": run_id}
            details = {**result.to_dict(), "removed_leftovers": leftovers}
            finish_backup_run(
                run_id,
                status="succeeded",
                snapshot_id=result.snapshot_id,
                details=details,
            )
    return {"run_id": run_id, **details}


def _handle_backup_alerts(task_id: str, params: dict, config: dict) -> dict:
    """Push the backup alerts: one open alert per condition until it clears (BK6)."""
    del task_id, params, config
    from crate.backups.alerts import sync_backup_alerts

    return sync_backup_alerts().summary()


def _handle_backup_policies_tick(task_id: str, params: dict, config: dict) -> dict:
    """Start the due policies; queue the due verifications and restore drills."""
    del task_id, params, config
    now = local_now()
    destinations = {row["id"]: row for row in list_backup_destinations()}
    latest = latest_destination_runs()
    started: list[str] = []
    verify: list[str] = []
    drills: list[str] = []
    for policy in list_backup_policies():
        if policy_rules.is_due(policy, now):
            mark_policy_scheduled(policy["id"])
            _enqueue(
                DUMP_TASK,
                {"policy_id": policy["id"], "ignore_maintenance_window": True},
                f"backup_policy:{policy['id']}",
            )
            started.append(policy["id"])
        if not policy["enabled"] or policy["schedule_kind"] == "manual":
            continue
        usable = [
            destination_id
            for destination_id in policy["destinations"]
            if destination_id in destinations
            and destinations[destination_id]["enabled"]
            and destinations[destination_id]["repository_initialized_at"] is not None
        ]
        for destination_id in usable:
            last = (latest.get(destination_id, {}).get("verify") or {}).get(
                "started_at"
            )
            if destination_id not in verify and policy_rules.verify_due(
                policy, last, now
            ):
                _enqueue(
                    VERIFY_TASK,
                    {
                        "destination_id": destination_id,
                        "policy_id": policy["id"],
                        "read_percent": policy["verify_read_percent"],
                    },
                    f"backup_verify:{destination_id}",
                )
                verify.append(destination_id)
        last_drills = {
            destination_id: latest[destination_id]["restore_drill"]["started_at"]
            for destination_id in usable
            if "restore_drill" in latest.get(destination_id, {})
        }
        source = policy_rules.drill_source(policy, usable, last_drills, now)
        if source and source not in drills:
            _enqueue(
                DRILL_TASK,
                {"destination_id": source, "policy_id": policy["id"]},
                f"backup_restore_drill:{source}",
            )
            drills.append(source)
    return {"started": started, "verify": verify, "drills": drills}


BACKUP_TASK_HANDLERS = {
    "backup_dump": _handle_backup_dump,
    "backup_local_retention": _handle_backup_local_retention,
    "backup_test_destination": _handle_backup_test_destination,
    "backup_probe_destination": _handle_backup_probe_destination,
    "backup_offsite": _handle_backup_offsite,
    "backup_verify": _handle_backup_verify,
    "backup_restore_drill": _handle_backup_restore_drill,
    "backup_policies_tick": _handle_backup_policies_tick,
    "backup_alerts": _handle_backup_alerts,
}

__all__ = [
    "BACKUP_TASK_HANDLERS",
    "DRILL_LOCK",
    "LOCAL_BACKUP_LOCK",
    "destination_lock_key",
]
