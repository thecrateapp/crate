"""A connection-concurrency refusal waits for capacity instead of failing.

reserve_invocation refuses before anything is transmitted, so waiting is not a
transport retry. ``ai`` tasks go back to their queue with a jittered delay;
``ai_bulk`` batches hold the refused item, because their results live in memory.
"""

from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from crate.ai import requeue, runtime
from crate.ai.contracts import AIConfigurationError, ProfileConfig


class Answer(BaseModel):
    ok: bool


def _context(action="shows.extract.text"):
    return {
        "mode": "configured",
        "invocation_kind": "action",
        "action_id": action,
        "connection_id": "connection",
        "model_id": "model",
        "provider": "gemini",
        "endpoint": None,
        "config": ProfileConfig().model_dump(mode="json"),
        "config_fingerprint": "f" * 64,
    }


@pytest.fixture
def busy_connection(monkeypatch):
    """Every reservation is refused by the connection's max_concurrent."""
    refusals = []

    def reserve(*args, **kwargs):
        refusals.append(kwargs["idempotency_key"])
        raise AIConfigurationError(
            "AI_CONCURRENCY_LIMIT", "Connection concurrency limit reached"
        )

    monkeypatch.setattr(runtime.configuration, "revalidate_context", lambda ctx: None)
    monkeypatch.setattr(runtime.configuration, "load_context_key", lambda ctx: "key")
    monkeypatch.setattr(runtime.usage, "reserve_invocation", reserve)
    monkeypatch.setattr(
        runtime.usage,
        "finish_invocation",
        lambda *a, **k: pytest.fail("a refused call has nothing to finish"),
    )
    monkeypatch.setattr(
        runtime.transport,
        "generate",
        lambda *a, **k: pytest.fail("a refused call must not transmit"),
    )
    return refusals


def _swallowing_handler(task_id, params, config):
    # Like the real handlers: AI errors become a failed or degraded result.
    try:
        runtime.execute_structured(
            "shows.extract.text", Answer, "prompt", context=_context(), job_id=task_id
        )
    except AIConfigurationError as error:
        return {"status": "failed", "error_code": error.code}
    except Exception:
        return {"status": "failed", "error_code": "UNEXPECTED"}
    return {"status": "succeeded"}


@pytest.fixture
def actor_harness(monkeypatch):
    from crate import actors
    from crate.worker import TASK_HANDLERS

    class Allowed:
        allowed = True

    state = SimpleNamespace(
        task={
            "id": "task-1",
            "type": "show_extract",
            "status": "pending",
            "params": {},
            "created_at": None,
        },
        updates=[],
        requeued=[],
        sends=[],
        published=[],
        failed=[],
        cancelled=False,
        acknowledged=[],
    )

    class Actor:
        def send_with_options(self, **options):
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
        lambda task_id, error: state.failed.append(error) or "failed",
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
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    monkeypatch.setattr(
        "crate.observability.sentry.capture_task_failure", lambda **k: None
    )
    monkeypatch.setattr(
        "crate.observability.sentry.capture_task_exception", lambda *a, **k: None
    )
    monkeypatch.setitem(actors._actors, "show_extract", Actor())
    monkeypatch.setitem(TASK_HANDLERS, "show_extract", _swallowing_handler)
    return state


def test_concurrency_refusal_requeues_with_delay(busy_connection, actor_harness):
    from crate import actors

    actors._execute_task("show_extract", "task-1")

    assert len(busy_connection) == 1
    assert len(actor_harness.sends) == 1
    send = actor_harness.sends[0]
    assert send["args"] == ("task-1",)
    assert send["kwargs"] == {"ai_requeues": 1}
    assert 5_000 <= send["delay"] <= 30_000
    assert [task_id for task_id, _ in actor_harness.requeued] == ["task-1"]
    assert "1/10" in actor_harness.requeued[0][1]
    # The task neither failed nor completed and nobody was told it finished.
    assert not any(update.get("status") for update in actor_harness.updates)
    assert actor_harness.failed == []
    assert actor_harness.published == []


def test_requeue_carries_the_attempt_count(busy_connection, actor_harness):
    from crate import actors

    actors._execute_task("show_extract", "task-1", ai_requeues=4)

    assert actor_harness.sends[0]["kwargs"] == {"ai_requeues": 5}
    assert "5/10" in actor_harness.requeued[0][1]


