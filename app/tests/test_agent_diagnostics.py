"""Diagnostic decisions preserve evidence age, identity and bounded output."""

import base64
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from crate import agent_diagnostics as diagnostics
from crate.agent_access import AgentPrincipal

NOW = datetime(2026, 10, 16, 12, tzinfo=UTC)
ARTIST_UID = "10000000-0000-0000-0000-000000000001"


def test_metric_series_older_than_five_minutes_is_stale_within_requested_window(
    monkeypatch,
):
    observed_at = (NOW - timedelta(minutes=60)).isoformat()
    monkeypatch.setattr(
        "crate.metrics.query_recent",
        lambda *args, **kwargs: [
            {
                "timestamp": observed_at,
                "count": 1,
                "sum": 2.0,
                "avg": 2.0,
                "min": 2.0,
                "max": 2.0,
            }
        ],
    )

    result = diagnostics.read_diagnostics(
        source="metric_series", series="worker.queue.wait", minutes=100
    )

    assert result["availability"] == "stale"
    assert result["observed_at"] == observed_at


def test_metric_series_distinguishes_observation_count_from_returned_minutes(
    monkeypatch,
):
    rows = [
        {
            "timestamp": (NOW - timedelta(minutes=1 - offset)).isoformat(),
            "count": count,
            "sum": count * 2.0,
            "avg": 2.0,
            "min": 2.0,
            "max": 2.0,
        }
        for offset, count in enumerate((3, 4))
    ]
    monkeypatch.setattr("crate.metrics.query_recent", lambda *args, **kwargs: rows)

    result = diagnostics.read_diagnostics(
        source="metric_series", series="worker.queue.wait", minutes=5
    )

    assert result["availability"] == "available"
    assert result["sample_count"] == 7
    assert result["returned_count"] == 2
    assert result["namespace"] == "crate:metrics:v2"
    assert result["sample_kind"] == "minute_aggregates"


def test_dense_metric_window_returns_latest_twenty_minutes_without_false_staleness(
    monkeypatch,
):
    samples = [
        {
            "timestamp": (NOW - timedelta(minutes=59 - offset)).isoformat(),
            "count": 1,
            "sum": 2.0,
            "avg": 2.0,
            "min": 2.0,
            "max": 2.0,
        }
        for offset in range(60)
    ]
    monkeypatch.setattr("crate.metrics.query_recent", lambda *args, **kwargs: samples)

    result = diagnostics.read_diagnostics(
        source="metric_series", series="worker.queue.wait", minutes=60, limit=20
    )

    assert result["data"]["samples"] == samples[-20:]
    assert result["observed_at"] == NOW.isoformat()
    assert result["availability"] == "available"
    assert result["returned_count"] == 20
    assert result["sample_count"] == 20
    assert result["truncated"] is True


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    monkeypatch.setattr(diagnostics, "_now", lambda: NOW)
    for setting in (
        "OPS_FRESH_SECONDS",
        "OPS_STALE_SECONDS",
        "HEARTBEAT_FRESH_SECONDS",
        "HEALTH_FRESH_SECONDS",
        "HEALTH_STALE_SECONDS",
    ):
        monkeypatch.delenv(f"CRATE_MCP_{setting}", raising=False)


def snapshot(
    *, age=10, invalidated=False, issues=None, runs=None, counts=None, version=2
):
    return {
        "version": version,
        "built_at": NOW - timedelta(seconds=age),
        "source_seq": 42,
        "invalidated_at": NOW if invalidated else None,
        "payload_json": {
            "stats": {"tracks": 0, "artists": 8},
            "issues": issues or [],
            "counts": counts
            if counts is not None
            else {"duplicate_tracks": len(issues or [])},
            "runs": runs
            if runs is not None
            else {"duplicate_tracks": {"last_run_at": NOW.isoformat()}},
        },
    }


def issue(number=1, **extra):
    return {
        "id": number,
        "check_type": "duplicate_tracks",
        "severity": "high",
        "description": "Duplicate recording",
        "last_seen_at": NOW.isoformat(),
        "artist_uid": ARTIST_UID,
        "auto_fixable": True,
        **extra,
    }


