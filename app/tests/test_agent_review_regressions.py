"""Regression coverage for diagnostic evidence and public input boundaries."""

import base64
import json
from datetime import UTC, date, timedelta
from decimal import Decimal

import pytest
from crate import agent_diagnostics as diagnostics

from tests.test_agent_diagnostics import NOW, issue, snapshot


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(diagnostics, "_now", lambda: NOW)
    for setting in (
        "OPS_FRESH_SECONDS",
        "OPS_STALE_SECONDS",
        "HEARTBEAT_FRESH_SECONDS",
        "HEALTH_FRESH_SECONDS",
        "HEALTH_STALE_SECONDS",
    ):
        monkeypatch.delenv(f"CRATE_MCP_{setting}", raising=False)


def test_instance_evidence_accepts_legacy_naive_iso_timestamps(monkeypatch):
    observed = (NOW - timedelta(seconds=10)).replace(tzinfo=None).isoformat()
    record = snapshot()
    record["built_at"] = observed
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_status_evidence",
        lambda: {
            "snapshots": [record],
            "runtime": [
                {"key": key, "updated_at": observed, "payload_json": {}}
                for key in ("worker_live", "analysis_status")
            ],
        },
    )

    result = diagnostics.get_instance_status()

    assert result["availability"] == "available"
    assert all(
        source["availability"] == "available" for source in result["data"].values()
    )


def test_library_check_age_accepts_legacy_naive_iso_timestamps(monkeypatch):
    old = (NOW - timedelta(days=2)).replace(tzinfo=None).isoformat()
    record = snapshot(
        issues=[issue(last_seen_at=old)],
        runs={"duplicate_tracks": {"last_run_at": old}},
    )
    monkeypatch.setattr(
        diagnostics.agent_library, "read_health_snapshot", lambda: record
    )

    result = diagnostics.list_library_issues()

    assert result["availability"] == "stale"
    assert result["data"][0]["availability"] == "stale"
    assert result["checks"]["duplicate_tracks"]["availability"] == "stale"


@pytest.mark.parametrize("since", [None, "2026-10-16T11:00:00"])
def test_direct_log_read_normalizes_naive_iso_window_before_query(monkeypatch, since):
    captured = []

    def read_logs(**kwargs):
        captured.append(kwargs)
        return []

    monkeypatch.setattr(diagnostics.agent_operations, "read_worker_logs", read_logs)

    result = diagnostics.read_diagnostics(
        source="worker_logs", since=since, until="2026-10-16T12:00:00"
    )

    assert result["availability"] == "available"
    assert captured[0]["since"] == NOW - timedelta(hours=1)
    assert captured[0]["until"] == NOW
    assert captured[0]["since"].tzinfo == UTC
    assert captured[0]["until"].tzinfo == UTC


@pytest.mark.parametrize(
    "window",
    [
        {"until": "not-a-timestamp"},
        {"since": "not-a-timestamp"},
        {"since": "2026-10-16T12:00:00", "until": "not-a-timestamp"},
        {"since": "2026-10-16T11:00:00", "until": "2026-10-16T10:00:00+00:00"},
    ],
)
def test_invalid_direct_log_window_is_typed_before_database(monkeypatch, window):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_worker_logs",
        lambda **_kwargs: pytest.fail("Invalid window reached the database"),
    )

    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.read_diagnostics(source="worker_logs", **window)

    assert caught.value.code == "INVALID_ARGUMENT"


def test_unknown_diagnostic_source_is_rejected_before_evidence_read(monkeypatch):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_status_evidence",
        lambda: pytest.fail("Unknown source reached evidence read"),
    )

    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.read_diagnostics(source="arbitrary-status")

    assert caught.value.code == "INVALID_ARGUMENT"


def test_job_scalar_evidence_is_json_serializable(monkeypatch):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {
            "id": "job-1",
            "created_at": date(2026, 10, 16),
            "result": {"elapsed": Decimal("12.50")},
        },
    )

    result = diagnostics.get_job("job-1")

    encoded = json.dumps(result, allow_nan=False)
    assert result["data"]["created_at"] == "2026-10-16"
    assert result["data"]["result"]["elapsed"] == "12.50"
    assert "2026-10-16" in encoded


def test_unusual_job_scalar_cannot_bypass_redaction_or_size_limit(monkeypatch):
    class ExternalValue:
        def __str__(self):
            return "token=private-value /home/crate/private.txt " + "é" * 3000

    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {"id": "job-1", "error": ExternalValue()},
    )

    result = diagnostics.get_job("job-1")
    error = result["data"]["error"]

    assert isinstance(error, str)
    assert "private-value" not in error
    assert "/home/crate/private.txt" not in error
    assert "[redacted]" in error
    assert len(error.encode("utf-8")) <= 2048
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_job_numbers_do_not_emit_invalid_json(monkeypatch, value):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {"id": "job-1", "result": {"progress": value}},
    )

    result = diagnostics.get_job("job-1")

    assert result["data"]["result"]["progress"] is None
    json.dumps(result, allow_nan=False)


def test_invalid_keyset_timestamp_is_rejected_at_service_boundary(monkeypatch):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_jobs",
        lambda **_kwargs: [
            {"id": "job-2", "created_at": NOW},
            {"id": "job-1", "created_at": NOW},
        ],
    )
    valid = diagnostics.list_jobs(limit=1)["next_cursor"]
    decoded = json.loads(base64.urlsafe_b64decode(valid))
    decoded["before"] = ["not-a-timestamp", "job-1"]
    cursor = base64.urlsafe_b64encode(json.dumps(decoded).encode()).decode()
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_jobs",
        lambda **_kwargs: pytest.fail("Malformed keyset reached the database"),
    )

    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.list_jobs(cursor=cursor)

    assert caught.value.code == "INVALID_ARGUMENT"
