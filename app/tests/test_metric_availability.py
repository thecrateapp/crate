from __future__ import annotations

from datetime import datetime, timedelta, timezone
import time
from types import SimpleNamespace

import pytest

from tests.test_metric_minute_integrity import (
    _minute_store,
    _snapshot,
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


@pytest.fixture
def available_runtime(monkeypatch, metric_runtime):
    metrics, redis, clock = metric_runtime
    clock["minute"] = int(time.time()) // 60 * 60
    clock["now"] = clock["minute"] + 30.0
    monkeypatch.setattr(
        metrics,
        "time",
        SimpleNamespace(time=lambda: clock["now"], monotonic=time.monotonic),
    )
    return metrics, redis, clock


def _assert_metadata(summary, *, availability, sample_count, eligible_count):
    assert summary["availability"] == availability
    assert "reason" in summary
    assert summary["source"] == "redis_v2"
    assert summary["window_minutes"] == 5
    assert summary["sample_kind"] == "observations"
    assert summary["sample_count"] == sample_count
    assert summary["eligible_count"] == eligible_count
    assert "observed_at" in summary
    assert "age_seconds" in summary


@pytest.mark.parametrize("failure", ["missing", "connection_error"])
def test_missing_or_failed_redis_is_unavailable_instead_of_healthy_zero(
    available_runtime, monkeypatch, failure
):
    from redis.exceptions import ConnectionError

    metrics, redis, _clock = available_runtime
    if failure == "missing":
        monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: None)
    else:

        def broken_pipeline(*_args, **_kwargs):
            raise ConnectionError("Injected unavailable Redis")

        monkeypatch.setattr(redis, "pipeline", broken_pipeline)

    summaries = metrics.query_summaries(
        {"latency": ("api.request.latency", 5), "requests": ("api.request.count", 5)}
    )

    for summary in summaries.values():
        _assert_metadata(
            summary, availability="unavailable", sample_count=0, eligible_count=0
        )
        assert summary["reason"]
        assert summary["observed_at"] is None
        assert summary["age_seconds"] is None


def test_reachable_but_empty_redis_is_explicitly_empty(available_runtime):
    metrics, _redis, _clock = available_runtime

    summary = metrics.query_summary("api.request.latency", minutes=5)

    _assert_metadata(summary, availability="empty", sample_count=0, eligible_count=0)
    assert summary["reason"]
    assert summary["observed_at"] is None
    assert summary["age_seconds"] is None


def test_fresh_summary_keeps_numbers_and_reports_observation_freshness(
    available_runtime,
):
    metrics, _redis, clock = available_runtime
    metrics.record("api.request.latency", 10.0)
    metrics.record("api.request.latency", 30.0)

    summary = metrics.query_summary("api.request.latency", minutes=5)

    assert {key: summary[key] for key in ("count", "sum", "avg", "min", "max")} == {
        "count": 2,
        "sum": 40.0,
        "avg": 20.0,
        "min": 10.0,
        "max": 30.0,
    }
    _assert_metadata(
        summary, availability="available", sample_count=2, eligible_count=2
    )
    assert datetime.fromisoformat(summary["observed_at"]).timestamp() == clock["now"]
    assert summary["age_seconds"] == pytest.approx(0.0)


def test_empty_window_with_an_older_observation_is_stale(available_runtime):
    metrics, _redis, clock = available_runtime
    metrics.record("api.request.latency", 25.0)
    observed_at = clock["now"]
    clock["minute"] += 600
    clock["now"] += 600

    summary = metrics.query_summary("api.request.latency", minutes=5)

    assert summary["availability"] == "stale"
    assert summary["source"] == "redis_v2"
    assert datetime.fromisoformat(summary["observed_at"]).timestamp() == observed_at
    assert summary["age_seconds"] == pytest.approx(600.0)
    assert summary["reason"]


