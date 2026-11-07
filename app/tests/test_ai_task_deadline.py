"""No provider call outlives the task that makes it.

Inside an AI-lane task every call's transport deadline is capped at the task's
time_limit_seconds minus AI_CALL_DEADLINE_MARGIN_SECONDS, counted from the
start of the task. The transport kills its child at that deadline, which also
bounds the legacy Ollama and LiteLLM paths.
"""

import time

import pytest
from pydantic import BaseModel

from crate.ai import requeue, runtime, transport
from crate.ai.contracts import AIConfigurationError, ProfileConfig
from crate.ai.transport import NativeResponse


class Answer(BaseModel):
    ok: bool


def _context(timeout_seconds=45):
    return {
        "mode": "configured",
        "invocation_kind": "action",
        "action_id": "genres.eq.propose",
        "connection_id": "connection",
        "model_id": "model",
        "provider": "gemini",
        "endpoint": None,
        "config": ProfileConfig(timeout_seconds=timeout_seconds).model_dump(
            mode="json"
        ),
        "config_fingerprint": "f" * 64,
    }


def _legacy_context(deadline_seconds=300.0):
    return {
        "mode": "legacy",
        "invocation_kind": "action",
        "action_id": "i18n.listen.draft",
        "provider": "ollama",
        "connection_id": "env:ollama",
        "model_id": "llama3.1:8b",
        "legacy_model": "ollama/llama3.1:8b",
        "endpoint": "http://ollama:11434",
        "legacy_options": {
            "timeout_seconds": None,
            "max_tokens": None,
            "image_detail": "default",
        },
        "legacy_deadline_seconds": deadline_seconds,
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
        lambda *a, **k: reservations.append(k) or {"id": "inv", "claimed": True},
    )
    monkeypatch.setattr(runtime.usage, "finish_invocation", lambda *a, **k: None)
    return reservations


def test_call_inside_a_task_is_capped_by_the_task_deadline(monkeypatch, admitted):
    captured = []

    def generate(ctx, **kwargs):
        captured.append(kwargs.get("max_seconds"))
        return NativeResponse('{"ok":true}', None, "model", 1)

    monkeypatch.setattr(runtime.transport, "generate", generate)
    with requeue.concurrency_window("ai", 0, deadline=time.monotonic() + 20):
        assert runtime.execute_structured(
            "genres.eq.propose", Answer, "prompt", context=_context()
        ).ok

    assert len(captured) == 1
    assert 0 < captured[0] <= 20


def test_call_outside_a_task_keeps_its_profile_timeout(monkeypatch, admitted):
    captured = []

    def generate(ctx, **kwargs):
        captured.append(kwargs)
        return NativeResponse('{"ok":true}', None, "model", 1)

    monkeypatch.setattr(runtime.transport, "generate", generate)
    runtime.execute_structured(
        "genres.eq.propose", Answer, "prompt", context=_context()
    )

    assert "max_seconds" not in captured[0]


def test_no_call_starts_without_task_time_left(monkeypatch, admitted):
    monkeypatch.setattr(
        runtime.transport,
        "generate",
        lambda *a, **k: pytest.fail("no time left: nothing may be transmitted"),
    )
    with requeue.concurrency_window("ai", 0, deadline=time.monotonic() - 1):
        with pytest.raises(AIConfigurationError) as error:
            runtime.execute_structured(
                "genres.eq.propose", Answer, "prompt", context=_context()
            )

    assert error.value.code == "AI_TASK_DEADLINE"
    assert admitted == []


def test_transport_deadline_takes_the_smaller_bound(monkeypatch):
    deadlines = []

    def request_json(**kwargs):
        deadlines.append(kwargs["deadline"] - time.monotonic())
        raise RuntimeError("stop after recording the deadline")

    monkeypatch.setattr(transport, "_request_json", request_json)
    for timeout_seconds, max_seconds in ((45, 12), (10, 60)):
        with pytest.raises(AIConfigurationError):
            transport.generate(
                _context(timeout_seconds=timeout_seconds),
                api_key="key",
                prompt="prompt",
                response_schema={},
                max_seconds=max_seconds,
            )

    assert 11 < deadlines[0] <= 12
    assert 9 < deadlines[1] <= 10


def test_legacy_transport_deadline_is_capped(monkeypatch):
    deadlines = []

    def request_json(**kwargs):
        deadlines.append(kwargs["deadline"] - time.monotonic())
        return {"text": '{"ok":true}'}

    monkeypatch.setattr(transport, "_request_json", request_json)
    transport.generate_legacy(
        _legacy_context(300.0),
        api_key=None,
        prompt="prompt",
        response_schema={},
        max_seconds=25,
    )

    assert 24 < deadlines[0] <= 25


