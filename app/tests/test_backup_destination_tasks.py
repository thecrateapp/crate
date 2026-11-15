"""The backup_test_destination task (admin backups, BK2)."""

from __future__ import annotations

import logging

import pytest

from crate.backups.connection import ConnectionResult
from crate.backups.destinations import create_destination, get_destination
from crate.db.advisory_locks import try_session_lock
from crate.worker_handlers import RUN_AGAIN_AFTER_KEY
from crate.worker_handlers import backups


def test_the_task_is_registered_on_the_default_queue():
    from crate.actors import TASK_POOL_CONFIG
    from crate.task_registry import TASK_TYPES
    from crate.worker import TASK_HANDLERS

    config = TASK_POOL_CONFIG["backup_test_destination"]
    assert (config.queue, config.priority, config.max_retries) == ("default", 0, 0)
    assert TASK_HANDLERS["backup_test_destination"] is (
        backups._handle_backup_test_destination
    )
    assert "backup_test_destination" in TASK_TYPES


@pytest.fixture
def no_cancel(monkeypatch):
    monkeypatch.setattr(backups, "is_cancelled", lambda task_id: False)


def test_a_failing_destination_is_a_result_not_a_failed_task(
    pg_db, no_cancel, monkeypatch, tmp_path, caplog
):
    del pg_db
    caplog.set_level(logging.DEBUG)
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    destination = create_destination(kind="local", name="Volume", config={"path": "r"})

    import crate.backups.connection as connection

    monkeypatch.setattr(
        connection,
        "check_destination",
        lambda row, should_cancel=None: ConnectionResult("failing", "Access denied"),
    )
    result = backups._handle_backup_test_destination(
        "task-1", {"destination_id": destination["id"]}, {}
    )

    assert "error" not in result and result.get("status") != "failed"
    assert result["connection"]["status"] == "failing"
    assert result["connection"]["error"] == "Access denied"


def test_one_job_per_destination(pg_db, no_cancel):
    del pg_db
    destination = create_destination(kind="local", name="Volume", config={"path": "r"})

    with try_session_lock(backups.destination_lock_key(destination["id"])) as held:
        assert held
        result = backups._handle_backup_test_destination(
            "task-1", {"destination_id": destination["id"]}, {}
        )
    assert RUN_AGAIN_AFTER_KEY in result


@pytest.fixture
def backup_root(tmp_path, monkeypatch):
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    return tmp_path


def test_a_worker_without_the_tools_marks_the_destination_unavailable(
    pg_db, backup_root, monkeypatch
):
    del pg_db, backup_root
    view = create_destination(kind="local", name="Volume", config={"path": "restic"})
    import crate.backups.connection as connection

    monkeypatch.setattr(connection, "tools_available", lambda: ["restic"])

    result = connection.test_destination(view["id"])
    assert result.status == "unavailable"
    stored = get_destination(view["id"])
    assert stored is not None and stored["status"] == "unavailable"
    assert "restic" in (stored["last_error"] or "")


def test_a_deleted_destination_fails_the_task(pg_db, no_cancel):
    del pg_db
    result = backups._handle_backup_test_destination(
        "task-1", {"destination_id": "6f1c1a0c-5d1e-4d43-a9f8-6d2b1c1c9e10"}, {}
    )
    assert result["status"] == "failed"
