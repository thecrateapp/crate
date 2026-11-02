from __future__ import annotations

from datetime import datetime, timezone
from math import ceil

import pytest

from crate.observability import metric_buckets
from crate.observability.metric_catalog import canonical_metric
from tests.test_metric_minute_integrity import (
    _historical_totals,
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


def _request_bucket(clock):
    return metric_buckets.bucket_key(canonical_metric("api.requests"), clock["minute"])


def _numeric_summary(summary):
    return {key: summary[key] for key in ("count", "avg", "min", "max", "sum")}


def _observe_pipelines(monkeypatch, redis):
    batches = []
    original_pipeline = redis.pipeline

    def pipeline(*args, **kwargs):
        current = original_pipeline(*args, **kwargs)
        original_execute = current.execute

        def execute(*execute_args, **execute_kwargs):
            batches.append([command for command, _options in current.command_stack])
            return original_execute(*execute_args, **execute_kwargs)

        monkeypatch.setattr(current, "execute", execute)
        return current

    monkeypatch.setattr(redis, "pipeline", pipeline)
    return batches


def test_record_sync_indexes_canonical_series_and_marks_minute_dirty(metric_runtime):
    metrics, redis, clock = metric_runtime

    metrics._record_sync("api.requests", 1.0)

    key = _request_bucket(clock)
    assert redis.smembers(metric_buckets.NAMES_KEY) == {"api.request.count"}
    assert redis.hget(key, "count") == "1"
    assert redis.hget(key, "sum") == "1"
    assert redis.zscore(metric_buckets.DIRTY_KEY, key) == clock["minute"]
    assert redis.zrange(
        f"{metric_buckets.PREFIX}:buckets:api.request.count", 0, -1
    ) == [key]
    assert redis.exists("crate:metric_keys") == 0


def test_record_route_latency_indexes_real_sample_and_canonical_metric(metric_runtime):
    metrics, redis, clock = metric_runtime
    path = "/api/me/home/discovery"
    tags = {"method": "GET", "path": path, "status": "200"}

    metrics._record_route_latency_sync(42.0, tags)

    route_id = metrics._route_id("api", "GET", path)
    assert metrics._ROUTE_LATENCY_METRIC in redis.smembers(metric_buckets.NAMES_KEY)
    assert redis.smembers(metrics._route_bucket_key(clock["minute"])) == {route_id}
    route_key = metrics._route_metric_key(route_id, clock["minute"])
    assert redis.lrange(f"{route_key}:samples", 0, -1) == ["42.0"]
    assert redis.hget(route_key, "status_2xx") == "1"
    canonical_key = metric_buckets.bucket_key(
        canonical_metric(metrics._ROUTE_LATENCY_METRIC, tags), clock["minute"]
    )
    assert redis.zscore(metric_buckets.DIRTY_KEY, canonical_key) == clock["minute"]


def test_flush_reads_dirty_index_without_scanning_other_redis_keys(
    pg_db, metric_runtime, monkeypatch
):
    metrics, redis, clock = metric_runtime
    metrics.record_counter("api.requests")
    redis.sadd(metrics._route_bucket_key(clock["minute"]), "unrelated-route-index")
    redis.set("crate:metrics:unrelated:string", "not-a-metric-hash")

    def no_scan(*_args, **_kwargs):
        pytest.fail("Metric flush must use its dirty index instead of scanning Redis")

    monkeypatch.setattr(redis, "scan", no_scan)
    monkeypatch.setattr(redis, "scan_iter", no_scan)

    metrics.flush_to_postgres()

    assert _historical_totals(metrics, "api.requests") == {"count": 1, "sum": 1.0}
    assert redis.zcard(metric_buckets.DIRTY_KEY) == 0
    assert redis.get("crate:metrics:unrelated:string") == "not-a-metric-hash"


def test_legacy_hundred_observations_are_not_combined_with_two_v2_observations(
    pg_db, metric_runtime
):
    from crate.db.queries.management import query_metric_rollups
    from crate.db.repositories.management import upsert_metric_rollup

    metrics, redis, clock = metric_runtime
    minute = clock["minute"]
    redis.hset(
        f"crate:metrics:api.requests:{minute}",
        mapping={"count": 100, "sum": 100, "min": 1, "max": 1},
    )
    redis.sadd("crate:metric_keys", "api.requests")
    bucket_start = datetime.fromtimestamp(minute, timezone.utc).replace(minute=0)
    upsert_metric_rollup(
        name="api.requests",
        tags_json="{}",
        period="hour",
        bucket_start=bucket_start.isoformat(),
        count=100,
        sum_value=100.0,
        min_value=1.0,
        max_value=1.0,
        avg_value=1.0,
    )
    for _observation in range(2):
        metrics.record_counter("api.requests")

    assert _numeric_summary(metrics.query_summary("api.requests")) == {
        "count": 2,
        "avg": 1.0,
        "min": 1.0,
        "max": 1.0,
        "sum": 2.0,
    }
    metrics.flush_to_postgres()
    metrics.flush_to_postgres()

    assert _historical_totals(metrics, "api.requests") == {"count": 2, "sum": 2.0}
    assert query_metric_rollups(name="api.requests")[0]["count"] == 100
    assert redis.hget(f"crate:metrics:api.requests:{minute}", "count") == "100"


def test_metrics_redis_bucket_ttl_is_configurable(monkeypatch):
    from crate import metrics

    monkeypatch.delenv("CRATE_METRICS_REDIS_TTL_SECONDS", raising=False)
    assert metrics._bucket_ttl_seconds() == 2 * 3600

    monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", "7200")
    assert metrics._bucket_ttl_seconds() == 7200

    monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", "60")
    assert metrics._bucket_ttl_seconds() == 3600

    monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", "invalid")
    assert metrics._bucket_ttl_seconds() == 2 * 3600


def test_record_sync_expires_buckets_and_keeps_indexes_non_volatile(
    monkeypatch, metric_runtime
):
    metrics, redis, clock = metric_runtime
    monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", "7200")

    metrics._record_sync("api.requests", 1.0)

    indexes = [
        metric_buckets.NAMES_KEY,
        f"{metric_buckets.PREFIX}:series:api.request.count",
        f"{metric_buckets.PREFIX}:buckets:api.request.count",
    ]
    assert 7198 <= redis.ttl(_request_bucket(clock)) <= 7200
    assert all(redis.ttl(key) == -1 for key in indexes)


@pytest.mark.parametrize("failure_phase", ["before_commit", "after_commit"])
def test_failed_flush_keeps_dirty_and_retry_does_not_lose_or_duplicate(
    pg_db, metric_runtime, monkeypatch, failure_phase
):
    from crate.db.repositories import metric_minutes

    metrics, redis, clock = metric_runtime
    for _observation in range(10):
        metrics.record_counter("api.requests")
    key = _request_bucket(clock)
    original_persist = metric_minutes.persist_metric_collection
    calls = 0

    def fail_first_flush(snapshots, **kwargs):
        nonlocal calls
        if not snapshots:
            return original_persist(snapshots, **kwargs)
        calls += 1
        if calls == 1:
            if failure_phase == "after_commit":
                original_persist(snapshots, **kwargs)
            raise RuntimeError("Injected database transport failure")
        return original_persist(snapshots, **kwargs)

    monkeypatch.setattr(metric_minutes, "persist_metric_collection", fail_first_flush)

    metrics.flush_to_postgres()

    assert redis.zscore(metric_buckets.DIRTY_KEY, key) == clock["minute"]
    persisted = 10 if failure_phase == "after_commit" else 0
    assert _historical_totals(metrics, "api.requests") == {
        "count": persisted,
        "sum": float(persisted),
    }

    metrics.flush_to_postgres()
    metrics.flush_to_postgres()

    assert _historical_totals(metrics, "api.requests") == {"count": 10, "sum": 10.0}
    assert redis.zscore(metric_buckets.DIRTY_KEY, key) is None
    assert calls == 2


def test_observation_between_persist_and_ack_remains_dirty_until_next_snapshot(
    pg_db, metric_runtime, monkeypatch
):
    metrics, redis, clock = metric_runtime
    for _observation in range(10):
        metrics.record_counter("api.requests")
    key = _request_bucket(clock)
    original_ack = metric_buckets.acknowledge_snapshots
    dirty_after_ack = []

    def write_before_first_ack(connection, snapshots, **kwargs):
        if not dirty_after_ack:
            assert _historical_totals(metrics, "api.requests") == {
                "count": 10,
                "sum": 10.0,
            }
            metrics.record_counter("api.requests")
        original_ack(connection, snapshots, **kwargs)
        dirty_after_ack.append(redis.zscore(metric_buckets.DIRTY_KEY, key))

    monkeypatch.setattr(metric_buckets, "acknowledge_snapshots", write_before_first_ack)

    metrics.flush_to_postgres()

    assert dirty_after_ack == [clock["minute"], None]
    assert _historical_totals(metrics, "api.requests") == {"count": 11, "sum": 11.0}


class TestMetricsBatchQueries:
    def test_two_specs_sharing_a_family_download_each_real_bucket_once(
        self, metric_runtime
    ):
        metrics, redis, _clock = metric_runtime
        metrics.record_counter("api.request.count", {"status": "200"})
        metrics.record_counter("api.request.count", {"status": "200"})
        before = redis.info("commandstats")

        summaries = metrics.query_summaries(
            {
                "requests": ("api.request.count", 5),
                "errors": ("api.request.count", 5, {"status_class": "5xx"}),
            }
        )

        after = redis.info("commandstats")
        hmget_before = before.get("cmdstat_hmget", {}).get("calls", 0)
        hmget_after = after.get("cmdstat_hmget", {}).get("calls", 0)
        assert hmget_after - hmget_before == 1
        hgetall_before = before.get("cmdstat_hgetall", {}).get("calls", 0)
        hgetall_after = after.get("cmdstat_hgetall", {}).get("calls", 0)
        assert hgetall_after == hgetall_before
        assert summaries["requests"]["count"] == 2
        assert summaries["errors"]["count"] == 0
        assert summaries["errors"]["eligible_count"] == 2
        assert summaries["errors"]["availability"] == "available"

    def test_bucket_budget_bounds_index_download_before_rejecting(
        self, monkeypatch, metric_runtime
    ):
        metrics, redis, clock = metric_runtime
        now = clock["minute"]
        for offset in range(3):
            clock["minute"] = now - offset * 60
            metrics.record_counter("api.requests")
        clock["minute"] = now
        monkeypatch.setattr(metric_buckets, "MAX_READ_BUCKETS", 2)
        original_pipeline = redis.pipeline

        def bounded_pipeline(*args, **kwargs):
            current = original_pipeline(*args, **kwargs)
            original_range = current.zrangebyscore

            def bounded_range(name, minimum, maximum, start=None, num=None, **options):
                assert start is not None, (
                    "Index download must have a server-side offset"
                )
                assert num is not None and 0 < num <= 3, (
                    "Index download must be limited to the remaining budget plus one"
                )
                return original_range(
                    name, minimum, maximum, start=start, num=num, **options
                )

            monkeypatch.setattr(current, "zrangebyscore", bounded_range)
            return current

        monkeypatch.setattr(redis, "pipeline", bounded_pipeline)

        with pytest.raises(ValueError, match="budget"):
            metric_buckets.read_buckets(redis, {"requests": ("api.requests", 3)}, now)

    @pytest.mark.parametrize("minute_count", [2, 501])
    def test_query_summaries_batches_indexed_buckets_in_bounded_pipelines(
        self, monkeypatch, metric_runtime, minute_count
    ):
        metrics, redis, clock = metric_runtime
        now = clock["minute"]
        for offset in range(minute_count):
            clock["minute"] = now - offset * 60
            metrics.record("api.request.latency", 40.0)
            metrics.record("api.request.latency", 44.0)
        clock["minute"] = now
        metrics.record_counter("api.request.errors")
        batches = _observe_pipelines(monkeypatch, redis)

        summaries = metrics.query_summaries(
            {
                "api_latency": ("api.request.latency", minute_count),
                "api_errors": ("api.request.errors", 1),
            }
        )

        assert _numeric_summary(summaries["api_latency"]) == {
            "count": minute_count * 2,
            "avg": 42.0,
            "min": 40.0,
            "max": 44.0,
            "sum": minute_count * 84.0,
        }
        assert _numeric_summary(summaries["api_errors"]) == {
            "count": 1,
            "avg": 1.0,
            "min": 1.0,
            "max": 1.0,
            "sum": 1.0,
        }
        hash_batches = [batch for batch in batches if batch and batch[0][0] == "HMGET"]
        assert len(hash_batches) == ceil((minute_count + 1) / 500)
        assert len(batches) <= 1 + len(hash_batches)
        assert sum(len(batch) for batch in hash_batches) == minute_count + 1
        assert all(len(batch) <= 500 for batch in hash_batches)
        assert all(command[0] == "HMGET" for batch in hash_batches for command in batch)

    def test_query_route_latency_aggregates_recent_p95_p99(self, metric_runtime):
        metrics, _redis, _clock = metric_runtime
        path = "/api/me/home/discovery"
        route_id = metrics._route_id("api", "GET", path)
        for value in (100.0, 120.0, 80.0):
            metrics._record_route_latency_sync(
                value, {"method": "GET", "path": path, "status": "200"}
            )

        routes = metrics.query_route_latency(minutes=2, limit=10)

        assert routes == [
            {
                "route_id": route_id,
                "target": "api",
                "method": "GET",
                "path": path,
                "count": 3,
                "sum": 300.0,
                "min": 80.0,
                "max": 120.0,
                "status_2xx": 3,
                "status_3xx": 0,
                "status_4xx": 0,
                "status_5xx": 0,
                "status_other": 0,
                "avg": 100.0,
                "p95": 120.0,
                "p99": 120.0,
                "error_rate": 0.0,
                "sample_count": 3,
                "sampled": False,
            }
        ]

    def test_query_route_latency_declares_the_bounded_sample_population(
        self, metric_runtime, monkeypatch
    ):
        metrics, _redis, _clock = metric_runtime
        monkeypatch.setenv("CRATE_ROUTE_METRIC_SAMPLE_LIMIT", "50")
        for value in range(1, 61):
            metrics._record_route_latency_sync(
                float(value),
                {"method": "GET", "path": "/api/me/home/discovery", "status": "200"},
            )

        routes = metrics.query_route_latency(minutes=2, limit=10)

        assert len(routes) == 1
        assert routes[0]["count"] == 60
        assert routes[0]["sample_count"] == 50
        assert routes[0]["sampled"] is True
        assert routes[0]["p95"] == 58.0
        assert routes[0]["p99"] == 60.0