@pytest.mark.parametrize(
    ("record", "availability"),
    [
        (snapshot(), "available"),
        (snapshot(age=120), "stale"),
        (snapshot(age=301), "unavailable"),
        (snapshot(invalidated=True), "unavailable"),
        (None, "unavailable"),
    ],
)
def test_snapshot_freshness_and_invalidation_are_explicit(
    monkeypatch, record, availability
):
    monkeypatch.setattr(
        diagnostics.agent_library, "read_health_snapshot", lambda: record
    )
    result = diagnostics.list_library_issues()
    assert result["availability"] == availability
    assert result["schema_version"] == "1"
    if availability == "unavailable":
        assert result["data"] is None
        assert result["reason"]
    if record:
        assert result["snapshot"]["version"] == record["version"]
        assert result["snapshot"]["source_seq"] == 42


def test_new_snapshot_does_not_rejuvenate_missing_checks_or_old_worker(monkeypatch):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_status_evidence",
        lambda: {
            "snapshots": [snapshot()],
            "runtime": [
                {
                    "key": "worker_live",
                    "updated_at": (NOW - timedelta(hours=2)).isoformat(),
                    "payload_json": {
                        "pending_count": 0,
                        "systems": {"postgres": True, "watcher": True},
                    },
                }
            ],
        },
    )
    status = diagnostics.get_instance_status()
    assert status["availability"] == "stale"
    assert status["data"]["library"]["availability"] == "available"
    assert status["data"]["library"]["data"]["tracks"] == 0
    assert status["data"]["library"]["data"]["albums"] is None
    assert status["data"]["worker"]["availability"] == "stale"
    assert status["data"]["worker"]["data"]["running_count"] is None
    assert "systems" not in status["data"]["worker"]["data"]
    assert status["data"]["analysis"]["availability"] == "unavailable"

    monkeypatch.setattr(
        diagnostics.agent_library, "read_health_snapshot", lambda: snapshot(runs={})
    )
    health = diagnostics.list_library_issues(check_type="duplicate_tracks")
    assert health["availability"] != "available"
    assert health["checks"]["duplicate_tracks"]["availability"] == "unavailable"


@pytest.mark.parametrize(
    "age,expected", [(3600, "available"), (172800, "stale"), (691200, "unavailable")]
)
def test_issue_observation_age_is_independent_from_snapshot_time(
    monkeypatch, age, expected
):
    old = NOW - timedelta(seconds=age)
    record = snapshot(
        issues=[issue(last_seen_at=old.isoformat())],
        runs={"duplicate_tracks": {"last_run_at": old.isoformat()}},
    )
    monkeypatch.setattr(
        diagnostics.agent_library, "read_health_snapshot", lambda: record
    )
    result = diagnostics.list_library_issues()
    assert result["data"][0]["availability"] == expected
    assert result["checks"]["duplicate_tracks"]["availability"] == expected
    assert result["data"][0]["risk"] == "destructive"
    assert result["data"][0]["can_execute_for_this_principal"] is False


def test_sample_pagination_does_not_claim_full_coverage(monkeypatch):
    record = snapshot(issues=[issue(1), issue(2)], counts={"duplicate_tracks": 1200})
    monkeypatch.setattr(
        diagnostics.agent_library, "read_health_snapshot", lambda: record
    )
    first = diagnostics.list_library_issues(limit=1)
    last = diagnostics.list_library_issues(limit=1, cursor=first["next_cursor"])
    assert first["returned_count"] == 1
    assert first["total"] == 1200
    assert first["next_cursor"]
    assert last["next_cursor"] is None
    assert last["truncated"] is True
    assert last["sample_truncated"] is True
    assert last["data"][0]["id"] == 2


def test_issue_cursor_rejects_changed_version_and_filters(monkeypatch):
    record = snapshot(issues=[issue(1), issue(2)])
    monkeypatch.setattr(
        diagnostics.agent_library, "read_health_snapshot", lambda: record
    )
    cursor = diagnostics.list_library_issues(limit=1)["next_cursor"]
    with pytest.raises(diagnostics.DiagnosticError) as changed_filter:
        diagnostics.list_library_issues(limit=1, cursor=cursor, severity="low")
    assert changed_filter.value.code == "INVALID_ARGUMENT"
    record["version"] = 3
    with pytest.raises(diagnostics.DiagnosticError) as changed_version:
        diagnostics.list_library_issues(limit=1, cursor=cursor)
    assert changed_version.value.code == "CURSOR_STALE"


