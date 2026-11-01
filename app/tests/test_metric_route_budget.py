from __future__ import annotations

import pytest

from tests.test_metric_minute_integrity import (
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


def _calls(redis, command: str) -> int:
    return redis.info("commandstats").get(f"cmdstat_{command}", {}).get("calls", 0)


def _hash_reads(redis) -> int:
    stats = redis.info("commandstats")
    return sum(
        stats.get(f"cmdstat_{command}", {}).get("calls", 0)
        for command in ("hgetall", "hmget")
    )


def _record_route(metrics, path="/api/artists", value=10.0):
    metrics._record_route_latency_sync(
        value, {"method": "GET", "path": path, "status": "200", "target": "api"}
    )


def _snapshot(metrics, **kwargs):
    reader = getattr(metrics, "query_route_latency_snapshot", None)
    assert callable(reader), (
        "Route reads need an availability-bearing snapshot contract"
    )
    return reader(**kwargs)


def test_route_bucket_budget_is_checked_before_hash_or_sample_download(
    metric_runtime, monkeypatch
):
    metrics, redis, _clock = metric_runtime
    for path in ("/api/artists", "/api/search", "/api/stats"):
        _record_route(metrics, path)
    monkeypatch.setattr(metrics, "_MAX_ROUTE_BUCKETS", 2, raising=False)
    hashes_before, samples_before = _hash_reads(redis), _calls(redis, "lrange")

    metrics.query_route_latency(minutes=20)

    assert _hash_reads(redis) == hashes_before
    assert _calls(redis, "lrange") == samples_before


def test_route_sample_budget_is_checked_before_downloading_lists(
    metric_runtime, monkeypatch
):
    metrics, redis, _clock = metric_runtime
    for value in (10.0, 20.0, 30.0):
        _record_route(metrics, value=value)
    monkeypatch.setattr(metrics, "_MAX_ROUTE_SAMPLES", 2, raising=False)
    before = _calls(redis, "lrange")

    metrics.query_route_latency(minutes=20)

    assert _calls(redis, "lrange") == before


def test_sparse_route_window_reads_only_the_two_existing_route_buckets(metric_runtime):
    metrics, redis, clock = metric_runtime
    now = clock["minute"]
    clock["minute"] = now - 19 * 60
    _record_route(metrics, "/api/artists")
    clock["minute"] = now
    _record_route(metrics, "/api/search")
    before = _hash_reads(redis)

    rows = metrics.query_route_latency(minutes=20)

    assert {row["path"] for row in rows} == {"/api/artists", "/api/search"}
    assert sum(row["count"] for row in rows) == 2
    assert _hash_reads(redis) - before <= 2


def test_rejected_canonical_route_series_does_not_write_auxiliary_indexes_or_samples(
    metric_runtime, monkeypatch
):
    metrics, redis, clock = metric_runtime
    monkeypatch.setattr(metrics.metric_buckets, "record_sample", lambda *_args: False)

    _record_route(metrics)

    route_id = metrics._route_id("api", "GET", "/api/artists")
    key = metrics._route_metric_key(route_id, clock["minute"])
    assert redis.smembers(metrics._route_bucket_key(clock["minute"])) == set()
    assert not redis.exists(key)
    assert not redis.exists(f"{key}:samples")


@pytest.mark.parametrize("budget", ["buckets", "samples"])
def test_route_snapshot_distinguishes_exceeded_budget_from_an_empty_window(
    metric_runtime, monkeypatch, budget
):
    metrics, _redis, _clock = metric_runtime
    if budget == "buckets":
        _record_route(metrics, "/api/artists")
        _record_route(metrics, "/api/search")
        monkeypatch.setattr(metrics, "_MAX_ROUTE_BUCKETS", 1, raising=False)
    else:
        _record_route(metrics, value=10.0)
        _record_route(metrics, value=20.0)
        monkeypatch.setattr(metrics, "_MAX_ROUTE_SAMPLES", 1, raising=False)

    snapshot = _snapshot(metrics, minutes=20, limit=20)

    assert snapshot["routes"] == []
    assert snapshot["availability"] == "unavailable"
    assert snapshot["reason"] == "read_budget"
    assert snapshot["source"] == "redis_v2"
    assert snapshot["sample_kind"] == "bounded_samples"


def test_route_snapshot_declares_observed_and_retained_sample_populations(
    metric_runtime,
):
    metrics, _redis, _clock = metric_runtime
    for value in (10.0, 20.0, 30.0):
        _record_route(metrics, value=value)

    snapshot = _snapshot(metrics, minutes=20, limit=20)

    assert snapshot["availability"] == "available"
    assert snapshot["source"] == "redis_v2"
    assert snapshot["sample_kind"] == "bounded_samples"
    assert snapshot["observed_count"] == 3
    assert snapshot["sample_count"] == 3
    assert len(snapshot["routes"]) == 1


def test_route_snapshot_exposes_partial_data_when_observed_headers_lost_their_samples(
    metric_runtime,
):
    metrics, redis, clock = metric_runtime
    for value in (10.0, 20.0, 30.0):
        _record_route(metrics, value=value)
    route_id = metrics._route_id("api", "GET", "/api/artists")
    key = metrics._route_metric_key(route_id, clock["minute"])
    assert int(redis.hget(key, "count")) == 3
    redis.delete(f"{key}:samples")

    snapshot = _snapshot(metrics, minutes=20, limit=20)

    assert snapshot["availability"] == "partial"
    assert snapshot["reason"]
    assert snapshot["observed_count"] == 3
    assert snapshot["sample_count"] == 0
    assert snapshot["routes"] == []
