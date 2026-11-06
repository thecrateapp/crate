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
