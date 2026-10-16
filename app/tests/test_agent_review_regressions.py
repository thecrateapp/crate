"""Regression coverage for diagnostic evidence and public input boundaries."""

import base64
import json
from datetime import UTC, date, timedelta
from decimal import Decimal
from html.parser import HTMLParser
from unittest.mock import Mock

import pytest
from crate import agent_diagnostics as diagnostics
from crate.artist_photo import observe_artist_photo
from crate.db.repositories import agent_requests as requests
from crate.db.repositories import mcp_oauth
from crate.db.repositories.tasks_updates import start_task
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.agent_command_fixtures import UID, change, observed_plan, scalar
from tests.agent_command_fixtures import command_world as command_world  # noqa: PLC0414 — pytest fixture registration.
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


@pytest.mark.parametrize(
    "key",
    [
        "access_token",
        "refreshToken",
        "client_secret",
        "Authorization",
        "Cookie",
        "password",
        "api-key",
    ],
)
@pytest.mark.parametrize("nested", [False, True])
def test_structured_credential_keys_are_redacted_before_job_evidence_leaves_server(
    monkeypatch, key, nested
):
    private = "opaqueCredentialWithoutRecognizablePrefix123"
    evidence = {
        "id": "job-1",
        "result": {
            "nested": [{key: {"value": private} if nested else private}],
            "credential_id": "12345678-1111-4444-9999-123456789abc",
            "accepted_scopes": ["library.health.read"],
        },
    }
    monkeypatch.setattr(diagnostics.agent_operations, "read_job", lambda _job: evidence)
    result = diagnostics.get_job("job-1")
    assert private not in json.dumps(result)
    assert (
        result["data"]["result"]["credential_id"] == evidence["result"]["credential_id"]
    )
    assert result["data"]["result"]["accepted_scopes"] == ["library.health.read"]


def _oversized_job():
    return {
        "id": "large-job",
        "created_at": NOW,
        "result": {f"evidence_{number}": "x" * 2048 for number in range(24)},
    }


def test_oversized_first_job_is_a_typed_error_instead_of_empty_success(monkeypatch):
    monkeypatch.setattr(
        diagnostics.agent_operations, "read_jobs", lambda **_kwargs: [_oversized_job()]
    )
    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.list_jobs(limit=1)
    assert caught.value.code == "RESPONSE_TOO_LARGE"


def test_oversized_next_job_cannot_repeat_the_same_pagination_position(monkeypatch):
    reader = Mock(
        side_effect=[
            [{"id": "small-job", "created_at": NOW}, _oversized_job()],
            [_oversized_job()],
        ]
    )
    monkeypatch.setattr(diagnostics.agent_operations, "read_jobs", reader)
    first = diagnostics.list_jobs(limit=2)
    assert first["returned_count"] == 1
    assert first["next_cursor"]
    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.list_jobs(limit=2, cursor=first["next_cursor"])
    assert caught.value.code == "RESPONSE_TOO_LARGE"


def test_library_issue_filter_normalizes_uuid_before_matching_snapshot(monkeypatch):
    uid = "abcdefab-cdef-4567-89ab-abcdefabcdef"
    reader = Mock(return_value=snapshot(issues=[issue(artist_uid=uid)]))
    monkeypatch.setattr(diagnostics.agent_library, "read_health_snapshot", reader)
    result = diagnostics.list_library_issues(artist_uid=uid.upper())
    assert result["returned_count"] == 1
    assert result["data"][0]["artist_uid"] == uid


@pytest.mark.parametrize("uid", ["not-a-uuid", "../Artist", 42, []])
def test_invalid_library_issue_uuid_fails_before_snapshot_read(monkeypatch, uid):
    reader = Mock(side_effect=AssertionError("Invalid identity reached persistence"))
    monkeypatch.setattr(diagnostics.agent_library, "read_health_snapshot", reader)
    with pytest.raises(diagnostics.DiagnosticError) as caught:
        diagnostics.list_library_issues(artist_uid=uid)
    assert caught.value.code == "INVALID_ARGUMENT"
    reader.assert_not_called()


@pytest.mark.parametrize("raw", [None, False, 42, [], {}, b"crate_mcp_at_bytes"])
def test_oauth_non_string_access_tokens_fail_closed_before_database(monkeypatch, raw):
    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "true")
    monkeypatch.setattr(
        mcp_oauth,
        "read_scope",
        Mock(side_effect=AssertionError("Invalid token reached persistence")),
    )
    assert mcp_oauth.resolve_oauth_access_token(raw) is None


class _ConsentInputs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields = {}
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        attributes = dict(attrs)
        if tag == "input":
            self.fields[attributes.get("name")] = attributes


