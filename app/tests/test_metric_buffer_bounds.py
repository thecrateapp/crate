from __future__ import annotations

import pytest

from crate.observability import metric_buckets
from crate.observability.metric_catalog import canonical_metric
from tests.test_metric_availability import available_runtime as available_runtime
from tests.test_metric_minute_integrity import (
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


@pytest.fixture
def bounded_runtime(available_runtime, monkeypatch):
    metrics, redis, clock = available_runtime
    monkeypatch.setattr(
        metrics,
        "_collection_counters",
        dict.fromkeys(metrics._collection_counters, 0),
    )
    monkeypatch.setattr(metrics, "_last_error_at", None)
    monkeypatch.setattr(metrics, "_last_error_reason", None)
    monkeypatch.setattr(metrics, "_last_write_at", None)
    return metrics, redis, clock


@pytest.mark.parametrize(
    ("configured", "expected"),
    [(None, 7200), ("", 7200), ("invalid", 7200), ("99999999", 7200), ("1", 3600)],
)
def test_live_bucket_ttl_has_a_two_hour_ceiling(monkeypatch, configured, expected):
    from crate import metrics

    if configured is None:
        monkeypatch.delenv("CRATE_METRICS_REDIS_TTL_SECONDS", raising=False)
    else:
        monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", configured)

    assert metrics._bucket_ttl_seconds() == expected


def test_global_bucket_limit_allows_updates_but_rejects_a_third_bucket(
    bounded_runtime,
    monkeypatch,
):
    _metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 2, raising=False)
    series = canonical_metric("api.requests")
    first = clock["minute"]

    for minute in (first, first + 60, first):
        assert metric_buckets.record_sample(
            redis, series, 1.0, minute, minute + 30, 7200
        )

    with pytest.raises(Exception) as rejected:
        metric_buckets.record_sample(redis, series, 1.0, first + 120, first + 150, 7200)

    assert type(rejected.value).__name__ == "MetricBufferFullError"
    all_buckets = getattr(
        metric_buckets, "ALL_BUCKETS_KEY", f"{metric_buckets.PREFIX}:all"
    )
    assert redis.zcard(all_buckets) == 2
    assert redis.zcard(metric_buckets.DIRTY_KEY) == 2
    assert redis.hget(metric_buckets.bucket_key(series, first), "count") == "2"
    assert not redis.exists(metric_buckets.bucket_key(series, first + 120))


def test_global_capacity_loss_is_visible_to_the_process_collector(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 2, raising=False)
    for _ in range(2):
        assert metrics._record_sync("api.requests", 1.0)
        clock["minute"] += 60
        clock["now"] += 60
    before = sum(metrics.get_collection_health()["counters"].values())

    assert metrics._record_sync("api.requests", 1.0) is False

    health = metrics.get_collection_health()
    assert sum(health["counters"].values()) == before + 1
    assert health["availability"] in {"partial", "unavailable"}
    assert health["last_error_reason"]
    assert redis.zcard(metric_buckets.DIRTY_KEY) == 2


def test_buffer_indexes_prune_old_members_and_expire_with_live_data(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 2, raising=False)
    all_buckets = getattr(
        metric_buckets, "ALL_BUCKETS_KEY", f"{metric_buckets.PREFIX}:all"
    )
    quarantine = getattr(
        metric_buckets, "QUARANTINE_KEY", f"{metric_buckets.PREFIX}:quarantine"
    )
    expired = {
        f"{metric_buckets.PREFIX}:expired:{index}": clock["minute"] - 7260
        for index in range(3)
    }
    for key in (all_buckets, metric_buckets.DIRTY_KEY, quarantine):
        redis.zadd(key, expired)

    assert metrics._record_sync("api.requests", 1.0)
    metric_buckets.pending_snapshots(redis)

    assert redis.zcard(all_buckets) == 1
    assert redis.zcard(metric_buckets.DIRTY_KEY) == 1
    assert redis.zcard(quarantine) == 0
    for key in (all_buckets, metric_buckets.DIRTY_KEY, quarantine):
        assert not redis.exists(key) or 0 < redis.ttl(key) <= 7200


def _record_route(metrics, path, value=10.0):
    metrics._record_route_latency_sync(
        value,
        {"method": "GET", "path": path, "status": "200", "target": "api"},
    )


