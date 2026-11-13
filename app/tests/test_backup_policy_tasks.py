"""Policy tasks of the backups engine: tick, chained copies, verify, drill (BK3)."""

from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from crate.backups import offsite
from crate.backups.connection import test_destination
from crate.backups.destinations import create_destination
from crate.backups.local import DumpResult
from crate.backups.restic import rclone_bin, restic_bin
from crate.db.advisory_locks import try_session_lock
from crate.db.queries.backup_destinations import get_backup_destination
from crate.db.queries.backup_policies import get_backup_policy
from crate.db.queries.backup_runs import list_backup_runs
from crate.db.repositories.backup_destinations import (
    record_destination_check,
    update_backup_destination,
)
from crate.db.repositories.backup_policies import (
    insert_backup_policy,
    set_policy_destinations,
)
from crate.db.repositories.backup_runs import (
    INTERRUPTED_ERROR,
    finish_backup_run,
    start_backup_run,
)
from crate.worker_handlers import RUN_AGAIN_AFTER_KEY
from crate.worker_handlers import backups

MADRID = ZoneInfo("Europe/Madrid")
NEW_TASKS = ("backup_offsite", "backup_verify", "backup_restore_drill")


@pytest.fixture
def backup_root(tmp_path, monkeypatch):
    root = tmp_path / "backups"
    root.mkdir()
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(root))
    monkeypatch.delenv("CRATE_LOCAL_BACKUPS_ENABLED", raising=False)
    monkeypatch.setattr(backups, "is_cancelled", lambda task_id: False)
    return root


@pytest.fixture
def queued(monkeypatch):
    calls: list[tuple[str, dict, str]] = []

    def enqueue(task_type, params, dedup_key):
        calls.append((task_type, params, dedup_key))
        return f"task-{len(calls)}"

    monkeypatch.setattr(backups, "_enqueue", enqueue)
    return calls


def _now(monkeypatch, text: str) -> datetime:
    now = datetime.fromisoformat(text).replace(tzinfo=MADRID)
    monkeypatch.setattr(backups, "local_now", lambda: now)
    return now


def _destination(name: str, *, tested: bool = True, enabled: bool = True) -> str:
    row = create_destination(kind="local", name=name, config={"path": name.lower()})
    if tested:
        record_destination_check(row["id"], status="ok", error=None, initialized=True)
    if not enabled:
        update_backup_destination(row["id"], enabled=False)
    return row["id"]


def test_the_new_tasks_are_wired():
    from crate.actors import TASK_POOL_CONFIG
    from crate.resource_governor import RESOURCE_GOVERNED_TASK_TYPES
    from crate.scheduler import DEFAULT_SCHEDULES
    from crate.task_registry import TASK_TYPES
    from crate.worker import TASK_HANDLERS

    for task_type in (*NEW_TASKS, "backup_policies_tick"):
        config = TASK_POOL_CONFIG[task_type]
        assert config.queue == "maintenance" and config.max_retries == 0
        assert task_type in TASK_TYPES and task_type in TASK_HANDLERS
    for task_type in NEW_TASKS:
        assert task_type in RESOURCE_GOVERNED_TASK_TYPES
    assert "backup_policies_tick" not in RESOURCE_GOVERNED_TASK_TYPES
    assert DEFAULT_SCHEDULES["backup_policies_tick"] == 300


def test_policies_take_over_the_default_dump_schedule(pg_db, monkeypatch):
    del pg_db
    from crate import scheduler

    monkeypatch.delenv("CRATE_LOCAL_BACKUPS_ENABLED", raising=False)
    assert scheduler._scheduled_task_enabled("backup_dump")
    assert not scheduler._scheduled_task_enabled("backup_policies_tick")

    policy = insert_backup_policy(
        name="Nightly", schedule_kind="daily", daily_at="03:30"
    )
    assert not scheduler._scheduled_task_enabled("backup_dump")
    assert scheduler._scheduled_task_enabled("backup_policies_tick")

    from crate.db.repositories.backup_policies import update_backup_policy

    update_backup_policy(policy["id"], enabled=False)
    assert scheduler._scheduled_task_enabled("backup_dump")
    assert not scheduler._scheduled_task_enabled("backup_policies_tick")


