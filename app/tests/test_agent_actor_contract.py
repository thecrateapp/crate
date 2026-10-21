"""The real actor preserves persisted machine-command outcomes and verification."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from crate.db.queries.tasks import get_task
from crate.db.repositories import agent_requests
from crate.db.repositories.agent_credentials import revoke_credential
from crate.db.repositories.agent_repair_plans import preview_repair

from tests.agent_command_fixtures import UID, scalar

pytest_plugins = ["tests.agent_command_fixtures"]


@pytest.fixture
def actor_boundary(command_world, monkeypatch):
    from crate import actors

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr("crate.config.load_config", lambda: command_world["config"])
    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task",
        lambda *_args, **_kwargs: SimpleNamespace(allowed=True),
    )
    monkeypatch.setattr("crate.resource_governor.record_decision", Mock())
    monkeypatch.setattr("crate.metrics.record", Mock())
    monkeypatch.setattr("crate.observability.sentry.capture_task_failure", Mock())
    monkeypatch.setattr(actors, "_heartbeat_loop", Mock())
    monkeypatch.setattr(actors, "_check_memory", Mock())
    monkeypatch.setattr(actors, "_acquire_db_heavy_lock", Mock(return_value=True))
    monkeypatch.setattr(actors, "_release_db_heavy_lock", Mock())
    failed, completed, published = Mock(), Mock(), Mock()
    monkeypatch.setattr("crate.telegram.notify_task_failed", failed)
    monkeypatch.setattr("crate.telegram.notify_task_completed", completed)
    monkeypatch.setattr("crate.db.events._publish_to_redis", published)
    return actors, command_world, failed, completed, published


def _persisted_result(job_id):
    return scalar("SELECT result FROM agent_jobs WHERE task_id = :id", {"id": job_id})


def test_actor_preserves_revoked_agent_job_as_failed(actor_boundary):
    actors, world, failed, completed, published = actor_boundary
    principal = world["principal"]
    accepted = agent_requests.accept_health_check(principal, UID, "revoke-before-run")
    job_id = accepted["job_id"]
    revoke_credential(principal.credential_id)

    actors._execute_task("health_check", job_id)

    task = get_task(job_id)
    assert task["status"] == "failed"
    assert task["result"] == _persisted_result(job_id)
    assert task["result"]["execution"]["status"] == "failed"
    assert task["result"]["execution"]["error_code"] == "FORBIDDEN"
    assert scalar("SELECT COUNT(*) FROM agent_photo_observations") == 0
    assert (
        scalar(
            "SELECT has_photo FROM library_artists WHERE entity_uid = :uid",
            {"uid": UID},
        )
        == 0
    )
    failed.assert_called_once()
    completed.assert_not_called()
    events = [
        args.args[2] for args in published.call_args_list if args.args[1] == "task_done"
    ]
    assert [event["status"] for event in events] == ["failed"]


@pytest.mark.parametrize("change_photo", [False, True])
def test_actor_preserves_exact_repair_outcome_after_real_worker_execution(
    actor_boundary, change_photo
):
    actors, world, failed, completed, published = actor_boundary
    principal = world["principal"]
    check = agent_requests.accept_health_check(principal, UID, "check-before-repair")
    actors._execute_task("health_check", check["job_id"])
    health = get_task(check["job_id"])
    assert health["status"] == "completed"
    assert health["result"]["execution"]["status"] == "completed"
    plan = preview_repair(principal, health["result"]["execution"]["issue_id"])
    accepted = agent_requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "apply-exact-plan"
    )
    job_id = accepted["job_id"]
    if change_photo:
        (world["folder"] / "artist.jpg").write_bytes(b"changed after preview")
    failed.reset_mock()
    completed.reset_mock()
    published.reset_mock()

    actors._execute_task("repair", job_id)

    task = get_task(job_id)
    expected_status = "failed" if change_photo else "completed"
    assert task["status"] == expected_status
    assert task["result"] == _persisted_result(job_id)
    assert task["result"]["execution"]["status"] == (
        "conflict" if change_photo else "applied"
    )
    assert scalar(
        "SELECT has_photo FROM library_artists WHERE entity_uid = :uid", {"uid": UID}
    ) == (0 if change_photo else 1)
    if change_photo:
        assert task["result"]["execution"]["error_code"] == "PLAN_STALE"
        failed.assert_called_once()
        completed.assert_not_called()
    else:
        assert task["result"]["verification"]["status"] == "verified"
        completed.assert_called_once()
        failed.assert_not_called()
    events = [
        args.args[2] for args in published.call_args_list if args.args[1] == "task_done"
    ]
    assert [event["status"] for event in events] == [expected_status]

    actors._execute_task("repair", job_id)
    assert get_task(job_id)["status"] == expected_status
    assert get_task(job_id)["result"] == task["result"]