def test_route_buffer_rejects_new_routes_but_keeps_existing_route_updates(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_ROUTE_BUFFER_BUCKETS", 2, raising=False)
    _record_route(metrics, "/api/artists")
    _record_route(metrics, "/api/search")
    before = sum(metrics.get_collection_health()["counters"].values())

    _record_route(metrics, "/api/stats")
    _record_route(metrics, "/api/artists", value=20.0)

    rejected_id = metrics._route_id("api", "GET", "/api/stats")
    rejected_key = metrics._route_metric_key(rejected_id, clock["minute"])
    first_id = metrics._route_id("api", "GET", "/api/artists")
    first_key = metrics._route_metric_key(first_id, clock["minute"])
    assert not redis.exists(rejected_key)
    assert not redis.exists(f"{rejected_key}:samples")
    assert redis.scard(metrics._route_bucket_key(clock["minute"])) == 2
    assert redis.hget(first_key, "count") == "2"
    health = metrics.get_collection_health()
    assert sum(health["counters"].values()) == before + 1
    assert health["availability"] in {"partial", "unavailable"}
    assert health["last_error_reason"]


@pytest.mark.parametrize("configured", [None, "10000"])
def test_route_sample_limit_never_exceeds_one_thousand(monkeypatch, configured):
    from crate import metrics

    if configured is None:
        monkeypatch.delenv("CRATE_ROUTE_METRIC_SAMPLE_LIMIT", raising=False)
    else:
        monkeypatch.setenv("CRATE_ROUTE_METRIC_SAMPLE_LIMIT", configured)

    assert metrics._route_sample_limit() == 1000


def test_route_sample_list_is_capped_while_observation_count_keeps_growing(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setenv("CRATE_ROUTE_METRIC_SAMPLE_LIMIT", "10000")
    for value in range(1005):
        _record_route(metrics, "/api/artists", value=float(value))

    route_id = metrics._route_id("api", "GET", "/api/artists")
    key = metrics._route_metric_key(route_id, clock["minute"])
    assert redis.hget(key, "count") == "1005"
    assert redis.llen(f"{key}:samples") == 1000
    assert redis.lindex(f"{key}:samples", 0) == "5.0"


def _two_acknowledged_minutes(metrics, redis, clock):
    first = clock["minute"]
    assert metrics._record_sync("api.requests", 1.0)
    clock["minute"] += 60
    clock["now"] += 60
    assert metrics._record_sync("api.requests", 1.0)
    pending = metric_buckets.pending_snapshots(redis)
    assert len(pending) == 2
    metric_buckets.acknowledge_snapshots(redis, pending)
    assert redis.zcard(metric_buckets.DIRTY_KEY) == 0
    clock["minute"] += 60
    clock["now"] += 60
    return first


def test_new_minute_reclaims_old_acknowledged_history_before_rejecting(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 2)
    first = _two_acknowledged_minutes(metrics, redis, clock)

    assert metrics._record_sync("api.requests", 1.0) is True

    series = canonical_metric("api.requests")
    oldest = metric_buckets.bucket_key(series, first)
    latest = metric_buckets.bucket_key(series, clock["minute"])
    assert not redis.exists(oldest)
    assert redis.exists(latest)
    assert redis.zcard(metric_buckets.ALL_BUCKETS_KEY) <= 2
    assert redis.zscore(metric_buckets.DIRTY_KEY, latest) is not None
    assert (
        redis.zscore(
            f"{metric_buckets.PREFIX}:buckets:api.request.count",
            oldest,
        )
        is None
    )


def test_trimmed_live_history_is_partial_only_for_windows_that_include_it(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 2)
    _two_acknowledged_minutes(metrics, redis, clock)
    assert metrics._record_sync("api.requests", 1.0)

    spanning = metrics.query_summary("api.requests", minutes=5)
    recent = metrics.query_summary("api.requests", minutes=1)

    assert spanning["count"] == 2
    assert spanning["availability"] == "partial"
    assert spanning["reason"] == "live_buffer_trimmed"
    assert recent["count"] == 1
    assert recent["availability"] == "available"


def test_reclamation_skips_an_older_unpersisted_bucket(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 2)
    first = clock["minute"]
    assert metrics._record_sync("api.requests", 1.0)
    clock["minute"] += 60
    clock["now"] += 60
    assert metrics._record_sync("api.requests", 1.0)
    pending = metric_buckets.pending_snapshots(redis)
    metric_buckets.acknowledge_snapshots(redis, pending[1:])
    clock["minute"] += 60
    clock["now"] += 60

    assert metrics._record_sync("api.requests", 1.0) is True

    series = canonical_metric("api.requests")
    oldest = metric_buckets.bucket_key(series, first)
    acknowledged = metric_buckets.bucket_key(series, first + 60)
    assert redis.hget(oldest, "count") == "1"
    assert redis.zscore(metric_buckets.DIRTY_KEY, oldest) is not None
    assert not redis.exists(acknowledged)
    assert redis.zcard(metric_buckets.ALL_BUCKETS_KEY) == 2
    assert redis.zcard(metric_buckets.DIRTY_KEY) == 2


def test_a_single_unpersisted_bucket_is_never_reclaimed(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 1)
    first = clock["minute"]
    assert metrics._record_sync("api.requests", 1.0)
    clock["minute"] += 60
    clock["now"] += 60

    assert metrics._record_sync("api.requests", 1.0) is False

    series = canonical_metric("api.requests")
    original = metric_buckets.bucket_key(series, first)
    rejected = metric_buckets.bucket_key(series, clock["minute"])
    assert redis.hget(original, "count") == "1"
    assert redis.zscore(metric_buckets.DIRTY_KEY, original) is not None
    assert not redis.exists(rejected)
    assert redis.zcard(metric_buckets.ALL_BUCKETS_KEY) == 1


def test_quarantined_unpersisted_history_is_not_a_reclamation_candidate(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 2)
    assert metrics._record_sync("api.requests", 1.0)
    pending = metric_buckets.pending_snapshots(redis)
    quarantined_key, row = pending[0]
    assert metric_buckets.quarantine_snapshot(
        redis,
        quarantined_key,
        row,
        run_id=redis.info("server")["run_id"],
        ttl=7200,
    )
    clock["minute"] += 60
    clock["now"] += 60
    assert metrics._record_sync("api.requests", 1.0)
    clock["minute"] += 60
    clock["now"] += 60

    assert metrics._record_sync("api.requests", 1.0) is False

    assert redis.exists(quarantined_key)
    assert redis.zscore(metric_buckets.QUARANTINE_KEY, quarantined_key) is not None
    assert redis.zcard(metric_buckets.ALL_BUCKETS_KEY) == 2


def test_a_new_route_minute_rotates_older_raw_buckets_with_truthful_coverage(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_ROUTE_BUFFER_BUCKETS", 2)
    old_minute = clock["minute"]
    old_keys = []
    for path in ("/api/artists", "/api/search"):
        _record_route(metrics, path)
        route_id = metrics._route_id("api", "GET", path)
        old_keys.append(metrics._route_metric_key(route_id, old_minute))
    clock["minute"] += 60
    clock["now"] += 60

    _record_route(metrics, "/api/stats")

    route_id = metrics._route_id("api", "GET", "/api/stats")
    new_key = metrics._route_metric_key(route_id, clock["minute"])
    assert redis.hget(new_key, "count") == "1"
    assert redis.llen(f"{new_key}:samples") == 1
    removed = [key for key in old_keys if not redis.exists(key)]
    assert len(removed) == 1
    assert not redis.exists(f"{removed[0]}:samples")
    assert redis.scard(metrics._route_bucket_key(old_minute)) == 1
    assert redis.zcard(metric_buckets.ROUTE_BUFFER_KEY) == 2

    spanning = metrics.query_route_latency_snapshot(minutes=2)
    recent = metrics.query_route_latency_snapshot(minutes=1)

    assert spanning["availability"] == "partial"
    assert spanning["reason"] == "live_route_buffer_trimmed"
    assert spanning["observed_count"] == 2
    assert recent["availability"] == "available"
    assert recent["observed_count"] == 1
    assert recent["routes"][0]["path"] == "/api/stats"


def test_losing_the_dirty_index_does_not_authorize_unpersisted_reclamation(
    bounded_runtime,
    monkeypatch,
):
    metrics, redis, clock = bounded_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 1)
    first = clock["minute"]
    assert metrics._record_sync("api.requests", 1.0)
    assert redis.delete(metric_buckets.DIRTY_KEY) == 1
    clock["minute"] += 60
    clock["now"] += 60

    assert metrics._record_sync("api.requests", 1.0) is False

    series = canonical_metric("api.requests")
    original = metric_buckets.bucket_key(series, first)
    rejected = metric_buckets.bucket_key(series, clock["minute"])
    assert redis.hget(original, "count") == "1"
    assert not redis.exists(rejected)
    assert redis.zcard(metric_buckets.ALL_BUCKETS_KEY) == 1