def test_the_tick_starts_a_due_policy_once(pg_db, backup_root, queued, monkeypatch):
    del pg_db, backup_root
    volume = _destination("Volume")
    policy = insert_backup_policy(
        name="Nightly",
        schedule_kind="daily",
        daily_at="03:30",
        verify_every_days=0,
        drill_every_days=0,
    )
    set_policy_destinations(policy["id"], {volume: ["daily"]})
    insert_backup_policy(name="Manual", schedule_kind="manual")

    _now(monkeypatch, "2026-11-10T03:29")
    assert backups._handle_backup_policies_tick("tick", {}, {})["started"] == []
    _now(monkeypatch, "2026-11-10T03:31")
    result = backups._handle_backup_policies_tick("tick", {}, {})
    assert result["started"] == [policy["id"]]
    assert queued == [
        (
            "backup_dump",
            {"policy_id": policy["id"], "ignore_maintenance_window": True},
            f"backup_policy:{policy['id']}",
        )
    ]
    marked = get_backup_policy(policy["id"])
    assert marked is not None and marked["last_scheduled_at"] is not None
    assert backups._handle_backup_policies_tick("tick", {}, {})["started"] == []
    assert len(queued) == 1


def test_the_tick_queues_verifications_and_the_rotating_drill(
    pg_db, backup_root, queued, monkeypatch
):
    del pg_db, backup_root
    volume, bucket = _destination("Volume"), _destination("Bucket")
    untested = _destination("Dropbox", tested=False)
    policy = insert_backup_policy(
        name="Nightly",
        schedule_kind="daily",
        daily_at="03:30",
        verify_every_days=7,
        verify_read_percent=5,
        drill_every_days=30,
    )
    set_policy_destinations(
        policy["id"], {volume: ["daily"], bucket: ["weekly"], untested: ["daily"]}
    )
    # The volume was drilled and verified recently; the bucket never was.
    for kind in ("verify", "restore_drill"):
        run = start_backup_run(kind, destination_id=volume)
        finish_backup_run(run, status="succeeded")

    _now(monkeypatch, "2026-11-10T12:00")
    result = backups._handle_backup_policies_tick("tick", {}, {})

    verify = [c for c in queued if c[0] == "backup_verify"]
    assert verify == [
        (
            "backup_verify",
            {"destination_id": bucket, "policy_id": policy["id"], "read_percent": 5},
            f"backup_verify:{bucket}",
        )
    ]
    # The last drill was today, so no drill is due for the policy yet.
    assert [c for c in queued if c[0] == "backup_restore_drill"] == []
    assert result["verify"] == [bucket]


def _fake_dump(backup_root: Path, monkeypatch) -> Path:
    folder = backup_root / "dumps"
    folder.mkdir(exist_ok=True)
    path = folder / "crate-20261110T023000Z.dump"
    path.write_bytes(b"PGDMP fake")

    def dump_database(folder, **kwargs):
        return DumpResult(path=path, size_bytes=10, sha256="0" * 64)

    monkeypatch.setattr(backups, "dump_database", dump_database)
    return path


