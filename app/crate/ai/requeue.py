"""Wait for provider capacity instead of failing an AI-lane task (SM3-D8).

``reserve_invocation`` refuses with ``AI_CONCURRENCY_LIMIT`` when a connection
already runs ``max_concurrent`` calls. Nothing has been transmitted at that
point, so trying again later is not a transport retry and cannot pay twice.

Inside a task on the ``ai`` lane the refusal raises :class:`AIConcurrencyDeferred`;
the actor returns the task to ``pending`` and sends it again after a jittered
5–30 s delay. Inside an ``ai_bulk`` batch the current item waits that delay and
retries its reservation, because a batch keeps its per-item results in memory
and requeueing it would discard work already paid for. After
``AI_CONCURRENCY_REQUEUE_LIMIT`` attempts, or outside an AI-lane task (HTTP
callers), the refusal surfaces as the usual :class:`AIConfigurationError`.

The same window carries the task deadline: no provider call may outlive its
task, so each call's transport deadline is capped at the task's
``time_limit_seconds`` minus ``AI_CALL_DEADLINE_MARGIN_SECONDS``, counted from
the start of the task, and no call starts once that budget is spent.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import TypeVar

from crate.ai.contracts import AIConfigurationError
from crate.ai.queues import AI_BULK_QUEUE, AI_QUEUE

AI_CONCURRENCY_CODE = "AI_CONCURRENCY_LIMIT"
AI_CONCURRENCY_REQUEUE_LIMIT = 10
AI_REQUEUE_DELAY_MS = (5_000, 30_000)
# Time kept between the end of any provider call and the task's time limit, for
# validation, persistence and the actor's own bookkeeping.
AI_CALL_DEADLINE_MARGIN_SECONDS = 30
_MIN_CALL_SECONDS = 1.0

T = TypeVar("T")


class AIConcurrencyDeferred(BaseException):
    """Unwinds an ``ai`` task to its actor so the actor can requeue it.

    It derives from BaseException on purpose: domain handlers catch Exception
    and AIConfigurationError to record failed or degraded results, and this
    signal has to reach the actor without being turned into one.
    """

    def __init__(self, attempt: int) -> None:
        self.attempt = attempt
        super().__init__(f"AI provider capacity requeue {attempt}")


CAPACITY_WAIT_PROGRESS = "Waiting for AI provider capacity"
# A bulk reservation leaves this many slots of a multi-call connection free for
# interactive work (review I2).
_BULK_HEADROOM = 1


@dataclass(frozen=True)
class _Window:
    queue: str
    requeues: int
    deadline: float | None = None
    task_id: str | None = None
    # Mutable per-task state: a bulk batch that exhausted its capacity waits.
    state: dict = field(default_factory=dict)


_window: ContextVar[_Window | None] = ContextVar("crate_ai_requeue", default=None)


@contextmanager
def concurrency_window(
    queue: str,
    requeues: int = 0,
    *,
    deadline: float | None = None,
    task_id: str | None = None,
) -> Iterator[None]:
    """Mark the current thread as running an AI-lane task (set by the actor).

    ``deadline`` is a time.monotonic() value after which no provider call may
    still be running.
    """
    token = _window.set(
        _Window(queue, max(0, int(requeues)), deadline, task_id=task_id)
    )
    try:
        yield
    finally:
        _window.reset(token)


def call_budget_seconds() -> float | None:
    """Seconds a provider call may still take inside this task; None outside one."""
    window = _window.get()
    if window is None or window.deadline is None:
        return None
    return window.deadline - time.monotonic()


def require_call_budget() -> float | None:
    """The remaining call budget, or a closed error when too little is left."""
    budget = call_budget_seconds()
    if budget is not None and budget < _MIN_CALL_SECONDS:
        raise AIConfigurationError(
            "AI_TASK_DEADLINE", "The task has no time left for a provider call"
        )
    return budget


def requeue_delay_ms(rng: random.Random | None = None) -> int:
    return (rng or random).randint(*AI_REQUEUE_DELAY_MS)


def reservation_options() -> dict:
    """Extra reserve_invocation options for the current lane (bulk headroom)."""
    window = _window.get()
    if window is not None and window.queue == AI_BULK_QUEUE:
        return {"leave_free": _BULK_HEADROOM}
    return {}


def _interactive_demand() -> int:
    """Interactive AI tasks waiting to run, including capacity requeues."""
    try:
        from crate.db.queries.tasks import count_pending_tasks_in_pool

        return count_pending_tasks_in_pool(AI_QUEUE)
    except Exception:
        return 0


def _measure(name: str, queue: str) -> None:
    try:
        import crate.metrics

        crate.metrics.record(name, 1.0, {"queue": queue})
    except Exception:
        pass


def _bulk_wait(window: _Window, reason: str) -> None:
    """Sleep one jittered delay inside the task budget, visibly."""
    delay = requeue_delay_ms() / 1000
    budget = call_budget_seconds()
    if budget is not None and budget - delay < _MIN_CALL_SECONDS:
        window.state["exhausted"] = True
        raise AIConfigurationError(
            "AI_TASK_DEADLINE", "The task has no time left for a provider call"
        )
    _measure("ai.capacity.wait", window.queue)
    if window.task_id:
        try:
            from crate.db.repositories.tasks import update_task

            update_task(window.task_id, progress=f"{CAPACITY_WAIT_PROGRESS}; {reason}")
        except Exception:
            pass
    time.sleep(delay)


def reserve_with_capacity_wait(reserve: Callable[[], T]) -> T:
    """Call ``reserve`` and apply the lane's capacity policy.

    ai: a concurrency refusal requeues the task (AIConcurrencyDeferred).
    ai_bulk: yield first while interactive tasks are pending, then hold the
    item on refusals; after AI_CONCURRENCY_REQUEUE_LIMIT waits the batch stops
    waiting for every later item, so it ends with the results already paid for.
    """
    window = _window.get()
    if window is None or window.queue != AI_BULK_QUEUE:
        try:
            return reserve()
        except AIConfigurationError as error:
            if (
                error.code != AI_CONCURRENCY_CODE
                or window is None
                or window.queue != AI_QUEUE
                or window.requeues >= AI_CONCURRENCY_REQUEUE_LIMIT
            ):
                raise
            _measure("ai.capacity.requeue", window.queue)
            raise AIConcurrencyDeferred(window.requeues + 1) from None

    exhausted = bool(window.state.get("exhausted"))
    waited = 0
    while True:
        if (
            not exhausted
            and waited < AI_CONCURRENCY_REQUEUE_LIMIT
            and _interactive_demand() > 0
        ):
            waited += 1
            _bulk_wait(window, "yielding to interactive work")
            continue
        try:
            return reserve()
        except AIConfigurationError as error:
            if error.code != AI_CONCURRENCY_CODE:
                raise
            if exhausted or waited >= AI_CONCURRENCY_REQUEUE_LIMIT:
                window.state["exhausted"] = True
                raise
            waited += 1
            _bulk_wait(window, f"wait {waited}/{AI_CONCURRENCY_REQUEUE_LIMIT}")


__all__ = [
    "AI_CALL_DEADLINE_MARGIN_SECONDS",
    "AI_CONCURRENCY_CODE",
    "AI_CONCURRENCY_REQUEUE_LIMIT",
    "AI_REQUEUE_DELAY_MS",
    "AIConcurrencyDeferred",
    "CAPACITY_WAIT_PROGRESS",
    "call_budget_seconds",
    "concurrency_window",
    "require_call_budget",
    "requeue_delay_ms",
    "reservation_options",
    "reserve_with_capacity_wait",
]