@pytest.mark.parametrize("cursor", ["not-base64", "e30=", "bnVsbA==", "W10="])
def test_malformed_issue_cursor_is_a_typed_error(monkeypatch, cursor):
    monkeypatch.setattr(diagnostics.agent_library, "read_health_snapshot", snapshot)
    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.list_library_issues(cursor=cursor)
    assert caught.value.code == "INVALID_ARGUMENT"


def test_issue_filters_and_allowlist_omit_sensitive_details(monkeypatch):
    record = snapshot(
        issues=[
            issue(1, details_json={"secret": "should-not-leak"}),
            issue(2, severity="low"),
            issue(3, artist_uid="20000000-0000-0000-0000-000000000002"),
        ]
    )
    monkeypatch.setattr(
        diagnostics.agent_library, "read_health_snapshot", lambda: record
    )
    result = diagnostics.list_library_issues(artist_uid=ARTIST_UID, severity="high")
    assert [row["id"] for row in result["data"]] == [1]
    assert "details_json" not in result["data"][0]
    assert "total" not in result


@pytest.mark.parametrize(
    "names,resolution",
    [([], "not_found"), (["Echo"], "resolved"), (["Echo", "Echoes"], "ambiguous")],
)
def test_artist_identity_resolution_never_selects_an_ambiguous_first_match(
    monkeypatch, names, resolution
):
    monkeypatch.setattr(
        diagnostics.agent_library,
        "read_artist_evidence",
        lambda **_kwargs: {
            "artists": [
                {"name": name, "updated_at": NOW.isoformat()} for name in names
            ],
            "issues": [issue()] if len(names) == 1 else [],
            "runs": {},
        },
    )
    result = diagnostics.inspect_artist(name="Echo")
    assert result["data"]["resolution"] == resolution
    assert len(result["data"]["artists"]) == len(names)
    assert result["data"]["can_execute_for_this_principal"] is False
    catalog = {entry["check_type"]: entry for entry in result["data"]["repair_catalog"]}
    assert catalog["duplicate_tracks"]["risk"] == "destructive"
    assert catalog["duplicate_tracks"]["auto_fixable"] is True
    assert all(
        entry["can_execute_for_this_principal"] is False for entry in catalog.values()
    )
    if resolution != "resolved":
        assert result["data"]["issues"] == []


def test_artist_uid_is_validated_before_database_access(monkeypatch):
    monkeypatch.setattr(
        diagnostics.agent_library,
        "read_artist_evidence",
        lambda **_kwargs: pytest.fail("DB reached"),
    )
    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.inspect_artist(artist_uid="invalid-uuid")
    assert caught.value.code == "INVALID_ARGUMENT"


@pytest.mark.parametrize(
    "enabled,grants,expected",
    [
        ("true", {"library.repair.photo_flag"}, True),
        ("false", {"library.repair.photo_flag"}, False),
        ("true", {"library.health.run"}, False),
        ("true", {"library.health.read"}, False),
        ("true", None, False),
    ],
)
def test_diagnostics_advertise_only_photo_repairs_permitted_for_this_principal(
    monkeypatch, enabled, grants, expected
):
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", enabled)
    principal = (
        AgentPrincipal("integration", "credential", "Agent", frozenset(grants))
        if grants is not None
        else None
    )
    issues = [issue(1, check_type="has_photo_desync"), issue(2)]
    monkeypatch.setattr(
        diagnostics.agent_library,
        "read_health_snapshot",
        lambda: snapshot(issues=issues),
    )
    monkeypatch.setattr(
        diagnostics.agent_library,
        "read_artist_evidence",
        lambda **_kwargs: {
            "artists": [{"entity_uid": ARTIST_UID, "name": "Echo"}],
            "issues": issues,
            "runs": {},
        },
    )
    listed = diagnostics.list_library_issues(principal=principal)
    inspected = diagnostics.inspect_artist(artist_uid=ARTIST_UID, principal=principal)
    for rows in (listed["data"], inspected["data"]["issues"]):
        flags = {
            row["check_type"]: row["can_execute_for_this_principal"] for row in rows
        }
        assert flags == {"has_photo_desync": expected, "duplicate_tracks": False}
    catalog = {
        row["check_type"]: row["can_execute_for_this_principal"]
        for row in inspected["data"]["repair_catalog"]
    }
    assert catalog["has_photo_desync"] is expected
    assert not any(
        allowed for check, allowed in catalog.items() if check != "has_photo_desync"
    )
    assert inspected["data"]["can_execute_for_this_principal"] is expected
    assert "fresh directed check" in inspected["data"]["repair_precondition"]


