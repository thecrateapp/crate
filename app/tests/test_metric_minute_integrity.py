from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from importlib import import_module
from pathlib import Path
from threading import Barrier
import time

import pytest


@pytest.fixture(scope="session")
def isolated_metric_redis_server():
    """Run real Redis/Lua on a disposable loopback-only port."""
    import docker
    import redis

    client = docker.from_env()
    try:
        client.ping()
    except docker.errors.DockerException:
        client.close()
        pytest.skip("Docker is required for real metric Redis tests")

    container = None
    connection = None
    try:
        container = client.containers.run(
            "redis:7-alpine",
            command=["redis-server", "--save", "", "--appendonly", "no"],
            detach=True,
            ports={"6379/tcp": ("127.0.0.1", None)},
            mem_limit="64m",
            labels={"crate.test": "metric-minute-integrity"},
        )
        container.reload()
        port = container.attrs["NetworkSettings"]["Ports"]["6379/tcp"][0]["HostPort"]
        connection = redis.Redis(
            host="127.0.0.1", port=int(port), socket_timeout=2, decode_responses=True
        )
        deadline = time.monotonic() + 20
        while True:
            try:
                assert connection.ping()
                break
            except redis.exceptions.ConnectionError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.05)
        yield connection
    finally:
        if connection is not None:
            connection.close()
        if container is not None:
            container.remove(force=True, v=True)
        client.close()


@pytest.fixture
def metric_runtime(monkeypatch, isolated_metric_redis_server):
    from crate import metrics

    redis = isolated_metric_redis_server
    redis.flushdb()
    minute = int(time.time()) // 60 * 60 - 3600
    clock = {"minute": minute}
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: redis)
    monkeypatch.setattr(metrics, "_minute_bucket", lambda ts=None: clock["minute"])
    yield metrics, redis, clock
    redis.flushdb()


def _historical_totals(metrics, name: str, **kwargs):
    rows = metrics.query_historical(name, period="hour", **kwargs)
    return {
        "count": sum(row["count"] for row in rows),
        "sum": sum(row["sum"] for row in rows),
    }


def test_replaying_a_minute_flush_does_not_add_observations(pg_db, metric_runtime):
    metrics, _redis, clock = metric_runtime
    for value in range(1, 11):
        metrics.record("api.requests", float(value))
    clock["minute"] += 1200

    for _attempt in range(3):
        metrics.flush_to_postgres()

    assert _historical_totals(metrics, "api.requests") == {
        "count": 10,
        "sum": 55.0,
    }


def test_current_minute_is_persisted_without_advancing_the_clock(pg_db, metric_runtime):
    metrics, redis, _clock = metric_runtime
    for _observation in range(3):
        metrics.record_counter("api.requests")

    metrics.flush_to_postgres()

    assert _historical_totals(metrics, "api.requests") == {"count": 3, "sum": 3.0}
    assert redis.zcard(metrics.metric_buckets.DIRTY_KEY) == 0


def test_regenerated_redis_bucket_preserves_known_count_and_marks_gap(
    pg_db, metric_runtime
):
    from crate.observability.metric_catalog import canonical_metric

    metrics, redis, clock = metric_runtime
    for _observation in range(10):
        metrics.record_counter("api.requests")
    key = metrics.metric_buckets.bucket_key(
        canonical_metric("api.requests"), clock["minute"]
    )
    original_source = redis.hget(key, "source_id")
    metrics.flush_to_postgres()
    assert redis.delete(key) == 1
    for _observation in range(3):
        metrics.record_counter("api.requests")
    assert redis.hget(key, "source_id") != original_source

    metrics.flush_to_postgres()

    rows = metrics.query_historical("api.requests", period="minute")
    assert len(rows) == 1
    assert (rows[0]["count"], rows[0]["sum"], rows[0]["source_gap"]) == (
        10,
        10.0,
        True,
    )