def test_requeue_gives_up_after_limit(busy_connection, actor_harness):
    from crate import actors

    actors._execute_task("show_extract", "task-1", ai_requeues=10)

    # The eleventh refusal reaches the handler as the ordinary closed error.
    assert actor_harness.sends == []
    assert actor_harness.requeued == []
    failed = [u for u in actor_harness.updates if u.get("status") == "failed"]
    assert failed and failed[0]["result"] == {
        "status": "failed",
        "error_code": "AI_CONCURRENCY_LIMIT",
    }
    assert actor_harness.published[-1][1] == "task_done"


def test_cancelled_task_is_acknowledged_instead_of_requeued(
    busy_connection, actor_harness
):
    from crate import actors

    actor_harness.cancelled = True

    actors._execute_task("show_extract", "task-1")

    assert actor_harness.sends == []
    assert actor_harness.acknowledged == ["task-1"]


def test_refusal_outside_an_ai_task_keeps_its_closed_error(busy_connection):
    # HTTP callers (still synchronous until SMQ.PR2-PR5) see today's error.
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            "shows.extract.text", Answer, "prompt", context=_context()
        )
    assert error.value.code == "AI_CONCURRENCY_LIMIT"


def test_other_admission_errors_are_never_deferred(monkeypatch, busy_connection):
    def over_budget(*args, **kwargs):
        raise AIConfigurationError("AI_DAILY_TOKEN_LIMIT", "Daily token limit reached")

    monkeypatch.setattr(runtime.usage, "reserve_invocation", over_budget)
    with requeue.concurrency_window("ai", 0):
        with pytest.raises(AIConfigurationError) as error:
            runtime.execute_structured(
                "shows.extract.text", Answer, "prompt", context=_context()
            )
    assert error.value.code == "AI_DAILY_TOKEN_LIMIT"


def test_bulk_batches_hold_the_item_until_capacity_returns(monkeypatch):
    slept = []
    attempts = []
    monkeypatch.setattr(requeue.time, "sleep", slept.append)

    def reserve():
        attempts.append(1)
        if len(attempts) < 3:
            raise AIConfigurationError("AI_CONCURRENCY_LIMIT", "busy")
        return {"id": "invocation", "claimed": True}

    with requeue.concurrency_window("ai_bulk", 0):
        assert requeue.reserve_with_capacity_wait(reserve)["claimed"] is True
    assert len(attempts) == 3
    assert len(slept) == 2 and all(5 <= seconds <= 30 for seconds in slept)


def test_bulk_batches_surface_the_refusal_after_limit(monkeypatch):
    slept = []
    monkeypatch.setattr(requeue.time, "sleep", slept.append)

    def reserve():
        raise AIConfigurationError("AI_CONCURRENCY_LIMIT", "busy")

    with requeue.concurrency_window("ai_bulk", 0):
        with pytest.raises(AIConfigurationError) as error:
            requeue.reserve_with_capacity_wait(reserve)
    assert error.value.code == "AI_CONCURRENCY_LIMIT"
    assert len(slept) == 10


def test_requeue_delay_is_jittered_within_bounds():
    delays = {requeue.requeue_delay_ms() for _ in range(200)}
    assert min(delays) >= 5_000 and max(delays) <= 30_000
    assert len(delays) > 1


def test_running_task_returns_to_pending_for_requeue(pg_db):
    from crate.db.queries.tasks import get_task
    from crate.db.repositories.task_control import request_cancellation
    from crate.db.repositories.tasks import (
        create_task,
        requeue_running_task,
        start_task,
    )

    task_id = create_task("show_extract", dispatch=False)
    assert start_task(task_id, worker_id="host:1:1") is not None

    row = requeue_running_task(task_id, progress="Waiting for AI provider capacity")

    assert row is not None
    task = get_task(task_id)
    assert task["status"] == "pending"
    assert task["worker_id"] is None
    assert task["progress"] == "Waiting for AI provider capacity"
    assert start_task(task_id, worker_id="host:1:2") is not None

    request_cancellation(task_id)
    assert requeue_running_task(task_id, progress="again") is None
    assert get_task(task_id)["status"] == "running"


def test_requeue_only_before_the_first_paid_call(monkeypatch):
    # A requeue re-runs the whole handler; after a paid call it would repeat it.
    calls = []

    def reserve():
        calls.append(1)
        if len(calls) == 2:
            raise AIConfigurationError("AI_CONCURRENCY_LIMIT", "busy")
        return {"id": "first", "claimed": True}

    with requeue.concurrency_window("ai", 0):
        assert requeue.reserve_with_capacity_wait(reserve)["id"] == "first"
        with pytest.raises(AIConfigurationError) as error:
            requeue.reserve_with_capacity_wait(reserve)
    assert error.value.code == "AI_CONCURRENCY_LIMIT"
