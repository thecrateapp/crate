from __future__ import annotations

import pytest

from tests.test_metric_availability import available_runtime as available_runtime
from tests.test_metric_minute_integrity import (
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


@pytest.mark.parametrize("slow_count", [0, 1])
def test_slow_summary_uses_the_same_classified_request_population(
    available_runtime, slow_count
):
    from crate.api.admin_metrics import _SUMMARY_METRICS

    metrics, _redis, _clock = available_runtime
    metrics.record_counter("api.requests", {"latency_class": "fast", "status": "200"})
    if slow_count:
        metrics.record_counter(
            "api.requests", {"latency_class": "slow", "status": "200"}
        )

    summary = metrics.query_summaries({"slow": _SUMMARY_METRICS["api_slow"]})["slow"]

    assert summary["availability"] == "available"
    assert summary["count"] == slow_count
    assert summary["eligible_count"] == 1 + slow_count


def test_older_request_producers_do_not_certify_zero_slow_requests(available_runtime):
    from crate.api.admin_metrics import _SUMMARY_METRICS

    metrics, _redis, _clock = available_runtime
    metrics.record_counter("api.requests", {"status": "200"})
    summary = metrics.query_summaries({"slow": _SUMMARY_METRICS["api_slow"]})["slow"]
    assert summary["availability"] == "partial"


@pytest.mark.parametrize("minutes", [60, 120])
def test_long_summary_windows_keep_valid_older_observations(available_runtime, minutes):
    metrics, _redis, clock = available_runtime
    metrics.record_counter("api.requests")
    clock["minute"] += 600
    clock["now"] += 600
    summary = metrics.query_summary("api.requests", minutes=minutes)
    assert summary["availability"] == "available"
    assert summary["count"] == 1
    assert summary["age_seconds"] == 600


def test_shared_buffer_loss_is_visible_to_readers_in_another_process(
    available_runtime, monkeypatch
):
    from crate.observability import metric_buckets

    metrics, _redis, clock = available_runtime
    monkeypatch.setattr(metric_buckets, "MAX_BUFFER_BUCKETS", 1)
    metrics.record_counter("api.requests")
    clock["minute"] += 60
    clock["now"] += 60
    metrics.record_counter("api.requests")
    monkeypatch.setattr(metrics, "_last_error_at", None)
    monkeypatch.setattr(metrics, "_last_error_reason", None)

    summary = metrics.query_summary("api.requests", minutes=5)
    assert summary["availability"] == "partial"
    assert summary["reason"] == "collection_loss"


@pytest.mark.parametrize(("elapsed", "expected"), [(10.0, "fast"), (1000.0, "slow")])
def test_middleware_classifies_each_request_for_slow_population(
    monkeypatch, elapsed, expected
):
    from crate.api import metrics_middleware

    records = []
    monkeypatch.setattr(
        metrics_middleware, "record_later", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        metrics_middleware, "record_route_latency_later", lambda **_kwargs: None
    )
    monkeypatch.setattr(
        metrics_middleware,
        "record_counter_later",
        lambda name, tags: records.append((name, tags)),
    )
    middleware = metrics_middleware.MetricsMiddleware(None)
    middleware._record(
        {"method": "GET"},
        "/api/artists",
        200,
        elapsed,
        [(b"content-type", b"application/json")],
    )
    count = next(tags for name, tags in records if name == "api.request.count")
    assert count["latency_class"] == expected


def test_downgrade_removes_only_v2_coverage_settings(monkeypatch):
    from importlib import import_module

    migration = import_module(
        "crate.db.migrations.versions.141_metric_minute_snapshots"
    )
    statements = []
    from types import SimpleNamespace

    monkeypatch.setattr(migration, "op", SimpleNamespace(execute=statements.append))
    migration.downgrade()
    cleanup = next(
        statement for statement in statements if "DELETE FROM settings" in statement
    )
    assert "metrics_v2_cutover_at" in cleanup
    assert "metrics_v2_collection_state" in cleanup


def test_metric_history_dto_keeps_shared_flush_and_gap_evidence():
    from crate.api.schemas.metrics import MetricHistoryStatus

    collection = {
        "pending_buckets": 42,
        "oldest_pending_at": 1790000000,
        "gaps": [["2026-11-01T00:00:00+00:00", "2026-11-01T00:01:00+00:00"]],
    }
    value = MetricHistoryStatus.model_validate(
        {
            "source": "postgresql_v2",
            "availability": "partial",
            "cutover_at": None,
            "legacy_status": "unverified",
            "legacy_combined": False,
            "collection": collection,
        }
    ).model_dump()
    assert value["collection"] == collection


def test_retention_reports_remaining_expired_history_without_counting_it(pg_db):
    from datetime import datetime, timedelta, timezone
    from crate.db.repositories import metric_minutes as repository
    from crate.db.queries.metric_minutes import get_metric_history_status
    from tests.test_metric_minute_integrity import _snapshot

    cutoff = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(
        days=8
    )
    repository.upsert_metric_minute_snapshots(
        [
            {**_snapshot(), "bucket_start": cutoff - timedelta(minutes=minute)}
            for minute in range(1, 4)
        ]
    )
    assert repository.delete_metric_minute_snapshots_before(cutoff, limit=2) == 2
    pending = get_metric_history_status()["retention"]
    assert pending["backlog"] is True
    assert pending["deleted"] == 2
    assert pending["oldest_pending_at"] is not None
    assert repository.delete_metric_minute_snapshots_before(cutoff, limit=2) == 1
    cleared = get_metric_history_status()["retention"]
    assert cleared["backlog"] is False
    assert cleared["oldest_pending_at"] is None


@pytest.mark.parametrize("explicit_bounds", [False, True])
def test_single_timeseries_endpoint_keeps_v2_provenance(
    test_app, monkeypatch, explicit_bounds
):
    from crate import metrics

    calls = []
    state = {
        "source": "postgresql_v2",
        "availability": "partial",
        "reason": "source_gap",
    }

    def snapshot(names, period="minute", minutes=60, **kwargs):
        calls.append((names, period, minutes, kwargs))
        return {"data": {names[0]: []}, "status": {names[0]: state}}

    monkeypatch.setattr(metrics, "query_timeseries_snapshot", snapshot)
    params = {"name": "api.latency", "period": "hour", "minutes": 60}
    if explicit_bounds:
        params.update(
            start="2026-10-31T12:00:00+00:00", end="2026-10-31T13:00:00+00:00"
        )
    response = test_app.get("/api/admin/metrics/timeseries", params=params)
    assert response.status_code == 200
    assert response.json()["status"] == state
    assert calls[0][0] == ["api.request.latency"]
    assert calls[0][3]["persisted"] is True
    if explicit_bounds:
        assert calls[0][3]["start"] == params["start"]
        assert calls[0][3]["end"] == params["end"]


def test_family_cardinality_loss_is_shared_with_other_readers(
    available_runtime, monkeypatch
):
    from dataclasses import replace
    from crate.observability import metric_catalog

    metrics, _redis, _clock = available_runtime
    definition = metric_catalog.get_metric_definition("api.request.count")
    monkeypatch.setattr(
        metric_catalog,
        "METRIC_CATALOG",
        {
            **metric_catalog.METRIC_CATALOG,
            "api.request.count": replace(definition, max_series=1),
        },
    )
    metrics.record_counter("api.requests", {"method": "GET"})
    metrics.record_counter("api.requests", {"method": "POST"})
    monkeypatch.setattr(metrics, "_last_error_at", None)
    summary = metrics.query_summary("api.requests")
    assert summary["availability"] == "partial"
    assert summary["reason"] == "collection_loss"


def test_explicit_persisted_window_preserves_utc_boundaries(pg_db, available_runtime):
    from datetime import datetime, timedelta, timezone
    from crate.db.repositories.metric_minutes import upsert_metric_minute_snapshots
    from tests.test_metric_minute_integrity import _snapshot

    metrics, _redis, clock = available_runtime
    end = datetime.fromtimestamp(clock["minute"], timezone.utc)
    upsert_metric_minute_snapshots(
        [
            {**_snapshot(), "bucket_start": end - timedelta(minutes=3)},
            {
                **_snapshot(),
                "bucket_start": end - timedelta(minutes=1),
                "last_observed_at": end,
            },
        ]
    )
    result = metrics.query_timeseries_snapshot(
        ["api.requests"],
        persisted=True,
        start=(end - timedelta(minutes=1)).isoformat(),
        end=end.isoformat(),
    )
    assert len(result["data"]["api.request.count"]) == 1
    assert result["status"]["api.request.count"]["window_minutes"] == 2
    assert result["status"]["api.request.count"]["source"] == "postgresql_v2"


@pytest.mark.parametrize("end_only", [False, True])
def test_daily_timeseries_default_keeps_the_eight_day_historical_window(
    test_app, monkeypatch, end_only
):
    from datetime import datetime, timedelta, timezone
    from crate import metrics

    calls = []

    def snapshot(names, **kwargs):
        calls.append(kwargs)
        return {
            "data": {names[0]: []},
            "status": {names[0]: {"source": "postgresql_v2", "availability": "empty"}},
        }

    monkeypatch.setattr(metrics, "query_timeseries_snapshot", snapshot)
    params = {"name": "api.latency", "period": "day"}
    if end_only:
        params["end"] = datetime.now(timezone.utc).isoformat()
    response = test_app.get("/api/admin/metrics/timeseries", params=params)
    assert response.status_code == 200
    assert datetime.fromisoformat(calls[0]["start"]) <= datetime.now(
        timezone.utc
    ) - timedelta(days=7)


def test_quarantine_preserves_the_indexed_minute_when_payload_is_corrupt(
    available_runtime,
):
    from crate.observability import metric_buckets

    _metrics, redis, clock = available_runtime
    key = f"{metric_buckets.PREFIX}:bucket:corrupt:{clock['minute']}"
    row = {"source_id": "corrupt", "revision": "1", "minute": "bad"}
    redis.hset(key, mapping=row)
    redis.zadd(metric_buckets.DIRTY_KEY, {key: clock["minute"]})
    assert metric_buckets.quarantine_snapshot(
        redis,
        key,
        row,
        run_id=redis.info("server")["run_id"],
        ttl=7200,
        recoverable=False,
    )
    assert redis.zscore(metric_buckets.QUARANTINE_KEY, key) == clock["minute"]


def test_batched_history_transfers_collection_metadata_only_once(
    pg_db, available_runtime
):
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace
    from crate.db.queries.metric_minutes import query_metric_minute_series_snapshot
    from crate.db.repositories.metric_minutes import (
        persist_metric_collection,
        upsert_metric_minute_snapshots,
    )
    from crate.db.tx import read_scope
    from tests.test_metric_minute_integrity import _snapshot

    _metrics, _redis, clock = available_runtime
    now = datetime.fromtimestamp(clock["minute"], timezone.utc)
    upsert_metric_minute_snapshots(
        [
            {**_snapshot(), "bucket_start": now - timedelta(minutes=index)}
            for index in range(10)
        ]
    )
    persist_metric_collection([], source_id="metadata", checked_at=now)
    transferred = []
    with read_scope() as session:

        class RecordingSession:
            def execute(self, *args, **kwargs):
                rows = list(session.execute(*args, **kwargs).mappings())
                transferred.extend(
                    row["collection_state"] for row in rows if row["collection_state"]
                )
                return SimpleNamespace(mappings=lambda: rows)

        result = query_metric_minute_series_snapshot(
            ["api.requests"], period="minute", session=RecordingSession()
        )
    assert len(result["series"]["api.request.count"]) == 10
    assert len(transferred) == 1
