"""Diagnostic decisions preserve evidence age, identity and bounded output."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from crate import agent_diagnostics as diagnostics
from crate.agent_access import AgentPrincipal

NOW = datetime(2026, 10, 16, 12, tzinfo=UTC)
ARTIST_UID = "10000000-0000-0000-0000-000000000001"


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