def test_restart_between_generation_and_snapshot_read_exposes_gap_before_ack(
    pg_db, metric_runtime, monkeypatch
):
    from crate.observability.metric_catalog import canonical_metric

    metrics, redis, clock = metric_runtime
    repository, queries = _minute_store()
    for _observation in range(10):
        metrics.record_counter("api.requests")
    key = metrics.metric_buckets.bucket_key(
        canonical_metric("api.requests"), clock["minute"]
    )
    source_id = redis.hget(key, "source_id")
    baseline = dict(
        _snapshot(source_id=f"old-generation:{source_id}"),
        bucket_start=datetime.fromtimestamp(clock["minute"], timezone.utc),
    )
    repository.upsert_metric_minute_snapshots([baseline])
    redis.hset(key, mapping={"revision": 9, "count": 9, "sum": 9})

    class RestartingRedis:
        def __init__(self):
            self.info_reads = 0

        def __getattr__(self, name):
            return getattr(redis, name)

        def info(self, *args, **kwargs):
            information = redis.info(*args, **kwargs)
            self.info_reads += 1
            if self.info_reads == 1:
                information["run_id"] = "old-generation"
            return information

    restarting = RestartingRedis()
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: restarting)

    metrics.flush_to_postgres()

    row = _stored_minute(queries)
    assert (row["count"], row["sum_value"], row["source_gap"]) == (10, 10.0, True)
    assert redis.zscore(metrics.metric_buckets.DIRTY_KEY, key) is None


def test_concurrent_minute_flushers_do_not_duplicate_observations(
    pg_db, metric_runtime
):
    metrics, _redis, clock = metric_runtime
    for _observation in range(10):
        metrics.record_counter("api.requests")
    clock["minute"] += 1200
    ready = Barrier(2)

    def flush():
        ready.wait(timeout=10)
        metrics.flush_to_postgres()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(flush) for _flusher in range(2)]
        for future in futures:
            future.result(timeout=20)

    assert _historical_totals(metrics, "api.requests") == {
        "count": 10,
        "sum": 10.0,
    }


def test_one_hundred_concurrent_observations_are_persisted_exactly_once(
    pg_db, metric_runtime
):
    metrics, _redis, clock = metric_runtime
    ready = Barrier(4)

    def record_batch():
        ready.wait(timeout=10)
        for _observation in range(25):
            metrics.record_counter("api.requests")

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(record_batch) for _producer in range(4)]
        for future in futures:
            future.result(timeout=20)
    clock["minute"] += 1200

    metrics.flush_to_postgres()

    assert _historical_totals(metrics, "api.requests") == {
        "count": 100,
        "sum": 100.0,
    }


def test_late_observation_replaces_flushed_ten_with_eleven(pg_db, metric_runtime):
    metrics, _redis, clock = metric_runtime
    minute = clock["minute"]
    for _observation in range(10):
        metrics.record_counter("api.requests")
    clock["minute"] = minute + 1200
    metrics.flush_to_postgres()
    assert _historical_totals(metrics, "api.requests") == {
        "count": 10,
        "sum": 10.0,
    }

    clock["minute"] = minute
    metrics.record_counter("api.requests")
    clock["minute"] = minute + 1200
    metrics.flush_to_postgres()

    assert _historical_totals(metrics, "api.requests") == {
        "count": 11,
        "sum": 11.0,
    }


def _minute_store():
    db_path = Path(__file__).resolve().parents[1] / "crate/db"
    assert (db_path / "repositories/metric_minutes.py").is_file()
    assert (db_path / "queries/metric_minutes.py").is_file()
    repository = import_module("crate.db.repositories.metric_minutes")
    queries = import_module("crate.db.queries.metric_minutes")
    return repository, queries


def _snapshot(*, revision=10, count=10, value=1.0, source_id="source-a"):
    minute = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(
        minutes=20
    )
    return {
        "name": "api.requests",
        "tags": {},
        "bucket_start": minute,
        "source_id": source_id,
        "revision": revision,
        "count": count,
        "sum_value": count * value,
        "min_value": value,
        "max_value": value,
        "last_value": value,
        "last_observed_at": minute + timedelta(seconds=30),
    }


