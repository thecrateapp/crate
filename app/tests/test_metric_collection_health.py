from __future__ import annotations

from datetime import datetime
from queue import Queue
import time
from types import SimpleNamespace

import pytest

from tests.test_metric_minute_integrity import (
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


class _StopLoop(BaseException):
    pass


def _drain_async_loop(monkeypatch, metrics, pending):
    original_get = pending.get

    def get_until_empty(*args, **kwargs):
        if pending.empty():
            raise _StopLoop
        return original_get(*args, **kwargs)

    monkeypatch.setattr(pending, "get", get_until_empty)
    with pytest.raises(_StopLoop):
        metrics._async_record_loop()


@pytest.fixture
def buffered_collector(monkeypatch):
    from crate import metrics

    pending = Queue(maxsize=2)
    monkeypatch.setattr(metrics, "_async_metric_queue", pending)
    monkeypatch.setattr(metrics, "_ensure_async_worker", lambda: None)
    return metrics, pending


def test_collection_health_is_process_local_and_performs_no_redis_io(monkeypatch):
    from crate import metrics

    redis_calls = []

    def no_redis():
        redis_calls.append(True)
        raise AssertionError("Collector health must not depend on Redis")

    monkeypatch.setattr("crate.db.cache_runtime.get_redis", no_redis)

    health = metrics.get_collection_health()

    assert redis_calls == []
    assert health["scope"] == "process"
    assert health["coverage"] == "local_only"
    assert health["queue_depth"] >= 0
    assert health["queue_capacity"] > 0
    assert datetime.fromisoformat(health["started_at"]).tzinfo is not None
    assert "last_write_at" in health
    assert "last_error_at" in health
    assert "availability" in health
    assert all(
        isinstance(value, int) and value >= 0 for value in health["counters"].values()
    )


def test_missing_redis_is_counted_without_recursion_or_health_io(monkeypatch):
    from crate import metrics

    before = metrics._collection_counters["redis_unavailable"]
    redis_calls = []
    recursive_calls = []

    def missing_redis():
        redis_calls.append(True)
        return None

    def no_recursive_record(*_args, **_kwargs):
        recursive_calls.append(True)
        raise AssertionError(
            "Collector diagnostics must not record metrics recursively"
        )

    monkeypatch.setattr("crate.db.cache_runtime.get_redis", missing_redis)
    monkeypatch.setattr(metrics, "record", no_recursive_record)

    metrics._record_sync("api.requests", 1.0)
    health = metrics.get_collection_health()

    assert health["counters"]["redis_unavailable"] == before + 1
    assert health["last_error_at"] is not None
    assert redis_calls == [True]
    assert recursive_calls == []


def test_real_redis_write_failure_is_visible_locally(monkeypatch, metric_runtime):
    from redis.exceptions import ConnectionError

    metrics, redis, _clock = metric_runtime
    before = metrics._collection_counters["redis_error"]

    def broken_eval(*_args, **_kwargs):
        raise ConnectionError("Injected metric write failure")

    monkeypatch.setattr(redis, "evalsha", broken_eval)

    metrics.record_counter("api.requests")
    health = metrics.get_collection_health()

    assert health["counters"]["redis_error"] == before + 1
    assert health["last_error_at"] is not None


def test_full_async_buffer_counts_dropped_observation(buffered_collector):
    metrics, pending = buffered_collector
    before = metrics._collection_counters["buffer_full"]
    for _observation in range(3):
        metrics.record_later("api.requests", 1.0)

    assert pending.qsize() == 2
    assert metrics._collection_counters["buffer_full"] == before + 1
    health = metrics.get_collection_health()
    assert health["counters"]["buffer_full"] == before + 1
    assert health["queue_depth"] == 2
    assert health["queue_capacity"] == 2


@pytest.mark.parametrize("written_before", [False, True])
def test_recent_loss_is_partial_before_first_write_or_after_old_last_write(
    monkeypatch, written_before
):
    from crate import metrics

    monkeypatch.setattr(
        metrics, "_last_write_at", time.time() - 600 if written_before else None
    )
    monkeypatch.setattr(metrics, "_last_error_at", None)
    monkeypatch.setattr(metrics, "_last_error_reason", None)
    monkeypatch.setattr(
        metrics, "_collection_counters", dict.fromkeys(metrics._collection_counters, 0)
    )

    metrics._collection_event("buffer_full", 3)
    health = metrics.get_collection_health()

    assert health["availability"] == "partial"
    assert health["counters"]["buffer_full"] == 3


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("not.registered", 1.0),
        ("api.requests", float("nan")),
        ("api.requests", float("inf")),
    ],
)
def test_invalid_async_observation_is_rejected_before_enqueue(
    buffered_collector, name, value
):
    metrics, pending = buffered_collector
    before = metrics._collection_counters["invalid_observation"]

    metrics.record_later(name, value)

    assert pending.qsize() == 0
    assert (
        metrics.get_collection_health()["counters"]["invalid_observation"] == before + 1
    )


