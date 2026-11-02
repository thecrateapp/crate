from __future__ import annotations

from datetime import datetime, timezone
from io import StringIO
import json

import pytest

from crate import alerting, metrics


_INPUTS = ("api_latency", "api_requests", "api_errors", "queue_depth")


def _summary(*, availability="available", count=20, maximum=1.0, eligible_count=None):
    return {
        "count": count,
        "sum": float(count),
        "avg": 1.0 if count else 0.0,
        "min": 1.0 if count else 0.0,
        "max": maximum,
        "availability": availability,
        "reason": None if availability == "available" else "not_observed",
        "source": "redis_v2",
        "observed_at": datetime.now(timezone.utc).isoformat() if count else None,
        "age_seconds": 0.0 if count else None,
        "window_minutes": 5,
        "sample_count": count,
        "sample_kind": "observations",
        "eligible_count": count if eligible_count is None else eligible_count,
    }


def _observed_inputs():
    inputs = {
        "api_latency": _summary(maximum=30.0),
        "api_requests": _summary(),
        "api_errors": _summary(count=0, maximum=0.0, eligible_count=20),
        "queue_depth": _summary(count=1, maximum=2.0),
    }
    inputs["api_errors"]["observed_at"] = inputs["api_requests"]["observed_at"]
    inputs["api_errors"]["age_seconds"] = inputs["api_requests"]["age_seconds"]
    return inputs


def _evaluation_sources(monkeypatch, summaries, *, settings=None):
    from crate import storage_health

    settings = settings or {}
    batches = []
    single_reads = []

    def query_summaries(specs):
        batches.append(specs)
        return summaries

    def query_summary(name, minutes=5):
        single_reads.append(name)
        key = {
            "api.request.latency": "api_latency",
            "api.request.count": "api_requests",
            "api.request.errors": "api_errors",
            "worker.queue.depth": "queue_depth",
        }[name]
        return summaries[key]

    monkeypatch.setattr(metrics, "query_summaries", query_summaries)
    monkeypatch.setattr(metrics, "query_summary", query_summary)
    monkeypatch.setattr(
        metrics,
        "get_collection_health",
        lambda: {
            "availability": "available",
            "scope": "process",
            "coverage": "local_only",
            "counters": {},
        },
    )
    monkeypatch.setattr(alerting, "get_setting", lambda key: settings.get(key))
    monkeypatch.setattr(storage_health, "collect_storage_health", lambda: {})
    original_open = open

    def controlled_open(path, *args, **kwargs):
        if str(path) == "/proc/meminfo":
            return StringIO("MemTotal: 1000000 kB\nMemAvailable: 900000 kB\n")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr("builtins.open", controlled_open)
    return batches, single_reads


@pytest.mark.parametrize("availability", ["partial", "unavailable"])
def test_known_local_collection_loss_prevents_a_healthy_score(
    monkeypatch, availability
):
    _evaluation_sources(monkeypatch, _observed_inputs())
    local = {
        "availability": availability,
        "scope": "process",
        "coverage": "local_only",
        "counters": {"buffer_full": 3},
        "process_id": "PRIVATE_PROCESS_ID",
        "extra": "PRIVATE_PROCESS_METADATA",
    }
    monkeypatch.setattr(metrics, "get_collection_health", lambda: local)

    status = alerting.evaluate_health()

    assert status.score is None
    snapshot = status.snapshot()
    assert snapshot["availability"] != "available"
    assert snapshot["coverage"] == "observed_only"
    assert snapshot["collector_local"] == {
        "availability": availability,
        "scope": "process",
        "coverage": "local_only",
        "counters": {"buffer_full": 3},
    }
    assert "PRIVATE_PROCESS" not in json.dumps(snapshot)


@pytest.mark.parametrize("written_before", [False, True])
def test_real_local_losses_override_fresh_global_inputs_before_any_recent_local_write(
    monkeypatch, written_before
):
    actual_health = metrics.get_collection_health
    _evaluation_sources(monkeypatch, _observed_inputs())
    monkeypatch.setattr(metrics, "get_collection_health", actual_health)
    monkeypatch.setattr(
        metrics,
        "_last_write_at",
        datetime.now(timezone.utc).timestamp() - 600 if written_before else None,
    )
    monkeypatch.setattr(metrics, "_last_error_at", None)
    monkeypatch.setattr(metrics, "_last_error_reason", None)
    monkeypatch.setattr(
        metrics, "_collection_counters", dict.fromkeys(metrics._collection_counters, 0)
    )
    metrics._collection_event("buffer_full", 3)

    status = alerting.evaluate_health()

    assert status.score is None
    assert status.availability == "partial"
    assert status.snapshot()["collector_local"]["counters"]["buffer_full"] == 3


