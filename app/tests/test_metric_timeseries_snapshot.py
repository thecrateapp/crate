from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from tests.test_metric_availability import available_runtime as available_runtime
from tests.test_metric_minute_integrity import (
    _snapshot,
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


def _snapshot_at(
    bucket, *, name="api.requests", tags=None, count=1, value=1.0, source_gap=False
):
    return dict(
        _snapshot(),
        name=name,
        tags=tags or {},
        bucket_start=bucket,
        count=count,
        revision=count,
        sum_value=count * value,
        min_value=value,
        max_value=value,
        last_value=value,
        last_observed_at=bucket + timedelta(seconds=30),
        source_gap=source_gap,
    )


def _no_per_metric_read(*_args, **_kwargs):
    pytest.fail("A timeseries snapshot must batch its reads across all metric families")


def test_minute_snapshot_batches_all_canonical_families_in_one_real_redis_read(
    available_runtime, monkeypatch
):
    from crate.observability import metric_buckets

    metrics, redis, clock = available_runtime
    metrics.record_counter("api.requests")
    metrics.record_counter("api.requests")
    metrics.record("worker.queue.wait", 4.0)
    calls = []
    original_read = metric_buckets.read_buckets

    def read_once(*args, **kwargs):
        calls.append((args, kwargs))
        return original_read(*args, **kwargs)

    monkeypatch.setattr(metric_buckets, "read_buckets", read_once)
    monkeypatch.setattr(metrics, "query_recent", _no_per_metric_read)
    monkeypatch.setattr(metrics, "query_recent_rolled", _no_per_metric_read)

    result = metrics.query_timeseries_snapshot(
        ["api.requests", "worker.queue.wait", "api.request.count"],
        period="minute",
        minutes=60,
    )

    assert len(calls) == 1
    assert calls[0][0][0] is redis
    assert set(result["data"]) == {"api.request.count", "worker.queue.wait"}
    assert result["data"]["api.request.count"] == [
        {
            "timestamp": datetime.fromtimestamp(
                clock["minute"], timezone.utc
            ).isoformat(),
            "count": 2,
            "sum": 2.0,
            "avg": 1.0,
            "min": 1.0,
            "max": 1.0,
            "source_gap": False,
            "observed_at": datetime.fromtimestamp(
                clock["now"], timezone.utc
            ).isoformat(),
        }
    ]
    for status in result["status"].values():
        assert status["availability"] == "available"
        assert status["source"] == "redis_v2"
        assert status["window_minutes"] == 60
        assert status["age_seconds"] == 0.0


def test_persisted_minute_snapshot_batches_postgresql_without_redis_io(
    pg_db, available_runtime, monkeypatch
):
    from crate.db.queries import metric_minutes
    from crate.db.repositories.metric_minutes import upsert_metric_minute_snapshots

    metrics, _redis, clock = available_runtime
    end = datetime.fromtimestamp(clock["minute"], timezone.utc)
    upsert_metric_minute_snapshots(
        [
            _snapshot_at(
                end - timedelta(minutes=59),
                name="worker.queue.wait",
                tags={"queue": "default"},
                value=2.0,
            ),
            _snapshot_at(
                end - timedelta(minutes=1),
                name="worker.queue.wait",
                tags={"queue": "default"},
                value=2.0,
            ),
            _snapshot_at(
                end, name="worker.queue.wait", tags={"queue": "default"}, count=3
            ),
            _snapshot_at(
                end, name="worker.queue.wait", tags={"queue": "playback"}, value=9.0
            ),
            _snapshot_at(end, count=2),
        ]
    )
    calls = []
    original_query = metric_minutes.query_metric_minute_series_snapshot

    def batch_query(*args, **kwargs):
        calls.append((args, kwargs))
        return original_query(*args, **kwargs)

    monkeypatch.setattr(
        metric_minutes, "query_metric_minute_series_snapshot", batch_query
    )
    monkeypatch.setattr(
        metric_minutes,
        "_now",
        lambda: datetime.fromtimestamp(clock["now"], timezone.utc),
    )
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", _no_per_metric_read)

    result = metrics.query_timeseries_snapshot(
        ["api.requests", "worker.queue.wait"],
        period="minute",
        minutes=60,
        persisted=True,
    )

    assert len(calls) == 1
    assert calls[0][1]["period"] == "minute"
    assert calls[0][1]["start"] == end - timedelta(minutes=59)
    assert calls[0][1]["end"] == end
    queue = result["data"]["worker.queue.wait"]
    assert len(queue) == 3
    assert sum(point["count"] for point in queue) == 6
    current = next(point for point in queue if point["timestamp"] == end.isoformat())
    assert (current["count"], current["sum"], current["avg"]) == (4, 12.0, 3.0)
    assert result["data"]["api.request.count"][0]["count"] == 2
    for status in result["status"].values():
        assert status["source"] == "postgresql_v2"
        assert status["availability"] == "available"
        assert status["window_minutes"] == 60


@pytest.mark.parametrize(("period", "minutes"), [("hour", 1440), ("day", 10080)])
def test_coarse_snapshot_batches_postgresql_with_exact_window_and_source_gap(
    pg_db, available_runtime, monkeypatch, period, minutes
):
    from crate.db.queries import metric_minutes
    from crate.db.repositories.metric_minutes import upsert_metric_minute_snapshots

    metrics, _redis, clock = available_runtime
    end = datetime.fromtimestamp(clock["minute"], timezone.utc)
    start = end - timedelta(minutes=minutes - 1)
    upsert_metric_minute_snapshots(
        [
            _snapshot_at(start - timedelta(minutes=1), count=100),
            _snapshot_at(start, count=2, source_gap=True),
            _snapshot_at(end, count=3),
            _snapshot_at(end, name="worker.queue.wait", value=4.0),
        ]
    )
    calls = []
    original_query = metric_minutes.query_metric_minute_series_snapshot

    def batch_query(*args, **kwargs):
        calls.append((args, kwargs))
        return original_query(*args, **kwargs)

    monkeypatch.setattr(
        metric_minutes, "query_metric_minute_series_snapshot", batch_query
    )
    monkeypatch.setattr(
        metric_minutes,
        "_now",
        lambda: datetime.fromtimestamp(clock["now"], timezone.utc),
    )
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", _no_per_metric_read)
    monkeypatch.setattr(metrics, "query_recent", _no_per_metric_read)
    monkeypatch.setattr(metrics, "query_recent_rolled", _no_per_metric_read)

    result = metrics.query_timeseries_snapshot(
        ["api.requests", "worker.queue.wait"], period=period, minutes=minutes
    )

    assert len(calls) == 1
    assert calls[0][1]["start"] == start
    assert calls[0][1]["end"] == end
    rows = result["data"]["api.request.count"]
    assert sum(row["count"] for row in rows) == 5
    assert sum(row["sum"] for row in rows) == 5.0
    assert any(row["source_gap"] for row in rows)
    assert all("observed_at" in row for row in rows)
    status = result["status"]["api.request.count"]
    assert status["availability"] == "partial"
    assert status["source"] == "postgresql_v2"
    assert status["window_minutes"] == minutes
    assert status["reason"]
    assert result["status"]["worker.queue.wait"]["availability"] == "available"


def test_postgresql_failure_returns_unavailable_status_with_no_false_empty_series(
    available_runtime, monkeypatch
):
    from crate.db.queries import metric_minutes

    metrics, _redis, _clock = available_runtime

    def failed_postgresql(*_args, **_kwargs):
        raise RuntimeError("Injected PostgreSQL timeseries failure")

    monkeypatch.setattr(
        metric_minutes, "query_metric_minute_series_snapshot", failed_postgresql
    )

    result = metrics.query_timeseries_snapshot(
        ["api.requests"], period="hour", minutes=1440
    )

    assert result["data"] == {"api.request.count": []}
    status = result["status"]["api.request.count"]
    assert status["availability"] == "unavailable"
    assert status["source"] == "postgresql_v2"
    assert status["reason"]
    assert "empty" not in status["reason"].lower()
