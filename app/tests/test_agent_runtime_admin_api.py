"""Admin runtime changes share the same persisted CAS as MCP plans."""

from datetime import datetime
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from crate import agent_runtime
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import runtime_policy
from crate.db.tx import read_scope
from crate.runtime_policy_contract import default_runtime_policy, download_policy_status
from sqlalchemy import text


@pytest.mark.parametrize("path", ["/api/worker/schedules", "/api/settings/schedules"])
@pytest.mark.parametrize("versioned", [False, True])
def test_admin_schedule_updates_accept_legacy_and_revisioned_payloads(
    pg_db, test_app, path, versioned
):
    initial = runtime_policy.read_schedules_state()
    patch = {"compute_analytics": 900}
    body = (
        {"schedules": patch, "expected_revision": initial["revision"]}
        if versioned
        else patch
    )
    response = test_app.request(
        "POST" if path.startswith("/api/worker") else "PUT", path, json=body
    )
    assert response.status_code == 200, response.text
    state = runtime_policy.read_schedules_state()
    assert state["schedules"]["compute_analytics"] == 900
    assert state["revision"] != initial["revision"]


@pytest.mark.parametrize("path", ["/api/worker/schedules", "/api/settings/schedules"])
@pytest.mark.parametrize(
    "patch",
    [
        {"unknown_actor": 1},
        {"compute_analytics": True},
        {"compute_analytics": 0.5},
        {"compute_analytics": "900"},
        {"compute_analytics": -1},
        {"compute_analytics": 31 * 86400 + 1},
    ],
)
def test_admin_schedule_updates_reject_unbounded_or_untyped_values(
    pg_db, test_app, path, patch
):
    initial = runtime_policy.read_schedules_state()
    response = test_app.request(
        "POST" if path.startswith("/api/worker") else "PUT", path, json=patch
    )
    assert response.status_code == 422, response.text
    assert runtime_policy.read_schedules_state()["revision"] == initial["revision"]


@pytest.mark.parametrize("path", ["/api/worker/schedules", "/api/settings/schedules"])
def test_admin_schedule_compare_and_swap_conflicts_with_another_writer(
    pg_db, test_app, path
):
    initial = runtime_policy.read_schedules_state()
    runtime_policy.update_schedules(
        {"sync_shows": 600}, expected_revision=initial["revision"]
    )
    response = test_app.request(
        "POST" if path.startswith("/api/worker") else "PUT",
        path,
        json={
            "schedules": {"compute_analytics": 900},
            "expected_revision": initial["revision"],
        },
    )
    assert response.status_code == 409, response.text
    assert (
        runtime_policy.read_schedules_state()["schedules"]["compute_analytics"]
        == initial["schedules"]["compute_analytics"]
    )


def test_admin_schedule_get_is_pure_and_exposes_enqueue_and_success_separately(
    pg_db, test_app
):
    initial = runtime_policy.read_schedules_state()
    response = test_app.get("/api/worker/schedules")
    assert response.status_code == 200, response.text
    analytics = response.json()["compute_analytics"]
    assert analytics["revision"] == initial["revision"]
    assert analytics["last_enqueued_at"] is None
    assert analytics["last_succeeded_at"] is None
    assert runtime_policy.read_schedules_state()["revision"] == initial["revision"]


def test_admin_schedule_update_invalidates_exact_mcp_plan(pg_db, test_app):
    initial = runtime_policy.read_schedules_state()
    plan = agent_runtime.compile_operation(
        "schedule_update",
        {
            "schedule": "compute_analytics",
            "interval_seconds": 900,
            "expected_revision": initial["revision"],
        },
        {},
    )
    response = test_app.post("/api/worker/schedules", json={"sync_shows": 600})
    assert response.status_code == 200, response.text
    with pytest.raises(DiagnosticError) as conflict:
        agent_runtime.apply_operation(
            "schedule_update",
            plan["execution"],
            {},
            task_id="stale-admin-schedule",
            authorize=lambda effect: effect(),
        )
    assert conflict.value.code == "PLAN_STALE"


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/worker/slots", {"slots": 5, "expected_revision": 0}),
        ("/api/settings/worker", {"max_workers": 5, "expected_revision": 0}),
    ],
)
def test_admin_slot_changes_enforce_admission_and_clamp_pool_caps(
    pg_db, test_app, path, body
):
    response = test_app.request(
        "POST" if path.startswith("/api/worker") else "PUT", path, json=body
    )
    assert response.status_code == 200, response.text
    policy = runtime_policy.read_runtime_policy_state()
    assert policy["configured_revision"] == 1
    assert policy["policy"]["max_running"] == 5
    assert all(value <= 5 for value in policy["policy"]["pools"].values())
    assert policy["effective_revision"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"slots": 0},
        {"slots": 65},
        {"slots": True},
        {"slots": "5"},
        {"slots": 1.5},
        {"slots": 5, "force": True},
    ],
)
def test_admin_slots_reject_invalid_values_without_updating_policy(
    pg_db, test_app, body
):
    response = test_app.post("/api/worker/slots", json=body)
    assert response.status_code == 422, response.text
    assert runtime_policy.read_runtime_policy_state()["configured_revision"] == 0