def test_a_policy_dump_chains_the_copies_of_its_due_tiers(
    pg_db, backup_root, queued, monkeypatch
):
    del pg_db
    path = _fake_dump(backup_root, monkeypatch)
    volume, bucket = _destination("Volume"), _destination("Bucket")
    disabled = _destination("Off", enabled=False)
    untested = _destination("New", tested=False)
    policy = insert_backup_policy(
        name="Nightly", schedule_kind="daily", daily_at="03:30"
    )
    set_policy_destinations(
        policy["id"],
        {
            volume: ["daily", "weekly"],
            bucket: ["monthly"],
            disabled: ["daily"],
            untested: ["daily"],
        },
    )
    # The bucket already got this month's copy.
    run = start_backup_run(
        "offsite", destination_id=bucket, details={"tags": ["monthly"]}
    )
    finish_backup_run(run, status="succeeded")
    _now(monkeypatch, "2026-11-10T03:30")

    result = backups._handle_backup_dump("t1", {"policy_id": policy["id"]}, {})

    assert result["run_id"]
    dump_run = list_backup_runs(kind="dump")[0]
    assert dump_run["policy_id"] == policy["id"]
    copies = [c for c in queued if c[0] == "backup_offsite"]
    assert len(copies) == 1
    task_type, params, dedup = copies[0]
    assert params["destination_id"] == volume
    assert params["policy_id"] == policy["id"]
    assert params["tags"] == ["daily", "weekly"]
    assert params["destination_tiers"] == ["daily", "weekly"]
    assert params["dump"] == path.relative_to(backup_root).as_posix()
    assert dedup == f"backup_offsite:{policy['id']}:{volume}"
    assert result["offsite_task_ids"] == ["task-2"]
    assert [c[0] for c in queued] == ["backup_local_retention", "backup_offsite"]


def test_the_offsite_task_waits_for_the_window_and_the_lock(
    pg_db, backup_root, monkeypatch
):
    del pg_db, backup_root
    volume = _destination("Volume")
    policy = insert_backup_policy(
        name="Nightly",
        schedule_kind="daily",
        daily_at="03:30",
        window_start="02:00",
        window_end="06:00",
    )
    params = {
        "policy_id": policy["id"],
        "destination_id": volume,
        "dump": "dumps/crate-20261110T023000Z.dump",
        "tags": ["daily"],
        "destination_tiers": ["daily"],
    }
    _now(monkeypatch, "2026-11-10T07:00")
    waiting = backups._handle_backup_offsite("t1", params, {})
    assert waiting[RUN_AGAIN_AFTER_KEY] == 19 * 3600

    _now(monkeypatch, "2026-11-10T03:00")
    with try_session_lock(backups.destination_lock_key(volume)) as acquired:
        assert acquired
        busy = backups._handle_backup_offsite("t1", params, {})
    assert RUN_AGAIN_AFTER_KEY in busy
    assert list_backup_runs(kind="offsite") == []


def test_the_offsite_task_records_a_missing_dump_as_failed(
    pg_db, backup_root, monkeypatch
):
    del pg_db, backup_root
    volume = _destination("Volume")
    policy = insert_backup_policy(name="Manual", schedule_kind="manual")
    _now(monkeypatch, "2026-11-10T03:00")
    result = backups._handle_backup_offsite(
        "t1",
        {
            "policy_id": policy["id"],
            "destination_id": volume,
            "dump": "dumps/crate-20261101T023000Z.dump",
            "tags": ["daily"],
            "destination_tiers": ["daily"],
        },
        {},
    )
    assert result["status"] == "failed"
    run = list_backup_runs(kind="offsite")[0]
    assert run["status"] == "failed" and "no longer exists" in run["error"]


def test_a_restart_closes_the_destinations_runs_and_unlocks(
    pg_db, backup_root, monkeypatch
):
    del pg_db
    path = backup_root / "dumps" / "crate-20261110T023000Z.dump"
    path.parent.mkdir()
    path.write_bytes(b"PGDMP")
    volume = _destination("Volume")
    policy = insert_backup_policy(name="Manual", schedule_kind="manual")
    stale = start_backup_run("verify", destination_id=volume, task_id="killed")
    calls = {}

    def copy_dump(row, policy, dump_path, **kwargs):
        calls.update(kwargs, dump_path=dump_path)
        return offsite.CopyResult(
            snapshot_id="a91f03c2",
            bytes_added=42,
            snapshot_count=4,
            repository_bytes=4096,
            removed_snapshots=1,
            tags=["daily"],
        )

    monkeypatch.setattr(offsite, "copy_dump", copy_dump)
    _now(monkeypatch, "2026-11-10T03:00")
    result = backups._handle_backup_offsite(
        "t2",
        {
            "policy_id": policy["id"],
            "destination_id": volume,
            "dump": "dumps/crate-20261110T023000Z.dump",
            "tags": ["daily"],
            "destination_tiers": ["daily"],
        },
        {},
    )

    assert result["snapshot_id"] == "a91f03c2"
    assert calls["recover_locks"] is True and calls["dump_path"] == path
    runs = {r["id"]: r for r in list_backup_runs(destination_id=volume)}
    assert runs[stale]["status"] == "failed"
    assert runs[stale]["error"] == INTERRUPTED_ERROR
    copy = next(r for r in runs.values() if r["kind"] == "offsite")
    assert (copy["status"], copy["snapshot_id"], copy["bytes"]) == (
        "succeeded",
        "a91f03c2",
        42,
    )
    assert copy["details"]["tags"] == ["daily"]
    row = get_backup_destination(volume)
    assert row is not None
    assert (row["status"], row["snapshot_count"], row["repository_bytes"]) == (
        "ok",
        4,
        4096,
    )


