from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest


def test_sqlalchemy_pool_runtime_is_low_cardinality(monkeypatch):
    from crate.db import engine

    pool = SimpleNamespace(
        size=lambda: 8,
        checkedin=lambda: 3,
        checkedout=lambda: 5,
        overflow=lambda: 1,
    )
    monkeypatch.setattr(engine, "_engine", SimpleNamespace(pool=pool))

    assert engine.get_pool_runtime() == {
        "configured": True,
        "size": 8,
        "checked_in": 3,
        "checked_out": 5,
        "overflow": 1,
        "saturation_ratio": 0.625,
    }


def test_sqlalchemy_pool_runtime_ignores_uninstrumentable_test_engine(monkeypatch):
    from crate.db import engine

    monkeypatch.setattr(engine, "_engine", SimpleNamespace())

    assert engine.get_pool_runtime() == {
        "configured": False,
        "size": 0,
        "checked_in": 0,
        "checked_out": 0,
        "overflow": 0,
        "saturation_ratio": 0.0,
    }


def test_event_loop_lag_monitor_records_delay(monkeypatch):
    from crate import runtime_saturation

    runtime_saturation.reset_runtime_saturation()
    calls = 0
    original_sleep = asyncio.sleep

    async def delayed_sleep(_delay):
        nonlocal calls
        calls += 1
        if calls == 1:
            await original_sleep(0)
            return
        raise asyncio.CancelledError

    monkeypatch.setattr(runtime_saturation.asyncio, "sleep", delayed_sleep)

    async def run_monitor():
        with pytest.raises(asyncio.CancelledError):
            await runtime_saturation.monitor_event_loop_lag(interval_seconds=0.001)

    asyncio.run(run_monitor())

    snapshot = runtime_saturation.get_runtime_saturation()
    assert snapshot["event_loop"]["samples"] == 1
    assert snapshot["event_loop"]["last_lag_ms"] >= 0


def test_eventing_payload_includes_outbox_and_runtime_saturation(monkeypatch):
    from crate.db import ops_snapshot_eventing

    monkeypatch.setattr(ops_snapshot_eventing, "get_redis", lambda: None)
    monkeypatch.setattr(
        ops_snapshot_eventing,
        "get_domain_event_runtime",
        lambda limit=8: {"lag": 4, "pending": 2},
    )
    monkeypatch.setattr(
        ops_snapshot_eventing,
        "get_outbox_runtime",
        lambda: {"pending": 3, "dead_letter": 1, "oldest_pending_seconds": 9},
    )
    monkeypatch.setattr(
        ops_snapshot_eventing,
        "get_runtime_saturation",
        lambda: {"database": {"saturation_ratio": 0.5}},
    )

    payload = ops_snapshot_eventing.build_eventing_payload()

    assert payload["domain_events"]["lag"] == 4
    assert payload["outbox"]["dead_letter"] == 1
    assert payload["runtime_saturation"]["database"]["saturation_ratio"] == 0.5