def test_admin_slot_change_invalidates_runtime_plan_and_reports_pending_adoption(
    pg_db, test_app
):
    plan = agent_runtime.compile_operation(
        "runtime_update", {"expected_revision": 0, "patch": {"pools": {"heavy": 2}}}, {}
    )
    response = test_app.post("/api/worker/slots", json={"slots": 4})
    assert response.status_code == 200, response.text
    assert response.json()["max_slots"] == 4
    assert response.json()["min_slots"] == 1
    assert response.json()["configured_revision"] == 1
    assert response.json()["effective_revision"] is None
    with pytest.raises(DiagnosticError) as conflict:
        agent_runtime.apply_operation(
            "runtime_update",
            plan["execution"],
            {},
            task_id="stale-admin-runtime",
            authorize=lambda effect: effect(),
        )
    assert conflict.value.code == "PLAN_STALE"


def test_admin_slots_reject_stale_revision(pg_db, test_app):
    runtime_policy.update_runtime_policy({"pools": {"heavy": 2}}, expected_revision=0)
    response = test_app.post(
        "/api/worker/slots", json={"slots": 4, "expected_revision": 0}
    )
    assert response.status_code == 409, response.text
    assert runtime_policy.read_runtime_policy_state()["configured_revision"] == 1


@pytest.mark.parametrize(
    ("path", "method", "body", "guard"),
    [
        (
            "/api/worker/slots",
            "POST",
            {"slots": 5},
            "crate.api.tasks.require_permission",
        ),
        (
            "/api/worker/schedules",
            "POST",
            {"compute_analytics": 900},
            "crate.api.tasks.require_permission",
        ),
        (
            "/api/settings/worker",
            "PUT",
            {"max_workers": 5},
            "crate.api.settings.require_permission",
        ),
        (
            "/api/settings/schedules",
            "PUT",
            {"compute_analytics": 900},
            "crate.api.settings.require_permission",
        ),
        (
            "/api/admin/download-policy",
            "PUT",
            {"max_active_users": 2},
            "crate.api.admin_metrics.require_permission",
        ),
    ],
)
def test_admin_runtime_mutations_require_existing_human_capability(
    pg_db, test_app, monkeypatch, path, method, body, guard
):
    monkeypatch.setattr(
        guard, Mock(side_effect=HTTPException(status_code=403, detail="forbidden"))
    )
    response = test_app.request(method, path, json=body)
    assert response.status_code == 403
    assert runtime_policy.read_runtime_policy_state()["configured_revision"] == 0


@pytest.mark.parametrize(
    "body",
    [
        {"window_start": "24:00"},
        {"window_start": "24:00", "max_active_users": 2},
        {"window_end": "02:60"},
        {"window_start": "2:00"},
        {"window_timezone": "Europe/Unknown"},
        {"max_active_users": -1},
        {"max_active_streams": True},
        {"max_active_users": "2"},
        {"window_enabled": "true"},
        {"expected_revision": True},
        {"force": True},
    ],
)
def test_admin_download_policy_rejects_invalid_fields_atomically(pg_db, test_app, body):
    response = test_app.put("/api/admin/download-policy", json=body)
    assert response.status_code == 422, response.text
    assert runtime_policy.read_runtime_policy_state()["configured_revision"] == 0
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM settings WHERE key LIKE 'download_%'")
            ).scalar_one()
            == 0
        )