def test_repair_grant_does_not_make_ambiguous_artist_executable(monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    principal = AgentPrincipal(
        "integration", "credential", "Agent", frozenset({"library.repair.photo_flag"})
    )
    monkeypatch.setattr(
        diagnostics.agent_library,
        "read_artist_evidence",
        lambda **_kwargs: {
            "artists": [{"name": "Echo"}, {"name": "Echoes"}],
            "issues": [],
        },
    )
    result = diagnostics.inspect_artist(name="Echo", principal=principal)
    assert result["data"]["resolution"] == "ambiguous"
    assert result["data"]["can_execute_for_this_principal"] is False


def test_job_pagination_forwards_keyset_and_preserves_filters(monkeypatch):
    calls = []
    rows = [
        {"id": "job-2", "created_at": NOW, "status": "failed"},
        {"id": "job-1", "created_at": NOW, "status": "failed"},
    ]

    def read_jobs(**kwargs):
        calls.append(kwargs)
        return rows if kwargs["before"] is None else rows[1:]

    monkeypatch.setattr(diagnostics.agent_operations, "read_jobs", read_jobs)
    first = diagnostics.list_jobs(states=["failed"], types=["scan"], limit=1)
    second = diagnostics.list_jobs(
        states=["failed"], types=["scan"], limit=1, cursor=first["next_cursor"]
    )
    assert calls[0]["limit"] == 2
    assert calls[1]["before"] == [str(NOW), "job-2"]
    assert second["data"][0]["id"] == "job-1"
    assert second["next_cursor"] is None
    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.list_jobs(
            states=["completed"], types=["scan"], cursor=first["next_cursor"]
        )
    assert caught.value.code == "INVALID_ARGUMENT"
    with pytest.raises(diagnostics.DiagnosticError):
        diagnostics.list_jobs(types=["arbitrary-shell-command"])


def test_failed_job_returns_redacted_evidence_without_retry(monkeypatch):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {
            "id": "job-1",
            "status": "failed",
            "updated_at": NOW,
            "error": "token=secret-value Bearer bearer-value /home/private/file https://user:pass@example.test",
        },
    )
    result = diagnostics.get_job("job-1")
    assert result["data"]["status"] == "failed"
    error = result["data"]["error"]
    for secret in ("secret-value", "bearer-value", "/home/private/file", "user:pass"):
        assert secret not in error
    assert "[redacted]" in error
    assert "Retry/cancel require separate grants" in result["interpretation"]


def test_missing_job_returns_unknown_instead_of_completed(monkeypatch):
    monkeypatch.setattr(diagnostics.agent_operations, "read_job", lambda _job_id: None)
    result = diagnostics.get_job("missing")
    assert result["availability"] == "unavailable"
    assert result["data"] is None


@pytest.mark.parametrize(
    "error,secret",
    [
        ("Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"),
        ('{"password": "two words secret"}', "words secret"),
        ('password="two words secret', "words secret"),
        ("Cookie: sid=abc; refresh=def", "refresh=def"),
    ],
)
def test_diagnostic_redaction_removes_complete_credential_values(
    monkeypatch, error, secret
):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {"id": "job-1", "status": "failed", "error": error},
    )
    result = diagnostics.get_job("job-1")
    assert secret not in result["data"]["error"]
    assert "[redacted" in result["data"]["error"]


