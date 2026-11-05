"""Bulk AI work yields to interactive work on a shared connection (review I2).

SM3-D8 promises that a taxonomy batch never starves an interactive call. A
bulk reservation therefore waits while the ai lane has pending work, and when
the connection allows more than one call it leaves one slot free.
"""

import pytest
from pydantic import BaseModel
from sqlalchemy import text

from crate.ai import requeue, runtime
from crate.ai.contracts import AIConfigurationError, ProfileConfig
from crate.ai.transport import NativeResponse


class Answer(BaseModel):
    ok: bool


def test_bulk_waits_while_interactive_work_is_pending(monkeypatch):
    demand = iter([2, 1, 0])
    slept, reserved = [], []
    monkeypatch.setattr(requeue, "_interactive_demand", lambda: next(demand))
    monkeypatch.setattr(requeue.time, "sleep", slept.append)

    with requeue.concurrency_window("ai_bulk", 0):
        result = requeue.reserve_with_capacity_wait(
            lambda: reserved.append(1) or {"claimed": True}
        )

    assert result == {"claimed": True}
    assert len(slept) == 2
    assert reserved == [1]


def test_interactive_calls_never_wait_for_demand(monkeypatch):
    monkeypatch.setattr(
        requeue, "_interactive_demand", lambda: pytest.fail("ai calls do not yield")
    )
    with requeue.concurrency_window("ai", 0):
        assert requeue.reserve_with_capacity_wait(lambda: 1) == 1


@pytest.fixture
def connection(pg_db, monkeypatch):
    from crate.ai import configuration

    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key")
    return configuration.ensure_environment_connection("gemini")


def _set_max_concurrent(connection, value):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text("UPDATE ai_provider_connections SET max_concurrent=:v WHERE id=:id"),
            {"v": value, "id": connection["id"]},
        )


def _reserve(connection, key, **options):
    from crate.db.repositories import ai_usage

    return ai_usage.reserve_invocation(
        {
            "connection_id": connection["id"],
            "model_id": "gemini-2.5-flash",
            "action_id": "genres.taxonomy.propose",
            "invocation_kind": "action",
            "mode": "configured",
        },
        idempotency_key=key,
        input_tokens=10,
        output_tokens=10,
        **options,
    )


def test_bulk_leaves_one_slot_free_with_two_concurrent_calls(connection):
    _set_max_concurrent(connection, 2)
    assert _reserve(connection, "bulk-1", leave_free=1)["claimed"]

    with pytest.raises(AIConfigurationError) as error:
        _reserve(connection, "bulk-2", leave_free=1)
    assert error.value.code == "AI_CONCURRENCY_LIMIT"
    # The free slot stays available to interactive work.
    assert _reserve(connection, "interactive")["claimed"]


def test_bulk_may_use_the_only_slot_of_a_single_call_connection(connection):
    _set_max_concurrent(connection, 1)

    assert _reserve(connection, "bulk-1", leave_free=1)["claimed"]
    with pytest.raises(AIConfigurationError):
        _reserve(connection, "interactive")


def _context():
    return {
        "mode": "configured",
        "invocation_kind": "action",
        "action_id": "genres.taxonomy.propose",
        "connection_id": "connection",
        "model_id": "model",
        "provider": "gemini",
        "endpoint": None,
        "config": ProfileConfig().model_dump(mode="json"),
        "config_fingerprint": "f" * 64,
    }


@pytest.mark.parametrize(("lane", "leave_free"), [("ai_bulk", 1), ("ai", None)])
def test_runtime_reserves_with_the_lane_headroom(monkeypatch, lane, leave_free):
    seen = []
    monkeypatch.setattr(requeue, "_interactive_demand", lambda: 0)
    monkeypatch.setattr(runtime.configuration, "revalidate_context", lambda ctx: None)
    monkeypatch.setattr(runtime.configuration, "load_context_key", lambda ctx: "key")
    monkeypatch.setattr(
        runtime.usage,
        "reserve_invocation",
        lambda *a, **k: (
            seen.append(k.get("leave_free")) or {"id": "i", "claimed": True}
        ),
    )
    monkeypatch.setattr(runtime.usage, "finish_invocation", lambda *a, **k: None)
    monkeypatch.setattr(
        runtime.transport,
        "generate",
        lambda *a, **k: NativeResponse('{"ok":true}', None, "model", 1),
    )

    with requeue.concurrency_window(lane, 0):
        runtime.execute_structured(
            "genres.taxonomy.propose", Answer, "prompt", context=_context()
        )

    assert seen == [leave_free]
