from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import json

import pytest

from tests.test_metric_health_evaluation import _summary
from tests.test_metric_minute_integrity import (
    isolated_metric_redis_server as isolated_metric_redis_server,
    metric_runtime as metric_runtime,
)


@pytest.mark.parametrize(
    ("path", "model_name"),
    [
        ("/api/admin/metrics/summary", "MetricsSummaryResponse"),
        ("/api/admin/metrics/dashboard", "MetricsDashboardResponse"),
        ("/api/admin/metrics/routes", "MetricsRoutesResponse"),
    ],
)
def test_changed_metric_routes_have_referenced_json_response_models(path, model_name):
    from fastapi import FastAPI

    from crate.api.admin_metrics import router

    application = FastAPI()
    application.include_router(router)

    schema = application.openapi()

    response_schema = schema["paths"][path]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    assert response_schema["$ref"] == f"#/components/schemas/{model_name}"


@pytest.fixture
def summary_sources(monkeypatch):
    from crate import metrics
    from crate.api import admin_metrics
    from crate.db.queries import metric_minutes

    local = {
        "scope": "process",
        "coverage": "local_only",
        "availability": "available",
        "queue_depth": 0,
        "queue_capacity": 10000,
        "started_at": "2026-10-31T10:00:00+00:00",
        "last_write_at": "2026-10-31T10:01:00+00:00",
        "last_error_at": None,
        "counters": {"buffer_full": 1},
    }
    history = {
        "availability": "available",
        "source": "postgresql_v2",
        "cutover_at": "2026-10-31T09:00:00+00:00",
        "legacy_status": "unverified",
        "legacy_combined": False,
        "retention_days": 8,
    }
    summary_calls = []

    def summaries(specs):
        summary_calls.append(specs)
        return {"api_latency": _summary()}

    def timeseries_snapshot(names, period="minute", minutes=60, *, persisted=False):
        assert persisted is True
        source = "postgresql_v2" if persisted or period != "minute" else "redis_v2"
        return {
            "data": {name: [] for name in names},
            "status": {
                name: {
                    "availability": "empty",
                    "source": source,
                    "reason": "empty",
                    "observed_at": None,
                    "age_seconds": None,
                    "window_minutes": minutes,
                }
                for name in names
            },
        }

    monkeypatch.setattr(metrics, "query_summaries", summaries)
    monkeypatch.setattr(
        metrics, "query_timeseries_snapshot", timeseries_snapshot, raising=False
    )
    monkeypatch.setattr(
        metrics, "get_collection_health", lambda: deepcopy(local), raising=False
    )
    monkeypatch.setattr(
        metric_minutes, "get_metric_history_status", lambda: deepcopy(history)
    )
    monkeypatch.setattr(admin_metrics, "_build_metrics_system", lambda: {})
    monkeypatch.setattr(admin_metrics, "_list_running_tasks", lambda limit: [])
    monkeypatch.setattr(admin_metrics, "_build_playback_delivery", lambda: {})
    monkeypatch.setattr(
        admin_metrics, "_DASHBOARD_TIMESERIES", {"api.latency": "api.request.latency"}
    )
    for name in (
        "query_recent",
        "query_recent_rolled",
        "query_historical",
        "query_route_latency",
    ):
        monkeypatch.setattr(metrics, name, lambda *args, **kwargs: [])
    return local, history, summary_calls