def test_a_failed_copy_marks_the_destination_failing(pg_db, backup_root, monkeypatch):
    del pg_db
    path = backup_root / "dumps" / "crate-20261110T023000Z.dump"
    path.parent.mkdir()
    path.write_bytes(b"PGDMP")
    volume = _destination("Volume")
    policy = insert_backup_policy(name="Manual", schedule_kind="manual")

    def copy_dump(*args, **kwargs):
        from crate.backups.restic import ResticError

        raise ResticError("restic exited with 1: Permission denied (publickey)")

    monkeypatch.setattr(offsite, "copy_dump", copy_dump)
    _now(monkeypatch, "2026-11-10T03:00")
    result = backups._handle_backup_offsite(
        "t1",
        {
            "policy_id": policy["id"],
            "destination_id": volume,
            "dump": "dumps/crate-20261110T023000Z.dump",
            "tags": ["daily"],
            "destination_tiers": ["daily"],
        },
        {},
    )
    assert result["status"] == "failed"
    row = get_backup_destination(volume)
    assert row is not None and row["status"] == "failing"
    assert "Permission denied" in row["last_error"]


def test_the_drill_task_holds_the_drill_lock_and_cleans_leftovers(
    pg_db, backup_root, monkeypatch
):
    del pg_db, backup_root
    volume = _destination("Volume")
    start_backup_run("restore_drill", destination_id=volume, task_id="killed")
    cleaned = []
    monkeypatch.setattr(
        offsite, "clean_drill_leftovers", lambda connection: cleaned.append(1) or []
    )

    def restore_drill(row, **kwargs):
        assert kwargs["recover_locks"] is True
        return offsite.DrillResult(
            snapshot_id="0d4c7a3e",
            snapshot_time="2026-11-10T03:30:00Z",
            database="crate_restore_drill_0123456789ab",
            toc_entries=900,
            tables=120,
            rows={"library_tracks": 48212},
            alembic_revision="164",
        )

    monkeypatch.setattr(offsite, "restore_drill", restore_drill)
    with try_session_lock(backups.DRILL_LOCK) as acquired:
        assert acquired
        busy = backups._handle_backup_restore_drill(
            "t1", {"destination_id": volume}, {}
        )
    assert RUN_AGAIN_AFTER_KEY in busy

    result = backups._handle_backup_restore_drill("t2", {"destination_id": volume}, {})
    assert cleaned == [1]
    assert result["rows"] == {"library_tracks": 48212}
    drill = list_backup_runs(kind="restore_drill")[0]
    assert drill["status"] == "succeeded" and drill["snapshot_id"] == "0d4c7a3e"


