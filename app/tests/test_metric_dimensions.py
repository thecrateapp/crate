from __future__ import annotations

import pytest

from tests.test_metric_minute_integrity import (
    _historical_totals,
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


def _metric_hashes(metrics, redis):
    return [
        redis.hgetall(key)
        for key in redis.scan_iter(match=f"{metrics._REDIS_PREFIX}:*")
        if redis.type(key) == "hash" and redis.hexists(key, "count")
    ]


@pytest.mark.parametrize(
    ("name", "dimension", "left", "right"),
    [
        ("playback.startup.ms", "runtime", "desktop_web", "android_native"),
        ("worker.queue.wait", "queue", "default", "playback"),
    ],
)
def test_dimensions_keep_distinct_minute_series_after_flush(
    pg_db, metric_runtime, name, dimension, left, right
):
    metrics, redis, clock = metric_runtime
    for _observation in range(3):
        metrics.record(name, 10.0, {dimension: left})
    for _observation in range(2):
        metrics.record(name, 20.0, {dimension: right})

    hashes = _metric_hashes(metrics, redis)
    assert sorted(int(row["count"]) for row in hashes) == [2, 3]

    clock["minute"] += 1200
    metrics.flush_to_postgres()

    assert _historical_totals(metrics, name, tags={dimension: left}) == {
        "count": 3,
        "sum": 30.0,
    }
    assert _historical_totals(metrics, name, tags={dimension: right}) == {
        "count": 2,
        "sum": 40.0,
    }
    assert _historical_totals(metrics, name) == {"count": 5, "sum": 70.0}


def test_tag_order_does_not_create_another_series(metric_runtime):
    metrics, redis, _clock = metric_runtime
    metrics.record(
        "playback.startup.ms",
        10.0,
        {"runtime": "desktop_web", "engine": "gapless"},
    )
    metrics.record(
        "playback.startup.ms",
        20.0,
        {"engine": "gapless", "runtime": "desktop_web"},
    )

    assert [int(row["count"]) for row in _metric_hashes(metrics, redis)] == [2]


def test_free_form_labels_are_not_persisted_in_metric_identity(metric_runtime):
    metrics, redis, _clock = metric_runtime
    forbidden_value = "/private/music/do-not-persist-as-a-metric-label.flac"
    metrics.record(
        "playback.startup.ms",
        10.0,
        {"runtime": "desktop_web", "filepath": forbidden_value},
    )
    metrics.record(
        "playback.startup.ms",
        20.0,
        {"runtime": "desktop_web", "filepath": forbidden_value + ".another"},
    )

    hashes = _metric_hashes(metrics, redis)
    assert len(hashes) <= 1
    if hashes:
        assert int(hashes[0]["count"]) == 2

    values = []
    for key in redis.scan_iter(match=f"{metrics._REDIS_PREFIX}:*"):
        values.append(key)
        if redis.type(key) == "hash":
            values.extend(redis.hgetall(key).values())
        elif redis.type(key) == "string":
            values.append(redis.get(key))
    assert forbidden_value not in "\n".join(values)


def test_unknown_runtime_does_not_create_a_free_form_dimension(metric_runtime):
    metrics, redis, _clock = metric_runtime
    unknown_runtime = "arbitrary-client-runtime-do-not-index"
    metrics.record("playback.startup.ms", 10.0, {"runtime": unknown_runtime})
    metrics.record(
        "playback.startup.ms", 20.0, {"runtime": unknown_runtime + "-another"}
    )

    hashes = _metric_hashes(metrics, redis)
    assert len(hashes) <= 1
    if hashes:
        assert int(hashes[0]["count"]) == 2

    values = []
    for key in redis.scan_iter(match=f"{metrics._REDIS_PREFIX}:*"):
        values.append(key)
        if redis.type(key) == "hash":
            values.extend(redis.hgetall(key).values())
        elif redis.type(key) == "string":
            values.append(redis.get(key))
    assert unknown_runtime not in "\n".join(values)
