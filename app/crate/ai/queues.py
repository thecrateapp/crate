"""Dramatiq lanes reserved for work that calls an AI provider (SM3-D8).

``ai`` serves interactive work (one proposal, one draft, one extraction) with a
time limit of at most five minutes. ``ai_bulk`` serves long batches such as the
genre taxonomy runs, so they never hold the interactive threads. crate-worker
consumes both, each in its own Dramatiq pool sized by the variables below.
Provider connections keep their own ``max_concurrent`` limit on top.
"""

from __future__ import annotations

import os

AI_QUEUE = "ai"
AI_BULK_QUEUE = "ai_bulk"
AI_QUEUES = (AI_QUEUE, AI_BULK_QUEUE)

AI_INTERACTIVE_TIME_LIMIT_SECONDS = 300

AI_WORKER_THREADS_ENV = {
    AI_QUEUE: ("CRATE_AI_WORKER_THREADS", 2),
    AI_BULK_QUEUE: ("CRATE_AI_BULK_WORKER_THREADS", 1),
}
_MAX_LANE_THREADS = 16


def lane_threads(queue: str) -> int:
    """Threads for one AI lane, bounded to 1..16; invalid values use the default."""
    name, default = AI_WORKER_THREADS_ENV[queue]
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(1, min(_MAX_LANE_THREADS, value))