@pytest.mark.parametrize("availability", ["empty", "stale"])
def test_no_known_local_collection_failure_does_not_replace_observed_input_evidence(
    monkeypatch, availability
):
    _evaluation_sources(monkeypatch, _observed_inputs())
    monkeypatch.setattr(
        metrics,
        "get_collection_health",
        lambda: {
            "availability": availability,
            "scope": "process",
            "coverage": "local_only",
            "counters": {},
        },
    )

    status = alerting.evaluate_health()

    assert status.score == 100
    assert status.snapshot()["coverage"] == "observed_only"


@pytest.mark.parametrize("availability", ["empty", "stale", "partial", "unavailable"])
def test_missing_metric_evidence_never_produces_a_healthy_score(
    monkeypatch, availability
):
    summaries = {
        key: _summary(availability=availability, count=0, maximum=0.0)
        for key in _INPUTS
    }
    _evaluation_sources(monkeypatch, summaries)

    status = alerting.evaluate_health()

    assert status.score is None
    snapshot = status.snapshot()
    assert snapshot["schema_version"] == 2
    assert snapshot["score"] is None
    assert snapshot["availability"] != "available"
    assert snapshot["coverage"] == "observed_only"
    assert snapshot["source"]
    assert set(snapshot["inputs"]) == set(_INPUTS)
    assert "observed_at" in snapshot


@pytest.mark.parametrize("missing_input", _INPUTS)
def test_one_missing_required_input_keeps_score_unknown(monkeypatch, missing_input):
    summaries = _observed_inputs()
    summaries[missing_input] = _summary(
        availability="unavailable", count=0, maximum=0.0
    )
    _evaluation_sources(monkeypatch, summaries)

    status = alerting.evaluate_health()

    assert status.score is None
    assert status.snapshot()["inputs"][missing_input]["availability"] == "unavailable"


def test_health_reads_one_batch_and_derives_error_count_from_classified_requests(
    monkeypatch,
):
    summaries = _observed_inputs()
    batches, single_reads = _evaluation_sources(monkeypatch, summaries)

    status = alerting.evaluate_health()

    assert status.score == 100
    assert len(batches) == 1
    assert single_reads == []
    assert batches[0]["api_errors"] == (
        "api.request.count",
        5,
        {"status_class": "5xx"},
    )
    assert all(spec[0] != "api.request.errors" for spec in batches[0].values())
    snapshot = status.snapshot()
    assert snapshot["availability"] == "available"
    assert snapshot["coverage"] == "observed_only"
    assert snapshot["schema_version"] == 2


def test_health_calls_observed_latency_max_by_its_actual_name(monkeypatch):
    summaries = _observed_inputs()
    summaries["api_latency"] = _summary(maximum=4000.0)
    _evaluation_sources(
        monkeypatch,
        summaries,
        settings={
            "alert_threshold_api_max_latency_ms": "1000",
            "alert_threshold_api_p95_latency_ms": "5000",
        },
    )

    status = alerting.evaluate_health()

    assert status.metrics["api_max"] == 4000.0
    assert "api_p95" not in status.metrics
    latency_breaches = [
        breach for breach in status.breaches if "latency" in breach.name.lower()
    ]
    assert len(latency_breaches) == 1
    assert "max" in latency_breaches[0].name.lower()
    assert "p95" not in repr(status.snapshot()).lower()


@pytest.mark.parametrize(
    ("new", "legacy", "expected"),
    [
        ("750", "900", 750.0),
        ("0", "900", 0.0),
        (None, "900", 900.0),
        ("nan", "900", 900.0),
        ("inf", "900", 900.0),
        ("-1", "900", 900.0),
        ("invalid", "900", 900.0),
        (None, "nan", 3000.0),
        (None, "-1", 3000.0),
        (None, None, 3000.0),
    ],
)
def test_max_latency_threshold_prefers_valid_new_value_and_reads_legacy_without_writes(
    monkeypatch, new, legacy, expected
):
    from crate.db import cache_settings
    from crate.db.repositories import settings as setting_repository

    stored = {
        "alert_threshold_api_max_latency_ms": new,
        "alert_threshold_api_p95_latency_ms": legacy,
    }
    writes = []
    monkeypatch.setattr(alerting, "get_setting", lambda key: stored.get(key))

    def no_write(*args, **kwargs):
        writes.append((args, kwargs))
        raise AssertionError("Reading the deprecated threshold must not write settings")

    monkeypatch.setattr(cache_settings, "set_setting", no_write)
    monkeypatch.setattr(setting_repository, "set_setting", no_write)

    threshold = alerting._get_threshold("api_max_latency_ms", 3000.0)

    assert threshold == expected
    assert writes == []