@pytest.mark.parametrize(
    "key",
    [
        "X-Api-Key",
        "X-Auth-Token",
        "x_api_key",
        "xAuthToken",
        "service_api_key",
        "client-secret",
        "Authorization",
        "api_key",
        "secret_key",
        "tokens",
        "auth_token_value",
        "accessTokenValue",
        "service_password_hash",
        "private_keys",
        "credentials.apiKey.value",
    ],
)
def test_job_evidence_redacts_nested_prefixed_credentials(monkeypatch, key):
    secret = "credential-must-stay-private"
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {
            "id": "job-1",
            "result": {"headers": [{key: secret}], "token_count": 3},
        },
    )

    result = diagnostics.get_job("job-1")

    assert secret not in json.dumps(result)
    assert result["data"]["result"]["headers"] == [{key: "[redacted]"}]
    assert result["data"]["result"]["token_count"] == 3


@pytest.mark.parametrize(
    "error",
    [
        'secret_key="two words private-value"',
        "auth_token_value='two words private-value'",
        "tokens=private-value",
        'error: {"tokens": ["private-value", {"nested": "other-private-value"}]}',
        'secret_key="two words private-value',
        'tokens=["private-value", {"nested": "other-private-value"}',
        "auth_token_value=Bearer private-value",
        "tokens=" + "[" * 1100 + '"private-value"' + "]" * 1100,
        "password=correct horse private-value battery staple",
        "password=123 private-value",
        "secret_key=false private-value",
        "auth_token_value=null private-value",
        "tokens=prefix private-value; other=visible",
        "token: |\n  private-value\npublic=visible",
        "token: >-\n  private-value\npublic=visible",
        "secret_key: !vault |\n  private-value",
        "private_key=-----BEGIN PRIVATE KEY-----\nprivate-value\n-----END PRIVATE KEY-----",
        "password=prefix\n  private-value",
        "Authorization: |\n  private-value",
        "Cookie: |\n  private-value",
        "Set-Cookie: >\n  private-value",
    ],
)
def test_job_text_redacts_compound_credentials_and_collections(monkeypatch, error):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {"id": "job-1", "error": error},
    )

    result = diagnostics.get_job("job-1")

    assert "private-value" not in result["data"]["error"]
    assert "[redacted" in result["data"]["error"]


def test_job_evidence_preserves_typed_authorization_metadata_without_bypassing_redaction(
    monkeypatch,
):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {
            "authorization_id": ARTIST_UID,
            "authorization_context": {
                "authorization_id": ARTIST_UID,
                "auth_token_value": "private-value",
            },
            "invalid_id": {"authorization_id": "private-value"},
            "invalid_context": {"authorization_context": "private-value"},
            "error": "password=prefix private-value\npublic=visible",
        },
    )

    result = diagnostics.get_job("job-1")["data"]

    assert result["authorization_id"] == ARTIST_UID
    assert result["authorization_context"] == {
        "authorization_id": ARTIST_UID,
        "auth_token_value": "[redacted]",
    }
    assert result["invalid_id"] == {"authorization_id": "[redacted]"}
    assert result["invalid_context"] == {"authorization_context": "[redacted]"}
    assert "private-value" not in json.dumps(result)
    assert "public=visible" not in result["error"]


@pytest.mark.parametrize("prefix", ["x", "é"])
def test_oversized_evidence_text_is_omitted_before_sanitization(monkeypatch, prefix):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {"id": "job-1", "error": prefix * 100000 + " private-value"},
    )

    result = diagnostics.get_job("job-1")["data"]

    assert result["id"] == "job-1"
    assert result["error"] == "[redacted-oversized-text]"
    assert "private-value" not in json.dumps(result)


@pytest.mark.parametrize("artist_uid", [0, 1, True, False, [], {}, [ARTIST_UID], 1.5])
def test_artist_inspection_rejects_nontext_identity_before_database_access(
    monkeypatch, artist_uid
):
    monkeypatch.setattr(
        diagnostics.agent_library,
        "read_artist_evidence",
        lambda **_kwargs: pytest.fail("Invalid artist identity reached the database"),
    )

    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.inspect_artist(artist_uid=artist_uid)

    assert caught.value.code == "INVALID_ARGUMENT"