def _stored_minute(queries):
    rows = queries.query_metric_minute_snapshots("api.requests", period="minute")
    assert len(rows) == 1
    return rows[0]


def test_empty_snapshot_batch_is_a_noop():
    repository, _queries = _minute_store()

    assert repository.upsert_metric_minute_snapshots([]) == 0


@pytest.mark.parametrize("revision", [9, 10])
def test_old_or_equal_revision_cannot_replace_absolute_snapshot(pg_db, revision):
    repository, queries = _minute_store()
    baseline = _snapshot()
    incoming = dict(
        baseline,
        revision=revision,
        count=revision,
        sum_value=revision * 2.0,
        min_value=2.0,
        max_value=2.0,
        last_value=2.0,
    )
    repository.upsert_metric_minute_snapshots([baseline])

    repository.upsert_metric_minute_snapshots([incoming])

    row = _stored_minute(queries)
    assert (row["count"], row["sum_value"]) == (10, 10.0)
    assert row["source_gap"] is False


def test_stale_revision_can_mark_source_gap_without_replacing_values(pg_db):
    from sqlalchemy import select

    from crate.db.orm.metrics import MetricMinuteSnapshot
    from crate.db.tx import read_scope

    repository, queries = _minute_store()
    baseline = _snapshot()
    stale = dict(
        baseline,
        revision=9,
        count=9,
        sum_value=18.0,
        min_value=2.0,
        max_value=2.0,
        last_value=2.0,
        source_gap=True,
    )
    repository.upsert_metric_minute_snapshots([baseline])

    repository.upsert_metric_minute_snapshots([stale])

    row = _stored_minute(queries)
    with read_scope() as session:
        revision = session.execute(select(MetricMinuteSnapshot.revision)).scalar_one()
    assert (row["count"], row["sum_value"], revision, row["source_gap"]) == (
        10,
        10.0,
        10,
        True,
    )


def test_stale_snapshot_in_same_batch_preserves_values_and_propagates_gap(pg_db):
    repository, queries = _minute_store()
    baseline = _snapshot()
    stale = dict(baseline, revision=9, count=9, sum_value=18.0, source_gap=True)

    repository.upsert_metric_minute_snapshots([baseline, stale])

    row = _stored_minute(queries)
    assert (row["count"], row["sum_value"], row["source_gap"]) == (10, 10.0, True)


def test_history_aggregates_dimensions_before_limit_with_weighted_average(pg_db):
    from crate import metrics

    repository, _queries = _minute_store()
    baseline = dict(
        _snapshot(revision=3, count=3),
        name="worker.queue.wait",
        tags={"queue": "default"},
    )
    other_queue = dict(
        baseline,
        tags={"queue": "playback"},
        revision=1,
        count=1,
        sum_value=9.0,
        min_value=9.0,
        max_value=9.0,
        last_value=9.0,
    )
    older = dict(
        baseline,
        bucket_start=baseline["bucket_start"] - timedelta(minutes=1),
        last_observed_at=baseline["last_observed_at"] - timedelta(minutes=1),
        count=100,
        sum_value=5000.0,
        min_value=50.0,
        max_value=50.0,
        last_value=50.0,
    )
    repository.upsert_metric_minute_snapshots([baseline, other_queue, older])

    rows = metrics.query_historical(
        "worker.queue.wait",
        period="minute",
        start=(baseline["bucket_start"] - timedelta(minutes=1)).isoformat(),
        end=baseline["bucket_start"].isoformat(),
        limit=1,
    )

    assert len(rows) == 1
    assert rows[0] == {
        "timestamp": baseline["bucket_start"].isoformat(),
        "count": 4,
        "sum": 12.0,
        "avg": 3.0,
        "min": 1.0,
        "max": 9.0,
        "source_gap": False,
        "observed_at": baseline["last_observed_at"].isoformat(),
    }