def test_admin_download_policy_persists_one_revision_and_respects_cas(pg_db, test_app):
    response = test_app.put(
        "/api/admin/download-policy",
        json={
            "window_enabled": True,
            "window_start": "22:00",
            "window_end": "05:00",
            "window_timezone": "Europe/Madrid",
            "max_active_users": 2,
            "max_active_streams": 3,
            "expected_revision": 0,
        },
    )
    assert response.status_code == 200, response.text
    state = runtime_policy.read_runtime_policy_state()
    assert state["configured_revision"] == 1
    assert state["policy"]["download_window"] == {
        "enabled": True,
        "start": "22:00",
        "end": "05:00",
        "timezone": "Europe/Madrid",
    }
    assert state["policy"]["downloads"] == {
        "max_active_users": 2,
        "max_active_streams": 3,
    }
    response = test_app.put(
        "/api/admin/download-policy",
        json={"max_active_users": 1, "expected_revision": 0},
    )
    assert response.status_code == 409, response.text
    assert runtime_policy.read_runtime_policy_state()["configured_revision"] == 1


def test_admin_download_policy_get_never_records_consumer_adoption(
    pg_db, test_app, monkeypatch
):
    from crate import actors

    runtime_policy.update_runtime_policy(
        {"downloads": {"max_active_users": 2}}, expected_revision=0
    )
    monkeypatch.setattr(actors, "_count_active_users", lambda: 0)
    monkeypatch.setattr(actors, "_count_active_streams", lambda: 0)
    monkeypatch.setattr(actors, "get_suggested_download_limits", lambda: {})
    response = test_app.get("/api/admin/download-policy")
    assert response.status_code == 200, response.text
    assert response.json()["user_limit"]["max"] == 2
    assert response.json()["configured_revision"] == 1
    assert runtime_policy.read_runtime_policy_state()["adoptions"] == []


@pytest.mark.parametrize(
    ("users", "streams", "allowed"), [(1, 2, True), (2, 0, False), (0, 3, False)]
)
def test_download_worker_uses_revisioned_limits_before_acknowledging_adoption(
    pg_db, monkeypatch, users, streams, allowed
):
    from crate import actors, runtime_policy_contract
    from crate.db.cache_settings import set_setting

    state = runtime_policy.update_runtime_policy(
        {
            "downloads": {"max_active_users": 2, "max_active_streams": 3},
            "download_window": {
                "enabled": True,
                "start": "22:00",
                "end": "05:00",
                "timezone": "UTC",
            },
        },
        expected_revision=0,
    )
    set_setting("download_max_active_users", "999")
    set_setting("download_max_active_streams", "999")
    order = []
    actual_status = runtime_policy_contract.download_policy_status
    actual_ack = runtime_policy.record_runtime_adoption

    def evaluate(policy, **kwargs):
        order.append("evaluate")
        assert policy == state["policy"]
        return actual_status(
            policy, now=datetime.fromisoformat("2026-10-16T23:00:00+00:00"), **kwargs
        )

    def acknowledge(component, revision, fingerprint):
        order.append("ack")
        assert order == ["users", "streams", "evaluate", "ack"]
        assert (component, revision, fingerprint) == (
            "download_window",
            1,
            state["policy_hash"],
        )
        actual_ack(component, revision, fingerprint, consumer_id="downloads-test")

    monkeypatch.setattr(
        actors, "_count_active_users", lambda: (order.append("users"), users)[1]
    )
    monkeypatch.setattr(
        actors, "_count_active_streams", lambda: (order.append("streams"), streams)[1]
    )
    monkeypatch.setattr(runtime_policy_contract, "download_policy_status", evaluate)
    monkeypatch.setattr(runtime_policy, "record_runtime_adoption", acknowledge)
    assert actors._is_download_allowed() is allowed
    assert order == ["users", "streams", "evaluate", "ack"]
    adoptions = runtime_policy.read_runtime_policy_state()["adoptions"]
    assert len(adoptions) == 1
    assert adoptions[0]["component"] == "download_window"
    assert adoptions[0]["revision"] == 1


def test_download_worker_defers_without_policy_or_adoption_evidence(monkeypatch):
    from crate import actors

    ack = Mock()
    monkeypatch.setattr(
        runtime_policy,
        "read_runtime_policy_state",
        Mock(side_effect=RuntimeError("database unavailable")),
    )
    monkeypatch.setattr(runtime_policy, "record_runtime_adoption", ack)
    assert actors._is_download_allowed() is False
    assert actors._is_in_time_window() is False
    assert actors._ms_until_download_window() == actors.DOWNLOAD_WINDOW_RETRY_MS
    ack.assert_not_called()


