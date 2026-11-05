"""Runtime guard: provider calls run only inside ai/ai_bulk tasks (SM3-D8).

tests/test_ai_architecture.py proves statically that model calls are rooted in
AI-lane task handlers, but static analysis cannot see dynamic dispatch. This
guard is the runtime half: execute_structured, run_probe and discover_models
refuse with AI_OUTSIDE_AI_TASK unless the actor opened an AI-lane window.

ALLOWED_OUTSIDE_AI_TASKS mirrors the architecture test's HTTP exceptions (by
action) and empties with them. CRATE_AI_LANE_GUARD=off disables the guard; only
the test session does that, because unit tests call handlers directly.
"""

from __future__ import annotations

import os

from crate.ai.contracts import AIConfigurationError

ALLOWED_OUTSIDE_AI_TASKS: dict[str, str] = {}


def enforced() -> bool:
    return os.environ.get("CRATE_AI_LANE_GUARD", "enforce").strip().lower() != "off"


def require_ai_task(operation: str, action_id: str | None = None) -> None:
    from crate.ai.requeue import inside_ai_task

    if inside_ai_task() or not enforced():
        return
    if action_id is not None and action_id in ALLOWED_OUTSIDE_AI_TASKS:
        return
    raise AIConfigurationError(
        "AI_OUTSIDE_AI_TASK", f"{operation} runs only inside an ai or ai_bulk task"
    )
