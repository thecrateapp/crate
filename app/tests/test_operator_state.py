"""Independent disk durability; these tests need no Crate services."""

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator.state import (
    LIMITS,
    RETENTION_SECONDS,
    CapacityError,
    State,
    enqueue,
    event,
    prune,
)


def test_single_writer_restart_and_transaction_rollback(tmp_path):
    state = State(tmp_path)
    with pytest.raises(RuntimeError, match="writer"):
        State(tmp_path)
    with state.transaction() as data:
        event(data, "created", {"key": "one"}, 100)
        enqueue(data, "message", 100)
    committed = state.snapshot()
    with pytest.raises(RuntimeError), state.transaction() as data:
        event(data, "rolled_back", {}, 101)
        raise RuntimeError("synthetic transaction abort")
    assert state.snapshot() == committed
    state.close()
    reopened = State(tmp_path)
    assert reopened.snapshot() == committed
    assert os.stat(tmp_path / "state.json").st_mode & 0o777 == 0o600
    reopened.close()


def test_pre_replace_crash_preserves_committed_state(tmp_path, monkeypatch):
    state = State(tmp_path)
    with state.transaction() as data:
        event(data, "before", {}, 1)
    with monkeypatch.context() as patch:
        patch.setattr(
            os, "replace", lambda *_: (_ for _ in ()).throw(OSError("synthetic crash"))
        )
        with pytest.raises(OSError), state.transaction() as data:
            event(data, "not_committed", {}, 2)
    state.close()
    reopened = State(tmp_path)
    assert [item["kind"] for item in reopened.events()["events"]] == ["before"]
    reopened.close()


def test_post_replace_state_is_durable_and_fsync_failure_is_fatal(
    tmp_path, monkeypatch
):
    state = State(tmp_path)
    fsync = os.fsync
    calls = []

    def fail_directory(fd):
        calls.append(fd)
        if len(calls) == 2:
            raise OSError("directory fsync fault")
        fsync(fd)

    with monkeypatch.context() as patch:
        patch.setattr(os, "fsync", fail_directory)
        with pytest.raises(OSError), state.transaction() as data:
            event(data, "replaced", {}, 2)
    with pytest.raises(OSError):
        state.snapshot()
    state.close()
    reopened = State(tmp_path)
    assert reopened.snapshot()["sequence"] == 1
    reopened.close()


def test_event_cursor_retention_and_pending_backpressure(tmp_path, monkeypatch):
    monkeypatch.setitem(LIMITS, "events", 3)
    monkeypatch.setitem(LIMITS, "outbox", 2)
    state = State(tmp_path)
    with state.transaction() as data:
        for number in range(5):
            event(data, "sample", {}, number)
        enqueue(data, "one", 1)
        enqueue(data, "two", 2)
    page = state.events(0, 2)
    assert page["retention_gap"] and page["oldest_cursor"] == 2
    assert [row["seq"] for row in page["events"]] == [3, 4]
    assert state.events(page["next_cursor"])["events"][0]["seq"] == 5
    with pytest.raises(CapacityError), state.transaction() as data:
        enqueue(data, "three", 3)
    with state.transaction() as data:
        prune(data, RETENTION_SECONDS + 10)
    assert state.events(0)["retention_gap"]
    assert len(state.snapshot()["outbox"]) == 2
    state.close()


def test_retention_resolved_delivery_watches_and_receipts(tmp_path):
    state = State(tmp_path)
    with state.transaction() as data:
        for status in ("open", "resolved"):
            data["incidents"][status] = {"state": status, "updated_at": 1}
        for status in ("delivered", "dead_letter"):
            key = enqueue(data, status, 1)
            data["outbox"][key]["state"] = status
        data["watches"]["old"] = {"expires_at": 2}
        data["receipts"]["old"] = 2
        prune(data, RETENTION_SECONDS + 10)
    snapshot = state.snapshot()
    assert list(snapshot["incidents"]) == ["open"]
    assert [item["state"] for item in snapshot["outbox"].values()] == ["dead_letter"]
    assert not snapshot["watches"] and not snapshot["receipts"]
    state.close()


@pytest.mark.parametrize("cursor,limit", [(-1, 1), (False, 1), (0, 101), (0, 0)])
def test_invalid_event_bounds(tmp_path, cursor, limit):
    state = State(tmp_path)
    with pytest.raises(ValueError):
        state.events(cursor, limit)
    state.close()


def test_corrupt_state_fails_closed_releases_lock(tmp_path):
    (tmp_path / "state.json").write_text(json.dumps({"schema": 999}))
    with pytest.raises(ValueError):
        State(tmp_path)
    (tmp_path / "state.json").unlink()
    state = State(tmp_path)
    state.close()


def test_event_pages_obey_byte_budget_and_future_cursor_rejected(tmp_path):
    state = State(tmp_path)
    with state.transaction() as data:
        for _ in range(10):
            event(data, "bounded_large_evidence", {"value": "x" * 9000}, 100)
    page = state.events(limit=100)
    assert len(json.dumps(page).encode()) < 55000
    assert len(page["events"]) == 5 and page["next_cursor"] == 5
    with pytest.raises(ValueError):
        state.events(11)
    state.close()


@pytest.mark.parametrize("failure_point", ["file_fsync", "replace", "directory_fsync"])
def test_durability_fault_poisons_every_store_operation_until_restart(
    tmp_path, monkeypatch, failure_point
):
    state = State(tmp_path)
    with state.transaction() as data:
        event(data, "before", {}, 1)
    fsync = os.fsync
    calls = []

    def faulty_fsync(fd):
        calls.append(fd)
        if len(calls) == (1 if failure_point == "file_fsync" else 2):
            raise OSError("private path /credentials must not leak")
        fsync(fd)

    with monkeypatch.context() as patch:
        if failure_point == "replace":
            patch.setattr(
                os, "replace", lambda *_: (_ for _ in ()).throw(OSError("private path"))
            )
        else:
            patch.setattr(os, "fsync", faulty_fsync)
        with pytest.raises(OSError), state.transaction() as data:
            event(data, "uncertain", {}, 2)
    # Removing the fault does not make the old writer trustworthy again.
    with pytest.raises(OSError):
        state.snapshot()
    with pytest.raises(OSError):
        state.events()
    with pytest.raises(OSError), state.transaction() as data:
        pytest.fail("Poisoned transaction yielded mutable state")
    state.close()
    reopened = State(tmp_path)
    try:
        expected = 2 if failure_point == "directory_fsync" else 1
        assert reopened.snapshot()["sequence"] == expected
        with reopened.transaction() as data:
            event(data, "after_restart", {}, 3)
        assert reopened.snapshot()["sequence"] == expected + 1
    finally:
        reopened.close()
