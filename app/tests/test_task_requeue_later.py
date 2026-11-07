"""A task that runs more than once, after a retry or a requeue, is one task.

Its queue wait is the time from creation to its first start, and a handler can
send its own task back to pending to run again later instead of sleeping in a
worker process.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

TASK_TYPE = "backfill_smart_mix_profiles"


@pytest.fixture
def harness(monkeypatch):
    from crate import actors
    from crate.worker import TASK_HANDLERS

    class Allowed:
        allowed = True

    state = SimpleNamespace(
        task={
            "id": "task-1",
            "type": TASK_TYPE,
            "status": "pending",
            "params": {},
            "created_at": datetime.now(UTC) - timedelta(seconds=90),
            "started_at": None,
        },
        result={"claimed": 0},
        updates=[],
        requeued=[],
        sends=[],
        published=[],
        metrics=[],
        cancelled=False,
        acknowledged=[],
        send_error=None,
    )

    class Actor:
        def send_with_options(self, **options):
            if state.send_error is not None:
                raise state.send_error
            state.sends.append(options)

    def requeue_running_task(task_id, *, progress):
        if state.cancelled:
            return None
        state.requeued.append((task_id, progress))
        return {"id": task_id, "status": "pending"}

    monkeypatch.setattr("crate.db.queries.tasks.get_task", lambda task_id: state.task)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.start_task",
        lambda task_id, worker_id=None: {"id": task_id},
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.update_task",
        lambda task_id, **kwargs: state.updates.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.requeue_running_task", requeue_running_task
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.fail_or_retry_task",
        lambda task_id, error: pytest.fail(f"unexpected failure: {error}"),
    )
    monkeypatch.setattr(
        "crate.db.repositories.task_control.acknowledge_cancellation",
        lambda task_id, result=None: (
            state.acknowledged.append(task_id) or {"status": "cancelled"}
        ),
    )
    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task",
        lambda task_type, params=None: Allowed(),
    )
    monkeypatch.setattr("crate.resource_governor.record_decision", lambda *a, **k: None)
    monkeypatch.setattr("crate.config.load_config", lambda: {})
    monkeypatch.setattr("crate.worker._is_cancelled", lambda task_id: state.cancelled)
    monkeypatch.setattr(
        "crate.db.events._publish_to_redis",
        lambda *args, **kwargs: state.published.append(args),
    )
    monkeypatch.setattr(
        "crate.metrics.record",
        lambda name, value, tags=None: state.metrics.append((name, value, tags)),
    )
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    monkeypatch.setitem(actors._actors, TASK_TYPE, Actor())
    monkeypatch.setitem(
        TASK_HANDLERS, TASK_TYPE, lambda task_id, params, config: state.result
    )
    return state


def _queue_waits(state) -> list[float]:
    return [
        value for name, value, _tags in state.metrics if name == "worker.queue.wait"
    ]


def test_queue_wait_is_recorded_only_up_to_the_first_start(harness) -> None:
    from crate import actors

    actors._execute_task(TASK_TYPE, "task-1")
    # Started once already: a retry, or a task that came back later.
    harness.task["started_at"] = datetime.now(UTC) - timedelta(seconds=60)
    actors._execute_task(TASK_TYPE, "task-1")

    [wait] = _queue_waits(harness)
    assert 89 <= wait < 120


def test_a_handler_can_send_its_task_back_to_run_later(harness) -> None:
    from crate import actors
    from crate.worker_handlers import run_again_later

    harness.result = run_again_later(3, progress="Waiting for a free analysis slot")

    actors._execute_task(TASK_TYPE, "task-1")

    assert harness.requeued == [("task-1", "Waiting for a free analysis slot")]
    assert harness.sends == [{"args": ("task-1",), "delay": 3000}]
    # Neither completed nor failed, and nobody was told it finished.
    assert not any(update.get("status") for update in harness.updates)
    assert harness.published == []


def test_a_task_cancelled_while_it_ran_is_not_sent_back(harness) -> None:
    from crate import actors
    from crate.worker_handlers import run_again_later

    harness.result = run_again_later(3, progress="Waiting for a free analysis slot")
    harness.cancelled = True

    actors._execute_task(TASK_TYPE, "task-1")

    assert harness.sends == []
    assert harness.requeued == []
    assert harness.acknowledged == ["task-1"]


def test_a_cancellation_that_lands_during_the_requeue_wins(
    harness, monkeypatch
) -> None:
    from crate import actors
    from crate.worker_handlers import run_again_later

    # Not cancelled when the handler returns; cancelled by the time the row is
    # returned to pending, so the requeue refuses and acknowledges it instead.
    answers = iter([False, True])
    monkeypatch.setattr(
        "crate.worker._is_cancelled", lambda task_id: next(answers, True)
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.requeue_running_task",
        lambda task_id, *, progress: None,
    )
    harness.result = run_again_later(3, progress="Waiting for a free analysis slot")

    actors._execute_task(TASK_TYPE, "task-1")

    assert harness.sends == []
    assert harness.acknowledged == ["task-1"]
    assert [event[1] for event in harness.published] == ["task_done"]
    assert harness.published[0][2]["status"] == "cancelled"


def test_a_requeued_child_does_not_fan_in_its_parent(harness, monkeypatch) -> None:
    from crate import actors
    from crate.worker_handlers import run_again_later

    fanned_in: list[str] = []
    monkeypatch.setattr(
        actors,
        "_try_fan_in_parent",
        lambda task, task_type, task_id: fanned_in.append(task_id),
    )
    harness.task["parent_task_id"] = "parent-1"
    harness.result = run_again_later(3, progress="Waiting for a free analysis slot")

    actors._execute_task(TASK_TYPE, "task-1")

    assert harness.requeued == [("task-1", "Waiting for a free analysis slot")]
    assert fanned_in == []


def test_a_task_whose_message_cannot_be_sent_stays_pending(harness) -> None:
    from crate import actors
    from crate.worker_handlers import run_again_later

    # The row is already pending when the broker refuses the delayed message;
    # failing the task now would leave the backfill without a coordinator. The
    # stale-pending redispatch sends it again within minutes.
    harness.result = run_again_later(3, progress="Waiting for a free analysis slot")
    harness.send_error = ConnectionError("Redis is restarting")

    actors._execute_task(TASK_TYPE, "task-1")

    assert harness.requeued == [("task-1", "Waiting for a free analysis slot")]
    assert not any(update.get("status") for update in harness.updates)
    assert harness.published == []


def test_requeue_returns_a_running_task_to_pending_for_any_worker(pg_db) -> None:
    from crate.db.queries.tasks import get_task
    from crate.db.repositories.task_control import request_cancellation
    from crate.db.repositories.tasks import (
        create_task,
        requeue_running_task,
        start_task,
    )

    task_id = create_task(TASK_TYPE, dispatch=False)
    first = start_task(task_id, worker_id="host:1:1")
    assert first is not None
    assert first["heartbeat_at"] is not None

    assert requeue_running_task(task_id, progress="Waiting for a free slot")
    task = get_task(task_id)
    assert (task["status"], task["worker_id"], task["heartbeat_at"]) == (
        "pending",
        None,
        None,
    )
    assert task["progress"] == "Waiting for a free slot"
    # The first start stays, so its queue wait is recorded only once.
    assert task["started_at"] == first["started_at"]
    # Only a running task goes back.
    assert requeue_running_task(task_id, progress="again") is None

    assert start_task(task_id, worker_id="host:1:2") is not None
    request_cancellation(task_id)
    assert requeue_running_task(task_id, progress="again") is None
    assert get_task(task_id)["status"] == "running"


def test_a_requeued_child_keeps_its_parent_waiting(pg_db) -> None:
    from crate.db.queries.tasks import get_task
    from crate.db.repositories.tasks import (
        check_siblings_complete,
        create_task,
        requeue_running_task,
        start_task,
        update_task,
    )

    parent = create_task("compute_popularity", dispatch=False)
    update_task(parent, status="delegated")
    child = create_task("popularity_chunk", parent_task_id=parent, dispatch=False)
    assert start_task(child, worker_id="host:1:1") is not None

    assert requeue_running_task(child, progress="Waiting to run again")

    task = get_task(child)
    assert (task["status"], task["parent_task_id"]) == ("pending", parent)
    assert check_siblings_complete(parent)["all_done"] is False
    assert get_task(parent)["status"] == "delegated"