def test_download_worker_defers_when_used_revision_cannot_be_acknowledged(monkeypatch):
    from crate import actors

    monkeypatch.setattr(
        runtime_policy,
        "read_runtime_policy_state",
        lambda **kwargs: {
            "policy": default_runtime_policy(),
            "configured_revision": 3,
            "policy_hash": "a" * 64,
        },
    )
    monkeypatch.setattr(
        runtime_policy,
        "record_runtime_adoption",
        Mock(side_effect=RuntimeError("cannot record adoption")),
    )
    monkeypatch.setattr(actors, "_count_active_users", lambda: 0)
    monkeypatch.setattr(actors, "_count_active_streams", lambda: 0)
    assert actors._is_download_allowed() is False


@pytest.mark.parametrize(
    "query_name,counter_name",
    [
        ("count_recent_active_users", "_count_active_users"),
        ("count_recent_streams", "_count_active_streams"),
    ],
)
@pytest.mark.parametrize("limits_enabled", [False, True])
def test_download_activity_query_timeout_remains_unknown_and_blocks_required_limits(
    monkeypatch, query_name, counter_name, limits_enabled
):
    from crate import actors

    policy = default_runtime_policy()
    policy["downloads"] = {
        "max_active_users": 1 if limits_enabled else 0,
        "max_active_streams": 1 if limits_enabled else 0,
    }
    for name in ("count_recent_active_users", "count_recent_streams"):
        monkeypatch.setattr(
            f"crate.db.queries.management.{name}",
            Mock(side_effect=TimeoutError("activity query timed out"))
            if name == query_name
            else Mock(return_value=0),
        )
    monkeypatch.setattr(
        runtime_policy,
        "read_runtime_policy_state",
        lambda **_kwargs: {
            "policy": policy,
            "configured_revision": 3,
            "policy_hash": "a" * 64,
        },
    )
    acknowledge = Mock()
    monkeypatch.setattr(runtime_policy, "record_runtime_adoption", acknowledge)

    assert getattr(actors, counter_name)() is None
    assert actors._is_download_allowed() is (not limits_enabled)
    if limits_enabled:
        acknowledge.assert_not_called()
    else:
        acknowledge.assert_called_once_with("download_window", 3, "a" * 64)


def test_download_worker_window_reads_use_iana_timezone_without_ack(pg_db, monkeypatch):
    from crate import actors, runtime_policy_contract

    runtime_policy.update_runtime_policy(
        {
            "download_window": {
                "enabled": True,
                "start": "22:00",
                "end": "02:00",
                "timezone": "Europe/Madrid",
            }
        },
        expected_revision=0,
    )
    actual = runtime_policy_contract.window_status
    monkeypatch.setattr(
        runtime_policy_contract,
        "window_status",
        lambda window: actual(
            window, now=datetime.fromisoformat("2026-10-16T19:59:30+00:00")
        ),
    )
    assert actors._is_in_time_window() is False
    assert actors._ms_until_download_window() == 30000
    assert runtime_policy.read_runtime_policy_state()["adoptions"] == []


def test_download_status_is_pure_and_evaluates_all_configured_conditions():
    policy = default_runtime_policy()
    policy["download_window"] = {
        "enabled": True,
        "start": "22:00",
        "end": "02:00",
        "timezone": "Europe/Madrid",
    }
    policy["downloads"] = {"max_active_users": 2, "max_active_streams": 3}
    inside = datetime.fromisoformat("2026-10-16T20:00:00+00:00")
    assert (
        download_policy_status(policy, active_users=1, active_streams=2, now=inside)[
            "downloads_allowed_now"
        ]
        is True
    )
    assert (
        download_policy_status(policy, active_users=2, active_streams=0, now=inside)[
            "downloads_allowed_now"
        ]
        is False
    )
    assert (
        download_policy_status(policy, active_users=0, active_streams=3, now=inside)[
            "downloads_allowed_now"
        ]
        is False
    )
    assert (
        download_policy_status(
            policy,
            active_users=0,
            active_streams=0,
            now=datetime.fromisoformat("2026-10-16T12:00:00+00:00"),
        )["downloads_allowed_now"]
        is False
    )