def test_legacy_provider_client_gets_the_capped_timeout(monkeypatch):
    from crate.llm import provider

    seen = []

    def ask_structured(response_model, prompt, **kwargs):
        seen.append(kwargs["timeout_seconds"])
        return response_model.model_validate({"ok": True})

    monkeypatch.setattr(provider, "ask_structured", ask_structured)

    def packet(task_bounded):
        return {
            "api_key": None,
            "timeout_seconds": 25.0,
            "body": {
                "context": _legacy_context(300.0),
                "prompt": "prompt",
                "schema": {"type": "object"},
                "system": "",
                "image": None,
                "media_type": None,
                "task_bounded": task_bounded,
            },
        }

    transport._legacy_response(packet(True))
    transport._legacy_response(packet(False))

    # Ollama's legacy default is 300s; inside a task the budget binds, and
    # outside one the omitted native option stays omitted.
    assert seen == [25.0, None]


def test_actor_derives_the_deadline_from_the_task_time_limit(monkeypatch):
    from crate import actors
    from crate.ai.requeue import AI_CALL_DEADLINE_MARGIN_SECONDS
    from crate.worker import TASK_HANDLERS

    class Allowed:
        allowed = True

    budgets = []
    monkeypatch.setattr(
        "crate.db.queries.tasks.get_task",
        lambda task_id: {
            "id": task_id,
            "type": "show_extract",
            "status": "pending",
            "params": {},
            "created_at": None,
        },
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.start_task",
        lambda task_id, worker_id=None: {"id": task_id},
    )
    monkeypatch.setattr("crate.db.repositories.tasks.update_task", lambda *a, **k: None)
    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task", lambda *a, **k: Allowed()
    )
    monkeypatch.setattr("crate.config.load_config", lambda: {})
    monkeypatch.setattr("crate.worker._is_cancelled", lambda task_id: False)
    monkeypatch.setattr("crate.db.events._publish_to_redis", lambda *a, **k: None)
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    monkeypatch.setitem(
        TASK_HANDLERS,
        "show_extract",
        lambda task_id, params, config: (
            budgets.append(requeue.call_budget_seconds()) or {}
        ),
    )

    actors._execute_task("show_extract", "task-1")

    limit = actors.TASK_POOL_CONFIG["show_extract"].time_limit_seconds
    assert AI_CALL_DEADLINE_MARGIN_SECONDS == 30
    assert limit - AI_CALL_DEADLINE_MARGIN_SECONDS - 2 < budgets[0]
    assert budgets[0] <= limit - AI_CALL_DEADLINE_MARGIN_SECONDS


def test_every_ai_task_leaves_room_for_its_action_maximum():
    from crate.actors import TASK_POOL_CONFIG
    from crate.ai.actions import ACTIONS
    from crate.ai.requeue import AI_CALL_DEADLINE_MARGIN_SECONDS

    longest_action = max(action.maxima.timeout_seconds for action in ACTIONS.values())
    short = {
        task_type: config.time_limit_seconds
        for task_type, config in TASK_POOL_CONFIG.items()
        if config.queue in {"ai", "ai_bulk"}
        and config.time_limit_seconds - AI_CALL_DEADLINE_MARGIN_SECONDS < longest_action
    }
    assert short == {}


def test_probe_is_capped_by_the_task_deadline(monkeypatch):
    from crate.ai import operations

    captured = []
    monkeypatch.setattr(operations.service, "revalidate_context", lambda ctx: None)
    monkeypatch.setattr(operations.service, "load_context_key", lambda ctx: "key")
    monkeypatch.setattr(
        operations.usage,
        "reserve_invocation",
        lambda *a, **k: {"id": "inv", "claimed": True},
    )
    monkeypatch.setattr(operations.usage, "finish_invocation", lambda *a, **k: None)

    def execute_probe(context, **kwargs):
        captured.append(kwargs.get("max_seconds"))
        return {"compatible": True, "usage": None, "reported_model": None}

    monkeypatch.setattr(runtime, "execute_probe", execute_probe)
    context = {**_context(), "invocation_kind": "probe", "action_id": None}
    with requeue.concurrency_window("ai", 0, deadline=time.monotonic() + 40):
        result = operations.run_probe(
            context, actor_id=1, job_id="job", idempotency_key="key"
        )

    assert result["status"] == "succeeded"
    assert 0 < captured[0] <= 40


def test_task_budget_is_unknown_outside_a_task():
    assert requeue.call_budget_seconds() is None