def test_the_drill_runs_in_a_worker_with_a_one_plus_one_pool(
    pg_db, backup_root, monkeypatch
):
    """Production workers run with pool 1 + 1; the drill's two locks share one."""
    from crate.db.engine import reset_engine

    del pg_db, backup_root
    volume = _destination("Volume")
    monkeypatch.setenv("CRATE_SQLALCHEMY_POOL_SIZE", "1")
    monkeypatch.setenv("CRATE_SQLALCHEMY_MAX_OVERFLOW", "1")
    monkeypatch.setenv("CRATE_SQLALCHEMY_POOL_TIMEOUT_SECONDS", "1")
    reset_engine()
    monkeypatch.setattr(offsite, "clean_drill_leftovers", lambda connection: [])
    monkeypatch.setattr(
        offsite,
        "restore_drill",
        lambda row, **kwargs: offsite.DrillResult(
            snapshot_id="0d4c7a3e",
            snapshot_time="2026-11-10T03:30:00Z",
            database="crate_restore_drill_0123456789ab",
            toc_entries=900,
            tables=120,
            rows={"library_tracks": 48212},
            alembic_revision="164",
        ),
    )
    try:
        result = backups._handle_backup_restore_drill(
            "t1", {"destination_id": volume}, {}
        )
        with try_session_lock(backups.destination_lock_key(volume)) as acquired:
            assert acquired
            busy = backups._handle_backup_restore_drill(
                "t2", {"destination_id": volume}, {}
            )
    finally:
        reset_engine()

    assert result["snapshot_id"] == "0d4c7a3e"
    assert busy == backups._lock_busy()
    # The drill lock taken before the busy destination lock was released.
    with try_session_lock(backups.DRILL_LOCK) as drill_free:
        assert drill_free


@pytest.mark.skipif(
    shutil.which(restic_bin()) is None or shutil.which(rclone_bin()) is None,
    reason="restic and rclone required",
)
def test_a_real_copy_and_verify_through_the_tasks(pg_db, backup_root, monkeypatch):
    del pg_db
    path = backup_root / "dumps" / "crate-20261110T023000Z.dump"
    path.parent.mkdir()
    path.write_bytes(os.urandom(4096))
    created = create_destination(kind="local", name="Volume", config={"path": "restic"})
    assert test_destination(created["id"]).status == "ok"
    policy = insert_backup_policy(name="Manual", schedule_kind="manual", keep_daily=2)
    _now(monkeypatch, "2026-11-10T03:00")

    copied = backups._handle_backup_offsite(
        "t1",
        {
            "policy_id": policy["id"],
            "destination_id": created["id"],
            "dump": "dumps/crate-20261110T023000Z.dump",
            "tags": ["daily", "weekly", "monthly"],
            "destination_tiers": ["daily", "weekly", "monthly"],
            "taken_at": (
                datetime(2026, 11, 10, 2, 30, tzinfo=timezone.utc)
            ).isoformat(),
        },
        {},
    )
    assert copied["snapshot_count"] == 1
    verified = backups._handle_backup_verify(
        "t2", {"destination_id": created["id"], "read_percent": 100}, {}
    )
    assert verified["read_percent"] == 100
    kinds = [r["kind"] for r in list_backup_runs(destination_id=created["id"])]
    assert kinds == ["verify", "offsite"]


def test_local_dumps_keep_their_own_retention_counts(pg_db, monkeypatch):
    """BG1-5: the local counts are set from Admin, apart from the policies."""
    del pg_db
    from crate.backups.settings import (
        DEFAULT_RETENTION,
        retention_policy,
        set_local_retention,
    )

    for tier in ("DAILY", "WEEKLY", "MONTHLY"):
        monkeypatch.delenv(f"CRATE_BACKUP_KEEP_{tier}", raising=False)
    assert retention_policy() == DEFAULT_RETENTION  # BK0's 3/4/3
    monkeypatch.setenv("CRATE_BACKUP_KEEP_DAILY", "5")
    assert retention_policy().daily == 5

    set_local_retention(daily=7, weekly=2, monthly=12)
    policy = retention_policy()
    assert (policy.daily, policy.weekly, policy.monthly) == (7, 2, 12)
    # A task's own counts still win, as in BK1.
    assert retention_policy({"keep_daily": 1}).daily == 1
    with pytest.raises(ValueError):
        set_local_retention(daily=0, weekly=0, monthly=0)
    with pytest.raises(ValueError):
        set_local_retention(daily=-1, weekly=1, monthly=1)
