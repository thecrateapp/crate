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
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import TypeVar

from crate.ai.contracts import AIConfigurationError
from crate.ai.queues import AI_BULK_QUEUE, AI_QUEUE

AI_CONCURRENCY_CODE = "AI_CONCURRENCY_LIMIT"
AI_CONCURRENCY_REQUEUE_LIMIT = 10
AI_REQUEUE_DELAY_MS = (5_000, 30_000)

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


@dataclass(frozen=True)
class _Window:
    queue: str
    requeues: int


_window: ContextVar[_Window | None] = ContextVar("crate_ai_requeue", default=None)


@contextmanager
def concurrency_window(queue: str, requeues: int = 0) -> Iterator[None]:
    """Mark the current thread as running an AI-lane task (set by the actor)."""
    token = _window.set(_Window(queue, max(0, int(requeues))))
    try:
        yield
    finally:
        _window.reset(token)


def requeue_delay_ms(rng: random.Random | None = None) -> int:
    return (rng or random).randint(*AI_REQUEUE_DELAY_MS)


def reserve_with_capacity_wait(reserve: Callable[[], T]) -> T:
    """Call ``reserve`` and apply the lane's capacity policy to a concurrency refusal."""
    window = _window.get()
    waited = 0
    while True:
        try:
            return reserve()
        except AIConfigurationError as error:
            if error.code != AI_CONCURRENCY_CODE or window is None:
                raise
            if window.queue == AI_QUEUE:
                if window.requeues >= AI_CONCURRENCY_REQUEUE_LIMIT:
                    raise
                raise AIConcurrencyDeferred(window.requeues + 1) from None
            if window.queue != AI_BULK_QUEUE or waited >= AI_CONCURRENCY_REQUEUE_LIMIT:
                raise
            waited += 1
            time.sleep(requeue_delay_ms() / 1000)


__all__ = [
    "AI_CONCURRENCY_CODE",
    "AI_CONCURRENCY_REQUEUE_LIMIT",
    "AI_REQUEUE_DELAY_MS",
    "AIConcurrencyDeferred",
    "concurrency_window",
    "requeue_delay_ms",
    "reserve_with_capacity_wait",
]
