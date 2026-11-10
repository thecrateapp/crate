"""The backup_dump and backup_local_retention tasks (admin backups, BK1)."""

from __future__ import annotations

import hashlib
import os
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from crate.backups.local import Connection, dump_name
from crate.db.advisory_locks import try_session_lock
from crate.db.queries.backup_runs import list_backup_runs
from crate.db.repositories.backup_runs import INTERRUPTED_ERROR, start_backup_run
from crate.worker_handlers import RUN_AGAIN_AFTER_KEY
from crate.worker_handlers import backups

UTC = timezone.utc


@pytest.fixture
def backup_root(tmp_path, monkeypatch):
    root = tmp_path / "backups"
    root.mkdir()
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(root))
    monkeypatch.setattr(backups, "is_cancelled", lambda task_id: False)
    return root


@pytest.fixture
def queued(monkeypatch):
    calls: list[str] = []

    def enqueue():
        calls.append(backups.RETENTION_TASK)
        return "retention-task"

    monkeypatch.setattr(backups, "_enqueue_retention", enqueue)
    return calls


def _pg_dump_on_path(tmp_path: Path, monkeypatch, body: str) -> Path:
    """Put a fake ``pg_dump`` first on PATH; it writes ``$out`` (its ``-f``)."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    marker = tmp_path / "pg_dump-ran"
    script = bin_dir / "pg_dump"
    script.write_text(
        "#!/bin/sh\n"
        f'touch "{marker}"\n'
        'while [ "$#" -gt 0 ]; do\n'
        '  if [ "$1" = "-f" ]; then out="$2"; fi\n'
        "  shift\n"
        "done\n" + body
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    return marker


def _files(root: Path) -> list[str]:
    return sorted(
        p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()
    )


def test_the_tasks_run_on_the_maintenance_queue_without_retries():
    from crate.actors import TASK_POOL_CONFIG
    from crate.resource_governor import (
        MAINTENANCE_WINDOW_TASK_TYPES,
        RESOURCE_GOVERNED_TASK_TYPES,
    )
    from crate.task_registry import TASK_TYPES
    from crate.worker import TASK_HANDLERS

    for task_type in ("backup_dump", "backup_local_retention"):
        config = TASK_POOL_CONFIG[task_type]
        assert (config.queue, config.max_retries) == ("maintenance", 0)
        assert TASK_HANDLERS.get(task_type) is backups.BACKUP_TASK_HANDLERS[task_type]
        assert TASK_TYPES[task_type].category == "library"
    # The dump waits for the maintenance window and for the governor's go-ahead.
    assert "backup_dump" in RESOURCE_GOVERNED_TASK_TYPES
    assert "backup_dump" in MAINTENANCE_WINDOW_TASK_TYPES
    assert TASK_POOL_CONFIG["backup_dump"].time_limit_seconds > (
        backups.DUMP_TIMEOUT_SECONDS
    )


def test_a_dump_records_its_run_and_queues_retention(
    pg_db, backup_root, queued, tmp_path, monkeypatch
):
    del pg_db
    _pg_dump_on_path(tmp_path, monkeypatch, 'printf "PGDMP-archive" > "$out"\n')

    result = backups._handle_backup_dump("task-dump", {}, {})

    [name] = [p for p in _files(backup_root) if p.endswith(".dump")]
    digest = hashlib.sha256(b"PGDMP-archive").hexdigest()
    assert result["path"] == name and name.startswith("dumps/crate-")
    assert (result["bytes"], result["sha256"]) == (len(b"PGDMP-archive"), digest)
    assert result["retention_task_id"] == "retention-task"
    assert queued == ["backup_local_retention"]
    [run] = list_backup_runs(kind="dump")
    assert run["id"] == result["run_id"]
    assert (run["status"], run["task_id"], run["path"]) == (
        "succeeded",
        "task-dump",
        name,
    )
    assert (run["bytes"], run["checksum"]) == (len(b"PGDMP-archive"), digest)


def test_a_failed_dump_leaves_no_file_and_records_a_failed_run(
    pg_db, backup_root, queued, tmp_path, monkeypatch
):
    del pg_db
    monkeypatch.setattr(
        backups,
        "connection_from_env",
        lambda: Connection("db", "5432", "crate", "hunter2", "crate"),
    )
    _pg_dump_on_path(
        tmp_path,
        monkeypatch,
        'printf "PGDMP-half" > "$out"\necho "server closed hunter2" >&2\nexit 1\n',
    )

    result = backups._handle_backup_dump("task-dump", {}, {})

    assert result["status"] == "failed"
    assert _files(backup_root) == []
    assert queued == []
    [run] = list_backup_runs(kind="dump")
    assert run["status"] == "failed"
    assert "pg_dump exited with 1" in run["error"]
    assert "hunter2" not in run["error"]
    assert run["path"] is None and run["checksum"] is None


def test_a_dump_without_its_backup_directory_fails_without_creating_it(
    pg_db, tmp_path, monkeypatch, queued
):
    del pg_db
    missing = tmp_path / "not-mounted"
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(missing))
    marker = _pg_dump_on_path(tmp_path, monkeypatch, 'printf "PGDMP" > "$out"\n')

    result = backups._handle_backup_dump("task-dump", {}, {})

    assert result["status"] == "failed"
    assert "does not exist" in result["error"]
    assert not missing.exists() and not marker.exists()
    assert [run["status"] for run in list_backup_runs(kind="dump")] == ["failed"]


def test_only_one_backup_job_runs_at_a_time(
    pg_db, backup_root, queued, tmp_path, monkeypatch
):
    del pg_db
    marker = _pg_dump_on_path(tmp_path, monkeypatch, 'printf "PGDMP" > "$out"\n')

    with try_session_lock(backups.LOCAL_BACKUP_LOCK) as held:
        assert held
        dump = backups._handle_backup_dump("task-dump", {}, {})
        retention = backups._handle_backup_local_retention("task-ret", {}, {})

    assert dump == {"status": "skipped", "reason": "Another backup job is running"}
    assert retention[RUN_AGAIN_AFTER_KEY] == backups.LOCK_RETRY_SECONDS
    # Nothing ran, nothing was written and no run was recorded.
    assert not marker.exists()
    assert _files(backup_root) == []
    assert list_backup_runs() == []
    # Released: the next job takes the lock.
    assert backups._handle_backup_dump("task-dump-2", {}, {})["path"]


def test_the_lock_is_one_holder_at_a_time(pg_db):
    del pg_db

    with try_session_lock("crate:test:lock") as first:
        with try_session_lock("crate:test:lock") as second:
            assert (first, second) == (True, False)
        with try_session_lock("crate:test:other") as other:
            assert other is True
    with try_session_lock("crate:test:lock") as again:
        assert again is True


def test_a_dump_closes_the_run_a_killed_worker_left_and_its_partial(
    pg_db, backup_root, queued, tmp_path, monkeypatch
):
    del pg_db
    stale = start_backup_run("dump", task_id="killed")
    (backup_root / "dumps").mkdir()
    (backup_root / "dumps" / ".crate-dump-dead.partial").write_bytes(b"PGD")
    _pg_dump_on_path(tmp_path, monkeypatch, 'printf "PGDMP" > "$out"\n')

    result = backups._handle_backup_dump("task-dump", {}, {})

    runs = {run["id"]: run for run in list_backup_runs(kind="dump")}
    assert (runs[stale]["status"], runs[stale]["error"]) == (
        "failed",
        INTERRUPTED_ERROR,
    )
    assert runs[result["run_id"]]["status"] == "succeeded"
    assert [p for p in _files(backup_root) if "partial" in p] == []


def test_retention_prunes_the_dumps_and_records_what_it_kept(pg_db, backup_root):
    del pg_db
    dumps = backup_root / "dumps"
    dumps.mkdir()
    newest = datetime(2026, 11, 11, 3, tzinfo=UTC)
    names = [dump_name(newest - timedelta(days=n)) for n in range(5)]
    for name in names:
        (dumps / name).write_bytes(b"PGDMP")
        (dumps / f"{name}.sha256").write_text(f"{'0' * 64}  {name}\n")

    result = backups._handle_backup_local_retention(
        "task-ret", {"keep_daily": 2, "keep_weekly": 0, "keep_monthly": 0}, {}
    )

    assert result["kept"] == names[:2]
    assert result["deleted"] == sorted(names[2:])
    assert _files(backup_root) == sorted(
        f"dumps/{n}{suffix}" for n in names[:2] for suffix in ("", ".sha256")
    )
    [run] = list_backup_runs(kind="local_retention")
    assert run["status"] == "succeeded"
    assert run["details"]["kept"] == names[:2]
    assert run["details"]["keep_daily"] == 2


def test_retention_refuses_a_bad_policy_without_touching_files(pg_db, backup_root):
    del pg_db
    dumps = backup_root / "dumps"
    dumps.mkdir()
    (dumps / dump_name(datetime(2026, 11, 11, tzinfo=UTC))).write_bytes(b"PGDMP")

    result = backups._handle_backup_local_retention("task-ret", {"keep_daily": "3"}, {})

    assert result["status"] == "failed"
    assert len(_files(backup_root)) == 1