@pytest.mark.parametrize("path", ["/oauth/authorize", "/oauth/connections"])
def test_oauth_consent_values_remain_html_data_in_both_forms(monkeypatch, path):
    from crate.api import mcp_oauth as routes

    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_OAUTH_ISSUER", "https://crate.example")
    monkeypatch.setattr(
        routes,
        "require_agent_admin_session",
        lambda _request: {
            "id": 1,
            "session_id": "session",
            "email": "admin@example.test",
        },
    )
    identifier = "id' autofocus onfocus='alert(1)"
    nonce = "nonce'><script>alert(2)</script><input value='"
    monkeypatch.setattr(
        routes.oauth,
        "prepare_consent",
        lambda *_args: (
            {"name": "Client", "accepted_scopes": ["library.health.read"]},
            identifier,
            nonce,
        ),
    )
    monkeypatch.setattr(
        mcp_oauth, "create_consent", lambda *_args, **_kwargs: (identifier, nonce)
    )
    monkeypatch.setattr(
        mcp_oauth,
        "list_oauth_authorizations",
        lambda *_args, **_kwargs: [
            {
                "id": "12345678-1111-4444-9999-123456789abc",
                "client_id": "client",
                "client_name": "Client",
                "revoked_at": None,
                "client_enabled": True,
                "principal_enabled": True,
                "scopes": ["library.health.read"],
                "created_at": NOW,
            }
        ],
    )
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app, base_url="https://crate.example") as client:
        response = client.get(path)
    assert response.status_code == 200
    parsed = _ConsentInputs()
    parsed.feed(response.text)
    assert parsed.fields["consent_id"] == {
        "type": "hidden",
        "name": "consent_id",
        "value": identifier,
    }
    assert parsed.fields["nonce"] == {"type": "hidden", "name": "nonce", "value": nonce}
    assert "script" not in parsed.tags


def _accepted_repair(world):
    _, plan = observed_plan(world)
    job = requests.accept_apply(
        world["principal"], plan["plan_id"], plan["plan_version"], "review-apply"
    )
    return job, plan


def _complete_repair(world, job):
    start_task(job["job_id"])
    requests.complete_photo_repair(
        job["job_id"], observe_artist_photo(world["config"], UID)
    )
    return requests.record_photo_verification(
        job["job_id"], observe_artist_photo(world["config"], UID)
    )


@pytest.mark.parametrize("purge", ["plan", "runtime"])
def test_accepted_apply_replay_survives_plan_or_runtime_retention(command_world, purge):
    job, plan = _accepted_repair(command_world)
    _complete_repair(command_world, job)
    if purge == "runtime":
        change("DELETE FROM tasks WHERE id=:id", {"id": job["job_id"]})
    change("DELETE FROM agent_repair_plans WHERE id=:id", {"id": plan["plan_id"]})
    if purge == "runtime":
        with pytest.raises(diagnostics.DiagnosticError) as error:
            requests.accept_apply(
                command_world["principal"],
                plan["plan_id"],
                plan["plan_version"],
                "review-apply",
            )
        assert error.value.code == "RESULT_EXPIRED"
    else:
        replay = requests.accept_apply(
            command_world["principal"],
            plan["plan_id"],
            plan["plan_version"],
            "review-apply",
        )
        assert replay["job_id"] == job["job_id"]
        assert replay["replayed"] is True
    assert (
        scalar("SELECT COUNT(*) FROM agent_requests WHERE operation='apply_repairs'")
        == 1
    )


def test_terminal_worker_redelivery_needs_no_retained_plan_or_second_effect(
    command_world,
):
    job, plan = _accepted_repair(command_world)
    result = _complete_repair(command_world, job)
    change("DELETE FROM agent_repair_plans WHERE id=:id", {"id": plan["plan_id"]})
    redelivered = requests.load_job_for_execution(job["job_id"])
    assert redelivered["result"] == result
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.repair.applied'")
        == 1
    )


@pytest.mark.parametrize("boundary", ["replay", "worker_redelivery"])
def test_retention_safe_replay_still_checks_current_authority(command_world, boundary):
    job, plan = _accepted_repair(command_world)
    _complete_repair(command_world, job)
    change("DELETE FROM agent_repair_plans WHERE id=:id", {"id": plan["plan_id"]})
    change("UPDATE agent_credentials SET revoked_at=NOW()")
    with pytest.raises(diagnostics.DiagnosticError) as error:
        if boundary == "replay":
            requests.accept_apply(
                command_world["principal"],
                plan["plan_id"],
                plan["plan_version"],
                "review-apply",
            )
        else:
            requests.load_job_for_execution(job["job_id"])
    assert error.value.code == "FORBIDDEN"


def test_terminal_apply_replay_preserves_result_after_policy_change(command_world):
    job, plan = _accepted_repair(command_world)
    result = _complete_repair(command_world, job)
    change("UPDATE agent_principals SET policy_revision=policy_revision+1")
    replay = requests.accept_apply(
        command_world["principal"],
        plan["plan_id"],
        plan["plan_version"],
        "review-apply",
    )
    assert replay["job_id"] == job["job_id"]
    assert replay["result"] == result
    assert replay["status"] == "completed"
    with pytest.raises(diagnostics.DiagnosticError) as error:
        requests.accept_apply(
            command_world["principal"],
            plan["plan_id"],
            plan["plan_version"],
            "new-request",
        )
    assert error.value.code == "PLAN_STALE"
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.repair.applied'")
        == 1
    )