@pytest.mark.parametrize("key", ["token_count", "input_tokens", "output_tokens"])
def test_credential_counters_preserve_only_nonnegative_integers(monkeypatch, key):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_job",
        lambda _job_id: {
            "counts": {key: 3},
            "zero": {key: 0},
            "untrusted": {key: "private-value"},
            "nested": {key: ["private-value"]},
            "boolean": {key: True},
            "negative": {key: -1},
            "float": {key: 3.0},
            "empty": {key: None},
            "error": f'{key}=3; secret_key="private-value"',
            "continuation": f"{key}=3\n  private-value",
        },
    )

    result = diagnostics.get_job("job-1")["data"]

    assert result["counts"] == {key: 3}
    assert result["zero"] == {key: 0}
    for field in ("untrusted", "nested", "boolean", "negative", "float", "empty"):
        assert result[field] == {key: "[redacted]"}
    assert f"{key}=3" in result["error"]
    assert "private-value" not in json.dumps(result)


_LIMIT_OPERATIONS = [
    ("list_library_issues", {}),
    ("inspect_artist", {"artist_uid": ARTIST_UID}),
    ("list_jobs", {}),
    ("read_audit", {}),
    ("read_diagnostics", {"source": "worker_logs"}),
    ("read_diagnostics", {"source": "worker_status"}),
    ("read_diagnostics", {"source": "analysis_status"}),
    (
        "read_diagnostics",
        {"source": "metric_series", "series": "worker.task.duration"},
    ),
]


@pytest.mark.parametrize(
    "operation,arguments",
    [
        ("list_jobs", {"types": 1}),
        ("list_jobs", {"types": False}),
        ("list_jobs", {"types": "retry"}),
        ("list_jobs", {"types": ("retry",)}),
        ("list_jobs", {"types": [["retry"]]}),
        ("list_jobs", {"types": [{}]}),
        ("list_jobs", {"types": [None]}),
        ("list_jobs", {"types": [True]}),
        ("list_jobs", {"states": 1}),
        ("list_jobs", {"states": False}),
        ("list_jobs", {"states": "running"}),
        ("list_jobs", {"states": [["running"]]}),
        ("list_jobs", {"states": [{}]}),
        ("list_jobs", {"states": [None]}),
        ("list_jobs", {"states": ["running", 1]}),
        ("read_diagnostics", {"source": ["worker_logs"]}),
        ("read_diagnostics", {"source": {}}),
        ("read_diagnostics", {"source": None}),
        ("read_diagnostics", {"source": True}),
        (
            "read_diagnostics",
            {"source": "metric_series", "series": ["worker.queue.wait"]},
        ),
        ("read_diagnostics", {"source": "metric_series", "series": {}}),
        ("read_diagnostics", {"source": "metric_series", "series": None}),
        ("read_diagnostics", {"source": "metric_series", "series": True}),
    ],
)
def test_malformed_diagnostic_filter_types_are_rejected_before_reads(
    monkeypatch, operation, arguments
):
    def forbidden_read(*_args, **_kwargs):
        pytest.fail("Malformed filters reached an evidence source")

    monkeypatch.setattr(diagnostics.agent_operations, "read_jobs", forbidden_read)
    monkeypatch.setattr(
        diagnostics.agent_operations, "read_status_evidence", forbidden_read
    )
    monkeypatch.setattr("crate.metrics.query_recent", forbidden_read)

    with pytest.raises(diagnostics.DiagnosticError) as caught:
        getattr(diagnostics, operation)(**arguments)

    assert caught.value.code == "INVALID_ARGUMENT"


@pytest.mark.parametrize("operation,arguments", _LIMIT_OPERATIONS)
@pytest.mark.parametrize("limit", [0, -1, 101, 1000000, True, False, 20.0, "20", None])
def test_application_limits_are_rejected_before_any_evidence_read(
    monkeypatch, operation, arguments, limit
):
    def forbidden_read(*_args, **_kwargs):
        pytest.fail("Invalid limit reached an evidence source")

    for module, names in (
        (diagnostics.agent_library, ("read_health_snapshot", "read_artist_evidence")),
        (
            diagnostics.agent_operations,
            (
                "read_jobs",
                "read_audit_rows",
                "read_worker_logs",
                "read_status_evidence",
            ),
        ),
    ):
        for name in names:
            monkeypatch.setattr(module, name, forbidden_read)
    monkeypatch.setattr("crate.metrics.query_recent", forbidden_read)

    with pytest.raises(diagnostics.DiagnosticError) as caught:
        getattr(diagnostics, operation)(limit=limit, **arguments)

    assert caught.value.code == "INVALID_ARGUMENT"


