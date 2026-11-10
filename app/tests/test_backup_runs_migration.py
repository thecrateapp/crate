"""Migration 162 adds backup_runs, the record of every backups engine job (BK1)."""

from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.db.queries.backup_runs import (
    get_backup_run,
    latest_successful_dump,
    list_backup_runs,
)
from crate.db.repositories.backup_runs import (
    INTERRUPTED_ERROR,
    close_interrupted_backup_runs,
    finish_backup_run,
    start_backup_run,
)
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.backup_runs_v162 import (
    create_backup_runs_v162_schema,
    drop_backup_runs_v162_schema,
)
from crate.db.tx import transaction_scope
from tests.test_agent_access_migration import RecordingExecutor

MIGRATION = "crate.db.migrations.versions.162_backup_runs"
CHECKSUM = "a" * 64


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_backup_runs_v162_schema(section)
    create_schema(bootstrap)

    # 161 belongs to PR #409; 162 follows main's head until #409 merges.
    assert migration.revision == "162" and migration.down_revision == "160"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_backup_runs_v162_schema(expected)
    assert (
        downgrade.statements
        == expected.statements
        == ["DROP TABLE IF EXISTS backup_runs"]
    )


def test_a_run_opens_running_and_closes_with_its_dump(pg_db):
    del pg_db

    run_id = start_backup_run("dump", task_id="task-1")
    running = get_backup_run(run_id)
    assert running is not None
    assert (running["kind"], running["status"], running["task_id"]) == (
        "dump",
        "running",
        "task-1",
    )
    assert running["finished_at"] is None

    assert finish_backup_run(
        run_id,
        status="succeeded",
        path="dumps/crate-20261110T030000Z.dump",
        size_bytes=1234,
        checksum=CHECKSUM,
        details={"database": "crate"},
    )
    done = get_backup_run(run_id)
    assert done is not None
    assert done["status"] == "succeeded"
    assert done["finished_at"] is not None
    assert (done["path"], done["bytes"], done["checksum"]) == (
        "dumps/crate-20261110T030000Z.dump",
        1234,
        CHECKSUM,
    )
    assert done["details"] == {"database": "crate"}
    # A finished run stays finished.
    assert not finish_backup_run(run_id, status="failed", error="late")
    assert latest_successful_dump() == done


def test_failed_runs_keep_a_bounded_error_and_no_dump(pg_db):
    del pg_db

    run_id = start_backup_run("dump")
    assert finish_backup_run(run_id, status="failed", error="x" * 5000)

    failed = get_backup_run(run_id)
    assert failed is not None
    assert failed["status"] == "failed"
    assert len(failed["error"]) == 2000
    assert failed["path"] is None and failed["checksum"] is None
    assert latest_successful_dump() is None


def test_interrupted_runs_are_closed_per_kind(pg_db):
    del pg_db

    dump = start_backup_run("dump")
    retention = start_backup_run("local_retention")

    assert close_interrupted_backup_runs("dump") == 1
    closed = get_backup_run(dump)
    assert closed is not None
    assert (closed["status"], closed["error"]) == ("failed", INTERRUPTED_ERROR)
    still = get_backup_run(retention)
    assert still is not None and still["status"] == "running"
    assert [run["id"] for run in list_backup_runs(kind="dump")] == [dump]
    assert [run["id"] for run in list_backup_runs(status="running")] == [retention]


def test_unknown_kinds_and_statuses_are_refused(pg_db):
    del pg_db

    with pytest.raises(ValueError):
        start_backup_run("upload")
    run_id = start_backup_run("dump")
    with pytest.raises(ValueError):
        finish_backup_run(run_id, status="running")
    assert get_backup_run("not-a-uuid") is None


@pytest.mark.parametrize(
    "columns, values",
    [
        ("kind, status", "'dump', 'paused'"),
        ("kind", "'upload'"),
        ("kind, checksum", "'dump', 'not-a-sha256'"),
        ("kind, bytes", "'dump', -1"),
        # A finished run has a finish time; a running one has none.
        ("kind, status", "'dump', 'succeeded'"),
        ("kind, finished_at", "'dump', now()"),
    ],
)
def test_the_table_checks_its_values(pg_db, columns, values):
    del pg_db

    with pytest.raises(IntegrityError):
        with transaction_scope() as session:
            session.execute(
                text(f"INSERT INTO backup_runs ({columns}) VALUES ({values})")
            )