@pytest.mark.parametrize(
    ("period", "minutes"), [("minute", 60), ("hour", 1440), ("day", 1440)]
)
def test_dashboard_reads_one_timeseries_batch_and_preserves_legacy_response_names(
    test_app, summary_sources, monkeypatch, period, minutes
):
    from crate import metrics
    from crate.api import admin_metrics

    mapping = {
        "api.latency": "api.request.latency",
        "api.requests": "api.request.count",
    }
    monkeypatch.setattr(admin_metrics, "_DASHBOARD_TIMESERIES", mapping)
    calls = []
    row = {
        "timestamp": "2026-10-31T10:00:00+00:00",
        "count": 2,
        "sum": 40.0,
        "avg": 20.0,
        "min": 10.0,
        "max": 30.0,
        "source_gap": False,
        "observed_at": "2026-10-31T10:01:00+00:00",
    }
    status = {
        "availability": "available",
        "source": "postgresql_v2",
        "reason": None,
        "observed_at": "2026-10-31T10:01:00+00:00",
        "age_seconds": 0.0,
        "window_minutes": minutes,
    }

    def snapshot(names, period="minute", minutes=60, *, persisted=False):
        calls.append((list(names), period, minutes, persisted))
        return {
            "data": {name: [row] for name in names},
            "status": {name: status for name in names},
        }

    def forbidden_single(*_args, **_kwargs):
        raise AssertionError(
            "Dashboard must batch timeseries instead of reading each metric"
        )

    monkeypatch.setattr(metrics, "query_timeseries_snapshot", snapshot)
    for name in ("query_recent", "query_recent_rolled", "query_historical"):
        monkeypatch.setattr(metrics, name, forbidden_single)
    monkeypatch.setattr("crate.db.cache_store.get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.db.cache_store.set_cache", lambda *args, **kwargs: None)

    response = test_app.get(
        f"/api/admin/metrics/dashboard?period={period}&minutes={minutes}"
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(calls) == 1
    assert set(calls[0][0]) == set(mapping.values())
    assert calls[0][1:] == (period, minutes, True)
    assert payload["timeseries"] == {name: [row] for name in mapping}
    assert payload["timeseries_status"] == {name: status for name in mapping}


def test_summary_api_exposes_metric_metadata_and_process_local_collector(
    test_app, summary_sources
):
    local, history, _calls = summary_sources

    response = test_app.get("/api/admin/metrics/summary")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["api_latency"]["availability"] == "available"
    assert payload["_meta"]["schema_version"] == 2
    assert payload["_meta"]["history"] == history
    assert payload["_meta"]["collector_local"] == local
    assert datetime.fromisoformat(payload["_meta"]["generated_at"]).tzinfo is not None


def test_summary_api_marks_history_unavailable_when_postgresql_read_fails(
    test_app, summary_sources, monkeypatch
):
    from crate.db.queries import metric_minutes

    def unavailable_history():
        raise RuntimeError("Injected historical database failure")

    monkeypatch.setattr(
        metric_minutes, "get_metric_history_status", unavailable_history
    )

    response = test_app.get("/api/admin/metrics/summary")

    assert response.status_code == 200, response.text
    history = response.json()["_meta"]["history"]
    assert history["availability"] == "unavailable"
    assert history["legacy_status"] == "unverified"
    assert history["legacy_combined"] is False


def test_dashboard_cache_preserves_sample_time_and_attaches_current_process_collector(
    pg_db, test_app, summary_sources, metric_runtime, monkeypatch
):
    from crate.db import cache_store

    _metrics, redis, _clock = metric_runtime
    local, _history, calls = summary_sources
    monkeypatch.setattr(cache_store, "get_redis", lambda: redis)
    monkeypatch.setattr(cache_store, "_mem_get", lambda *args, **kwargs: None)
    monkeypatch.setattr(cache_store, "_mem_set", lambda *args, **kwargs: None)

    first = test_app.get("/api/admin/metrics/dashboard?period=minute&minutes=60")

    assert first.status_code == 200, first.text
    assert (
        first.json()["summary"]["_meta"]["collector_local"]["counters"]["buffer_full"]
        == 1
    )
    cache_keys = list(redis.scan_iter(match="cache:admin:metrics:dashboard:*"))
    assert len(cache_keys) == 1
    assert ":v2:" in cache_keys[0]
    cached = json.loads(redis.get(cache_keys[0]))
    assert "collector_local" not in json.dumps(cached)
    sample_time = "2026-10-31T08:00:00+00:00"
    cached["summary"]["_meta"]["generated_at"] = sample_time
    redis.set(cache_keys[0], json.dumps(cached), ex=10)
    local["counters"]["buffer_full"] = 7

    second = test_app.get("/api/admin/metrics/dashboard?period=minute&minutes=60")

    assert second.status_code == 200, second.text
    payload = second.json()
    assert len(calls) == 1
    assert payload["summary"]["_meta"]["generated_at"] == sample_time
    assert (
        payload["summary"]["_meta"]["collector_local"]["counters"]["buffer_full"] == 7
    )
    assert "collector_local" not in redis.get(cache_keys[0])