@pytest.mark.parametrize("operation,arguments", _LIMIT_OPERATIONS)
@pytest.mark.parametrize("limit", [1, 100])
def test_application_limit_boundaries_preserve_the_requested_page_size(
    monkeypatch, operation, arguments, limit
):
    calls = []

    def reader(name, result):
        def read(*_args, **kwargs):
            calls.append((name, kwargs))
            return result

        return read

    issues = [issue(1), issue(2)]
    rows = [{"id": n, "created_at": str(NOW), "timestamp": str(NOW)} for n in (1, 2)]
    sources = (
        (diagnostics.agent_library, "read_health_snapshot", snapshot(issues=issues)),
        (
            diagnostics.agent_library,
            "read_artist_evidence",
            {"artists": [{"entity_uid": ARTIST_UID}], "issues": issues},
        ),
        (diagnostics.agent_operations, "read_jobs", rows),
        (diagnostics.agent_operations, "read_audit_rows", rows),
        (diagnostics.agent_operations, "read_worker_logs", rows),
        (diagnostics.agent_operations, "read_status_evidence", {"runtime": []}),
    )
    for module, name, result in sources:
        monkeypatch.setattr(module, name, reader(name, result))
    monkeypatch.setattr("crate.metrics.query_recent", reader("query_recent", rows))

    result = getattr(diagnostics, operation)(limit=limit, **arguments)

    assert len(calls) == 1
    if "limit" in calls[0][1]:
        assert calls[0][1]["limit"] == limit + 1
    if arguments.get("source") not in {"worker_status", "analysis_status"}:
        assert result["returned_count"] == min(limit, 2)


@pytest.mark.parametrize(
    "count,limit,payload_size,truncated",
    [
        pytest.param(30, 20, 0, True, id="row-limit"),
        pytest.param(3, 20, 0, False, id="sparse-window"),
        pytest.param(0, 20, 0, False, id="empty-window"),
        pytest.param(30, 30, 0, False, id="complete-window"),
        pytest.param(30, 30, 1900, True, id="byte-budget"),
    ],
)
def test_metric_truncation_reflects_omitted_samples(
    monkeypatch, count, limit, payload_size, truncated
):
    samples = [
        {"timestamp": str(NOW - timedelta(minutes=30 - n)), "label": "x" * payload_size}
        for n in range(count)
    ]
    monkeypatch.setattr("crate.metrics.query_recent", lambda *_args, **_kwargs: samples)

    result = diagnostics.read_diagnostics(
        source="metric_series", series="worker.task.duration", minutes=30, limit=limit
    )

    assert result["truncated"] is truncated
    assert result["returned_count"] == len(result["data"]["samples"])
    assert (result["returned_count"] < len(samples)) is truncated
    if payload_size == 0:
        assert result["data"]["samples"] == samples[-limit:]
    if count:
        assert result["observed_at"] == result["data"]["samples"][-1]["timestamp"]
    else:
        assert result["availability"] == "unavailable"


@pytest.mark.parametrize(
    "field,value",
    [
        ("before", None),
        ("before", []),
        ("before", "invalid"),
        ("before", {"timestamp": str(NOW), "id": 2}),
        ("before", [str(NOW)]),
        ("before", [str(NOW), 2, 3]),
        ("before", ["invalid-date", 2]),
        ("before", [None, 2]),
        ("before", [str(NOW), "invalid-id"]),
        ("before", [str(NOW), {"id": 2}]),
        ("before", [str(NOW), True]),
        ("before", [str(NOW), 2.5]),
        ("before", [str(NOW), 0]),
        ("before", [str(NOW), 2**31]),
        ("window", None),
        ("window", []),
        ("window", {}),
        ("window", {"since": str(NOW)}),
    ],
)
def test_malformed_audit_cursor_is_rejected_before_database_access(
    monkeypatch, field, value
):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_audit_rows",
        lambda **_kwargs: [{"id": 2, "timestamp": NOW}, {"id": 1, "timestamp": NOW}],
    )
    cursor = diagnostics.read_audit(limit=1)["next_cursor"]
    decoded = json.loads(base64.urlsafe_b64decode(cursor))
    decoded[field] = value
    malformed = base64.urlsafe_b64encode(json.dumps(decoded).encode()).decode()
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_audit_rows",
        lambda **_kwargs: pytest.fail("Malformed cursor reached the database"),
    )

    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.read_audit(limit=1, cursor=malformed)

    assert caught.value.code == "INVALID_ARGUMENT"