def test_zero_matching_errors_is_available_when_requests_are_classified(
    available_runtime,
):
    metrics, _redis, _clock = available_runtime
    for _request in range(2):
        metrics.record_counter("api.request.count", {"status": "200"})

    summary = metrics.query_summaries(
        {"errors": ("api.request.count", 5, {"status_class": "5xx"})}
    )["errors"]

    _assert_metadata(
        summary, availability="available", sample_count=0, eligible_count=2
    )
    assert summary["count"] == 0
    assert summary["sum"] == 0.0
    assert summary["observed_at"] is not None


@pytest.mark.parametrize("classified_count", [0, 1])
def test_unclassified_requests_prevent_inference_of_zero_errors(
    available_runtime, classified_count
):
    metrics, _redis, _clock = available_runtime
    metrics.record_counter("api.request.count")
    for _request in range(classified_count):
        metrics.record_counter("api.request.count", {"status": "200"})

    summary = metrics.query_summaries(
        {"errors": ("api.request.count", 5, {"status_class": "5xx"})}
    )["errors"]

    _assert_metadata(
        summary,
        availability="partial",
        sample_count=0,
        eligible_count=classified_count,
    )
    assert summary["reason"]


def test_filtered_errors_report_observed_denominator_without_sparse_counter(
    available_runtime,
):
    metrics, _redis, _clock = available_runtime
    for status in ("200", "200", "503"):
        metrics.record_counter("api.request.count", {"status": status})

    summaries = metrics.query_summaries(
        {
            "requests": ("api.request.count", 5),
            "errors": ("api.request.count", 5, {"status_class": "5xx"}),
        }
    )

    assert summaries["requests"]["count"] == 3
    _assert_metadata(
        summaries["errors"], availability="available", sample_count=1, eligible_count=3
    )
    assert summaries["errors"]["count"] == 1
    assert summaries["errors"]["sum"] == 1.0


def test_history_cutover_is_empty_until_first_successful_minute(pg_db):
    repository, queries = _minute_store()

    assert repository.upsert_metric_minute_snapshots([]) == 0
    status = queries.get_metric_history_status()

    assert status == {
        "availability": "empty",
        "source": "postgresql_v2",
        "cutover_at": None,
        "legacy_status": "unverified",
        "legacy_combined": False,
        "retention_days": 8,
        "collection": {},
        "retention": {},
    }


def test_history_cutover_is_written_once_and_survives_minute_deletion(pg_db):
    from crate.db.repositories.settings import get_setting

    repository, queries = _minute_store()
    first = _snapshot()
    repository.upsert_metric_minute_snapshots([first])
    initial = queries.get_metric_history_status()
    assert initial["availability"] == "available"
    cutover = initial["cutover_at"]
    assert datetime.fromisoformat(cutover).tzinfo is not None
    assert get_setting("metrics_v2_cutover_at") == cutover

    later = dict(
        first,
        bucket_start=first["bucket_start"] + timedelta(minutes=1),
        last_observed_at=first["last_observed_at"] + timedelta(minutes=1),
    )
    repository.upsert_metric_minute_snapshots([later])
    deleted = repository.delete_metric_minute_snapshots_before(
        datetime.now(timezone.utc) + timedelta(days=1)
    )

    assert deleted == 2
    final = queries.get_metric_history_status()
    assert {key: value for key, value in final.items() if key != "retention"} == {
        key: value for key, value in initial.items() if key != "retention"
    }
    assert final["retention"]["deleted"] == 2
    assert get_setting("metrics_v2_cutover_at") == cutover


def test_history_cutover_rolls_back_with_the_first_minute(pg_db):
    from crate.db.repositories.settings import get_setting
    from crate.db.tx import transaction_scope

    repository, queries = _minute_store()
    with pytest.raises(RuntimeError, match="Abort minute transaction"):
        with transaction_scope() as session:
            repository.upsert_metric_minute_snapshots([_snapshot()], session=session)
            assert get_setting("metrics_v2_cutover_at", session=session) is not None
            raise RuntimeError("Abort minute transaction")

    assert get_setting("metrics_v2_cutover_at") is None
    assert queries.query_metric_minute_snapshots("api.requests", period="minute") == []
    assert queries.get_metric_history_status()["availability"] == "empty"