def test_async_record_failure_does_not_kill_processing_or_leave_unfinished_items(
    buffered_collector, monkeypatch
):
    metrics, pending = buffered_collector
    before = metrics._collection_counters.get("async_error", 0)
    calls = []

    def fail_first(*args, **kwargs):
        calls.append((args, kwargs))
        if len(calls) == 1:
            raise RuntimeError("Injected asynchronous metric failure")

    monkeypatch.setattr(metrics, "_record_sync", fail_first)
    metrics.record_later("api.requests", 1.0)
    metrics.record_later("api.requests", 1.0)

    _drain_async_loop(monkeypatch, metrics, pending)

    assert len(calls) == 2
    assert pending.unfinished_tasks == 0
    health = metrics.get_collection_health()
    assert health["counters"]["async_error"] == before + 1
    assert health["queue_depth"] == 0


def test_async_observation_expires_after_five_minutes(buffered_collector, monkeypatch):
    metrics, pending = buffered_collector
    now = {"value": time.time()}
    monkeypatch.setattr(
        metrics,
        "time",
        SimpleNamespace(time=lambda: now["value"], monotonic=time.monotonic),
    )
    before = metrics._collection_counters.get("buffer_expired", 0)
    writes = []
    monkeypatch.setattr(
        metrics, "_record_sync", lambda *args, **kwargs: writes.append(args)
    )
    metrics.record_later("api.requests", 1.0)
    now["value"] += 301

    _drain_async_loop(monkeypatch, metrics, pending)

    assert writes == []
    assert pending.unfinished_tasks == 0
    assert metrics.get_collection_health()["counters"]["buffer_expired"] == before + 1


def test_buffered_observation_keeps_its_original_minute_and_timestamp(
    buffered_collector, metric_runtime, monkeypatch
):
    from crate.observability import metric_buckets
    from crate.observability.metric_catalog import canonical_metric

    metrics, pending = buffered_collector
    _runtime_metrics, redis, _clock = metric_runtime
    observed = int(time.time()) // 60 * 60 + 10.0
    now = {"value": observed}
    monkeypatch.setattr(
        metrics,
        "time",
        SimpleNamespace(time=lambda: now["value"], monotonic=time.monotonic),
    )
    monkeypatch.setattr(
        metrics,
        "_minute_bucket",
        lambda ts=None: int(now["value"] if ts is None else ts) // 60 * 60,
    )
    metrics.record_later("api.requests", 1.0)
    now["value"] += 120

    _drain_async_loop(monkeypatch, metrics, pending)

    key = metric_buckets.bucket_key(
        canonical_metric("api.requests"), int(observed) // 60 * 60
    )
    assert redis.hget(key, "count") == "1"
    assert float(redis.hget(key, "last_at")) == observed
    assert pending.unfinished_tasks == 0
