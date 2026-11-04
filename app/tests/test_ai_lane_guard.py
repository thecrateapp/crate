"""Runtime guard: provider calls run only inside ai/ai_bulk tasks (review M1).

The static architecture test cannot see dynamic dispatch (functools.partial, a
dict registry, getattr). execute_structured, run_probe and discover_models
therefore refuse to run outside an AI-lane task, except for the actions that
the architecture test still lists as HTTP exceptions. The test session runs
with the guard off (conftest); these tests enforce it.
"""

import pytest
from pydantic import BaseModel

from crate.ai import guard, requeue, runtime
from crate.ai.contracts import AIConfigurationError, ProfileConfig
from crate.ai.transport import NativeResponse


class Answer(BaseModel):
    ok: bool


@pytest.fixture(autouse=True)
def enforced(monkeypatch):
    monkeypatch.setenv("CRATE_AI_LANE_GUARD", "enforce")


def _context(action="genres.eq.propose"):
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
def admitted(monkeypatch):
    reservations = []
    monkeypatch.setattr(runtime.configuration, "revalidate_context", lambda ctx: None)
    monkeypatch.setattr(runtime.configuration, "load_context_key", lambda ctx: "key")
    monkeypatch.setattr(
        runtime.usage,
        "reserve_invocation",
        lambda *a, **k: reservations.append(k) or {"id": "i", "claimed": True},
    )
    monkeypatch.setattr(runtime.usage, "finish_invocation", lambda *a, **k: None)
    monkeypatch.setattr(
        runtime.transport,
        "generate",
        lambda *a, **k: NativeResponse('{"ok":true}', None, "model", 1),
    )
    return reservations


def test_model_call_outside_an_ai_task_is_refused(admitted):
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            "genres.eq.propose", Answer, "prompt", context=_context()
        )
    assert error.value.code == "AI_OUTSIDE_AI_TASK"
    assert admitted == []


@pytest.mark.parametrize("lane", ["ai", "ai_bulk"])
def test_model_call_inside_an_ai_task_runs(admitted, lane, monkeypatch):
    monkeypatch.setattr(requeue, "_interactive_demand", lambda: 0)
    with requeue.concurrency_window(lane, 0):
        assert runtime.execute_structured(
            "genres.eq.propose", Answer, "prompt", context=_context()
        ).ok
    assert len(admitted) == 1


def test_probe_and_catalog_discovery_refuse_outside_an_ai_task(monkeypatch):
    from crate.ai import discovery, operations

    monkeypatch.setattr(
        operations.service,
        "revalidate_context",
        lambda ctx: pytest.fail("the guard runs before anything else"),
    )
    with pytest.raises(AIConfigurationError) as probe:
        operations.run_probe(
            {**_context(), "invocation_kind": "probe", "action_id": None},
            actor_id=1,
            job_id="job",
            idempotency_key="key",
        )
    with pytest.raises(AIConfigurationError) as catalog:
        discovery.discover_models("gemini", api_key="key", endpoint=None)

    assert probe.value.code == catalog.value.code == "AI_OUTSIDE_AI_TASK"


def test_the_allowlist_mirrors_the_architecture_exceptions():
    from tests.test_ai_architecture import HTTP_MODEL_CALL_EXCEPTIONS

    # Each remaining HTTP exception is allowed by action, under the same PR.
    assert set(guard.ALLOWED_OUTSIDE_AI_TASKS.values()) == set(
        HTTP_MODEL_CALL_EXCEPTIONS.values()
    )


def test_guard_can_be_switched_off_only_explicitly(admitted, monkeypatch):
    monkeypatch.setenv("CRATE_AI_LANE_GUARD", "off")
    assert runtime.execute_structured(
        "genres.eq.propose", Answer, "prompt", context=_context()
    ).ok
    monkeypatch.delenv("CRATE_AI_LANE_GUARD")
    assert guard.enforced() is True