def test_unicode_log_messages_and_response_are_byte_bounded(monkeypatch):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_worker_logs",
        lambda **_kwargs: [
            {"id": number, "message": "é🎵" * 1000, "created_at": NOW}
            for number in range(101)
        ],
    )
    result = diagnostics.read_diagnostics(source="worker_logs", limit=100)
    assert 0 < result["returned_count"] < 100
    assert result["truncated"] is True
    assert len(json.dumps(result, ensure_ascii=False).encode("utf-8")) <= 65536
    assert all(len(row["message"].encode("utf-8")) <= 2048 for row in result["data"])
    assert "untrusted data" in result["interpretation"]


@pytest.mark.parametrize(
    "since,until",
    [
        (NOW - timedelta(hours=25), NOW),
        (NOW, NOW - timedelta(hours=1)),
        (NOW, NOW + timedelta(hours=1)),
    ],
)
def test_invalid_log_time_windows_never_reach_database(monkeypatch, since, until):
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_worker_logs",
        lambda **_kwargs: pytest.fail("DB reached"),
    )
    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.read_diagnostics(source="worker_logs", since=since, until=until)
    assert caught.value.code == "INVALID_ARGUMENT"


def test_runtime_diagnostic_sources_preserve_the_original_observation(monkeypatch):
    observed = NOW - timedelta(minutes=5)
    monkeypatch.setattr(
        diagnostics.agent_operations,
        "read_status_evidence",
        lambda: {
            "runtime": [
                {
                    "key": "analysis_status",
                    "updated_at": observed,
                    "payload_json": {
                        "analysis_done": 0,
                        "path": "/secret",
                        "token": "private",
                    },
                }
            ],
        },
    )
    result = diagnostics.read_diagnostics(source="analysis_status")
    assert result["availability"] == "stale"
    assert result["observed_at"] == str(observed)
    assert result["data"]["analysis_done"] == 0
    assert result["data"]["analysis_pending"] is None
    assert "path" not in result["data"]
    assert "token" not in result["data"]
    assert (
        diagnostics.read_diagnostics(source="worker_status")["availability"]
        == "unavailable"
    )


def test_missing_snapshot_does_not_scan_files_or_start_work(monkeypatch):
    from crate.db import admin_health_surface, ops_snapshot, ui_snapshot_writes
    from crate.db.repositories import tasks

    def forbidden(*_args, **_kwargs):
        pytest.fail("A diagnostic read initiated work")

    monkeypatch.setattr(diagnostics.agent_library, "read_health_snapshot", lambda: None)
    monkeypatch.setattr(diagnostics.agent_operations, "read_status_evidence", dict)
    monkeypatch.setattr(admin_health_surface, "get_cached_health_surface", forbidden)
    monkeypatch.setattr(ops_snapshot, "get_cached_ops_snapshot", forbidden)
    monkeypatch.setattr(ui_snapshot_writes, "upsert_ui_snapshot", forbidden)
    monkeypatch.setattr(tasks, "create_task", forbidden)
    monkeypatch.setattr(Path, "rglob", forbidden)
    monkeypatch.setattr(Path, "glob", forbidden)
    monkeypatch.setattr(Path, "iterdir", forbidden)
    monkeypatch.setattr(httpx.Client, "send", forbidden)
    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    assert diagnostics.list_library_issues()["availability"] == "unavailable"
    assert diagnostics.get_instance_status()["availability"] == "unavailable"