def test_newer_revision_replaces_instead_of_adding_absolute_snapshot(pg_db):
    repository, queries = _minute_store()
    baseline = _snapshot()
    newer = dict(baseline, revision=11, count=11, sum_value=11.0)
    repository.upsert_metric_minute_snapshots([baseline])

    repository.upsert_metric_minute_snapshots([newer])

    row = _stored_minute(queries)
    assert (row["count"], row["sum_value"]) == (11, 11.0)


def test_concurrent_repository_writers_keep_one_absolute_minute(pg_db):
    repository, queries = _minute_store()
    snapshot = _snapshot()
    ready = Barrier(2)

    def write():
        ready.wait(timeout=10)
        repository.upsert_metric_minute_snapshots([dict(snapshot)])

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(write) for _writer in range(2)]
        for future in futures:
            future.result(timeout=20)

    row = _stored_minute(queries)
    assert (row["count"], row["sum_value"]) == (10, 10.0)


def test_source_reset_preserves_known_snapshot_and_exposes_gap(pg_db):
    repository, queries = _minute_store()
    baseline = _snapshot()
    other_source = dict(
        baseline, source_id="source-b", revision=100, count=100, sum_value=100.0
    )
    repository.upsert_metric_minute_snapshots([baseline])

    repository.upsert_metric_minute_snapshots([other_source])

    row = _stored_minute(queries)
    assert (row["count"], row["sum_value"]) == (10, 10.0)
    assert row["source_gap"] is True


def test_source_gap_stays_visible_after_a_late_original_source_update(pg_db):
    repository, queries = _minute_store()
    baseline = _snapshot()
    repository.upsert_metric_minute_snapshots([baseline])
    repository.upsert_metric_minute_snapshots(
        [dict(baseline, source_id="source-b", revision=100, count=100, sum_value=100.0)]
    )

    repository.upsert_metric_minute_snapshots(
        [dict(baseline, revision=11, count=11, sum_value=11.0)]
    )

    row = _stored_minute(queries)
    assert (row["count"], row["sum_value"]) == (11, 11.0)
    assert row["source_gap"] is True


@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("revision", 0),
        ("revision", -1),
        ("sum_value", float("nan")),
        ("min_value", float("nan")),
        ("max_value", float("nan")),
        ("last_value", float("nan")),
    ],
)
def test_invalid_snapshot_batch_leaves_no_valid_prefix(pg_db, field, invalid):
    repository, queries = _minute_store()
    valid = _snapshot()
    invalid_snapshot = dict(
        valid, bucket_start=valid["bucket_start"] - timedelta(minutes=1)
    )
    invalid_snapshot[field] = invalid

    with pytest.raises(ValueError):
        repository.upsert_metric_minute_snapshots([valid, invalid_snapshot])

    assert queries.query_metric_minute_snapshots("api.requests", period="minute") == []


def test_retention_deletes_only_a_bounded_batch_before_cutoff(pg_db):
    repository, queries = _minute_store()
    recent = _snapshot()
    cutoff = recent["bucket_start"] - timedelta(minutes=30)
    snapshots = [recent]
    for offset in range(3):
        minute = cutoff - timedelta(minutes=offset + 1)
        snapshots.append(
            dict(
                recent,
                bucket_start=minute,
                last_observed_at=minute + timedelta(seconds=30),
            )
        )
    repository.upsert_metric_minute_snapshots(snapshots)

    assert repository.delete_metric_minute_snapshots_before(cutoff, limit=2) == 2
    assert repository.delete_metric_minute_snapshots_before(cutoff, limit=2) == 1
    assert repository.delete_metric_minute_snapshots_before(cutoff, limit=2) == 0
    assert _stored_minute(queries)["bucket_start"] == recent["bucket_start"]
