from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from tests.test_metric_availability import available_runtime as available_runtime
from tests.test_metric_minute_integrity import (
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


@pytest.fixture
def review_runtime(available_runtime, monkeypatch):
    from crate.db.queries import metric_minutes

    metrics, redis, clock = available_runtime
    monkeypatch.setattr(
        metric_minutes,
        "_now",
        lambda: datetime.fromtimestamp(clock["now"], timezone.utc),
    )
    monkeypatch.setattr(
        metrics,
        "_collection_counters",
        dict.fromkeys(metrics._collection_counters, 0),
    )
    monkeypatch.setattr(metrics, "_last_error_at", None)
    monkeypatch.setattr(metrics, "_last_error_reason", None)
    monkeypatch.setattr(metrics, "_last_write_at", None)
    return metrics, redis, clock


def _advance(clock, seconds):
    clock["minute"] += seconds
    clock["now"] += seconds


def test_data_loss_before_first_bucket_flush_is_partial_even_without_a_saved_row(
    pg_db,
    review_runtime,
):
    metrics, redis, clock = review_runtime
    metrics.flush_to_postgres()
    metrics.record_counter("api.requests")
    lost_minute = datetime.fromtimestamp(clock["minute"], timezone.utc).isoformat()
    redis.flushdb()
    _advance(clock, 60)
    metrics.record_counter("api.requests")

    metrics.flush_to_postgres()
    result = metrics.query_timeseries_snapshot(
        ["api.requests"],
        minutes=5,
        persisted=True,
    )

    points = result["data"]["api.request.count"]
    assert sum(point["count"] for point in points) == 1
    assert all(point["timestamp"] != lost_minute for point in points)
    status = result["status"]["api.request.count"]
    assert status["availability"] == "partial"
    assert status["reason"]


def test_new_window_after_a_collection_gap_recovers_without_hiding_old_gap(
    pg_db,
    review_runtime,
):
    metrics, redis, clock = review_runtime
    metrics.flush_to_postgres()
    metrics.record_counter("api.requests")
    redis.flushdb()
    _advance(clock, 60)
    metrics.record_counter("api.requests")
    metrics.flush_to_postgres()
    _advance(clock, 600)
    metrics.record_counter("api.requests")
    metrics.flush_to_postgres()

    recent = metrics.query_timeseries_snapshot(
        ["api.requests"],
        minutes=5,
        persisted=True,
    )
    spanning = metrics.query_timeseries_snapshot(
        ["api.requests"],
        minutes=60,
        persisted=True,
    )

    assert recent["status"]["api.request.count"]["availability"] == "available"
    assert spanning["status"]["api.request.count"]["availability"] == "partial"


def _future_metric_buckets(redis, metrics, clock, count):
    pipe = redis.pipeline(transaction=False)
    for index in range(count):
        key = f"{metrics.metric_buckets.PREFIX}:bucket:future-{index}:{clock['minute']}"
        pipe.hset(
            key,
            mapping={
                "name": "qoe.future.duration",
                "tags": "{}",
                "minute": clock["minute"] - 60,
                "source_id": f"future-source-{index}",
                "revision": 1,
                "count": 1,
                "sum": 1,
                "min": 1,
                "max": 1,
                "last": 1,
                "last_at": clock["now"] - 60,
            },
        )
        pipe.expire(key, 7200)
        pipe.zadd(metrics.metric_buckets.DIRTY_KEY, {key: clock["minute"] - 60})
    pipe.execute()


@pytest.mark.parametrize("unsupported_count", [1, 501])
def test_unknown_catalog_buckets_do_not_starve_valid_persistence(
    pg_db,
    review_runtime,
    unsupported_count,
):
    metrics, redis, clock = review_runtime
    _future_metric_buckets(redis, metrics, clock, unsupported_count)
    metrics.record_counter("api.requests")

    metrics.flush_to_postgres()
    result = metrics.query_timeseries_snapshot(
        ["api.requests"],
        minutes=5,
        persisted=True,
    )

    assert sum(point["count"] for point in result["data"]["api.request.count"]) == 1
    health = metrics.get_collection_health()
    assert health["availability"] in {"partial", "unavailable"}
    assert health["last_error_reason"]
    assert sum(health["counters"].values()) >= unsupported_count


def test_persisted_points_become_stale_when_no_fresh_flush_arrives(
    pg_db,
    review_runtime,
):
    metrics, _redis, clock = review_runtime
    metrics.record_counter("api.requests")
    metrics.flush_to_postgres()
    _advance(clock, 660)

    result = metrics.query_timeseries_snapshot(
        ["api.requests"],
        minutes=60,
        persisted=True,
    )

    assert sum(point["count"] for point in result["data"]["api.request.count"]) == 1
    status = result["status"]["api.request.count"]
    assert status["availability"] == "stale"
    assert status["age_seconds"] == pytest.approx(660)
    assert status["reason"]


def test_a_new_bucket_during_index_selection_keeps_a_bounded_live_summary(
    review_runtime,
    monkeypatch,
):
    metrics, redis, clock = review_runtime
    metrics.record_counter("api.requests")
    _advance(clock, 60)
    original_pipeline = redis.pipeline
    injected = False

    def racing_pipeline(*args, **kwargs):
        pipe = original_pipeline(*args, **kwargs)
        original_execute = pipe.execute

        def execute(*execute_args, **execute_kwargs):
            nonlocal injected
            counted_index = any(
                command[0][0] == "ZCOUNT" for command in pipe.command_stack
            )
            result = original_execute(*execute_args, **execute_kwargs)
            if counted_index and not injected:
                injected = True
                metrics.record_counter("api.requests")
            return result

        pipe.execute = execute
        return pipe

    monkeypatch.setattr(redis, "pipeline", racing_pipeline)

    summary = metrics.query_summary("api.requests", minutes=5)

    assert summary["availability"] == "available"
    assert summary["count"] in {1, 2}
    assert summary["sum"] == summary["count"]


@pytest.mark.parametrize(
    "poison", ["unaligned_minute", "oversized_source", "invalid_minute"]
)
def test_malformed_known_family_bucket_does_not_block_valid_persistence(
    pg_db,
    review_runtime,
    poison,
):
    metrics, redis, clock = review_runtime
    key = f"{metrics.metric_buckets.PREFIX}:bucket:known-poison:{poison}"
    row = {
        "name": "api.request.count",
        "tags": "{}",
        "minute": clock["minute"] - 60,
        "source_id": "source-poison",
        "revision": 1,
        "count": 1,
        "sum": 1,
        "min": 1,
        "max": 1,
        "last": 1,
        "last_at": clock["now"] - 60,
    }
    if poison == "unaligned_minute":
        row["minute"] = clock["minute"] - 59
    elif poison == "oversized_source":
        row["source_id"] = "x" * 161
    else:
        row["minute"] = "bad"
    redis.hset(key, mapping=row)
    redis.expire(key, 7200)
    redis.zadd(metrics.metric_buckets.DIRTY_KEY, {key: clock["minute"] - 60})
    metrics.record_counter("api.requests")

    metrics.flush_to_postgres()
    result = metrics.query_timeseries_snapshot(
        ["api.requests"],
        minutes=5,
        persisted=True,
    )

    assert sum(point["count"] for point in result["data"]["api.request.count"]) == 1
    health = metrics.get_collection_health()
    assert health["availability"] in {"partial", "unavailable"}
    assert health["last_error_reason"]
    assert sum(health["counters"].values()) >= 1


def test_changed_source_covers_the_oldest_unpersisted_backlog_without_rows(
    pg_db,
    review_runtime,
):
    from crate.db.queries.metric_minutes import get_metric_history_status
    from crate.db.repositories.metric_minutes import persist_metric_collection

    _metrics, _redis, clock = review_runtime
    now = datetime.fromtimestamp(clock["now"], timezone.utc)
    oldest = now - timedelta(minutes=30)
    persist_metric_collection(
        [],
        source_id="before",
        checked_at=now,
        pending_buckets=1,
        oldest_pending_at=oldest.timestamp(),
    )

    persist_metric_collection(
        [], source_id="after", checked_at=now + timedelta(minutes=1)
    )

    gaps = get_metric_history_status()["collection"]["gaps"]
    assert any(
        datetime.fromisoformat(start) <= oldest <= datetime.fromisoformat(end)
        for start, end in gaps
    )


def test_missing_indexed_generic_bucket_prevents_a_healthy_live_summary(review_runtime):
    from crate.observability.metric_catalog import canonical_metric

    metrics, redis, clock = review_runtime
    for method in ("GET", "POST"):
        metrics.record_counter("api.requests", {"method": method})
    removed = metrics.metric_buckets.bucket_key(
        canonical_metric("api.requests", {"method": "GET"}),
        clock["minute"],
    )
    assert redis.delete(removed) == 1

    summary = metrics.query_summary("api.requests", minutes=5)

    assert summary["availability"] != "available"
    assert summary["reason"]


def test_missing_indexed_route_header_prevents_a_healthy_route_snapshot(review_runtime):
    metrics, redis, clock = review_runtime
    for path in ("/api/artists", "/api/search"):
        metrics._record_route_latency_sync(
            10.0,
            {"method": "GET", "path": path, "status": "200", "target": "api"},
        )
    removed_id = metrics._route_id("api", "GET", "/api/artists")
    removed = metrics._route_metric_key(removed_id, clock["minute"])
    assert redis.delete(removed) == 1

    snapshot = metrics.query_route_latency_snapshot(minutes=5)

    assert snapshot["availability"] != "available"
    assert snapshot["reason"]


def test_future_label_on_known_family_is_quarantined_without_merging_observations(
    pg_db,
    review_runtime,
):
    metrics, redis, clock = review_runtime
    key = f"{metrics.metric_buckets.PREFIX}:bucket:future-label:{clock['minute']}"
    raw_tags = '{"future_label":"new-dimension"}'
    redis.hset(
        key,
        mapping={
            "name": "api.request.count",
            "tags": raw_tags,
            "minute": clock["minute"],
            "source_id": "future-label-source",
            "revision": 7,
            "count": 7,
            "sum": 7,
            "min": 1,
            "max": 1,
            "last": 1,
            "last_at": clock["now"],
        },
    )
    redis.expire(key, 7200)
    redis.zadd(metrics.metric_buckets.DIRTY_KEY, {key: clock["minute"] - 60})
    metrics.record_counter("api.requests")

    metrics.flush_to_postgres()
    result = metrics.query_timeseries_snapshot(
        ["api.requests"],
        minutes=5,
        persisted=True,
    )

    assert sum(point["count"] for point in result["data"]["api.request.count"]) == 1
    assert redis.zscore(metrics.metric_buckets.DIRTY_KEY, key) is None
    assert redis.zscore(metrics.metric_buckets.QUARANTINE_KEY, key) is not None
    assert redis.hget(key, "tags") == raw_tags


def test_quarantine_recovery_does_not_starve_supported_records_behind_unknowns(
    review_runtime,
):
    from crate.observability.metric_catalog import canonical_metric

    metrics, redis, clock = review_runtime
    buckets = metrics.metric_buckets
    _future_metric_buckets(redis, metrics, clock, 501)
    unknown = redis.zrange(buckets.DIRTY_KEY, 0, -1)
    pipe = redis.pipeline(transaction=False)
    for key in unknown:
        pipe.hset(key, "quarantine_recoverable", 1)
        pipe.zadd(buckets.QUARANTINE_KEY, {key: clock["minute"] - 60})
        pipe.zrem(buckets.DIRTY_KEY, key)
    pipe.expire(buckets.QUARANTINE_KEY, 7200)
    pipe.execute()
    metrics.record_counter("api.requests")
    supported = buckets.bucket_key(canonical_metric("api.requests"), clock["minute"])
    assert buckets.quarantine_snapshot(
        redis,
        supported,
        redis.hgetall(supported),
        run_id=redis.info("server")["run_id"],
        ttl=7200,
        recoverable=True,
    )
    assert redis.zcard(buckets.DIRTY_KEY) == 0

    recovered = {
        key
        for _attempt in range(4)
        for key, _row in buckets.pending_snapshots(redis, limit=500)
    }

    assert supported in recovered
    assert redis.zcard(buckets.QUARANTINE_KEY) == 502
    assert all(redis.exists(key) for key in unknown)
