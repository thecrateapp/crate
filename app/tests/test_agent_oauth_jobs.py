"""Delegated authority survives persistence but never outlives its live grant."""

import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from threading import Event
from time import monotonic
from unittest.mock import Mock

import pytest

from crate import agent_maintenance as maintenance
from crate.agent_access import AgentPrincipal, authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.artist_photo import observe_artist_photo
from crate.db.repositories import agent_requests as requests
from crate.db.repositories import agent_integrations as integrations
from crate.db.repositories import mcp_oauth as oauth_store
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope, transaction_scope
from crate.mcp import tools
from sqlalchemy import text

from tests.agent_command_fixtures import UID, change, scalar
from tests.test_mcp_oauth_integration import _code, _exchange

pytest_plugins = ["tests.agent_command_fixtures", "tests.test_mcp_oauth_integration"]
SCOPES = {"library.health.read", "library.health.run", "library.repair.photo_flag"}


@pytest.fixture
def delegated_world(command_world, oauth_env, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    oauth_store.update_oauth_client("test-client", scopes=SCOPES)
    exchanged = _exchange(_code(oauth_env, scope=" ".join(sorted(SCOPES))))
    assert exchanged[0] == 200, exchanged
    token = exchanged[1]["access_token"]
    principal = oauth_store.resolve_oauth_access_token(token)[0]
    command_world["principal"] = principal
    command_world["access_token"] = token
    command_world["actor"] = oauth_env
    return command_world


def accepted_repair(world):
    principal = world["principal"]
    checked = maintenance.run_health_check(
        principal, artist_uid=UID, idempotency_key="oauth-health"
    )["data"]
    start_task(checked["job_id"])
    evidence = maintenance.execute_agent_job(checked["job_id"], world["config"])
    assert evidence["execution"]["status"] == "completed"
    plan = maintenance.preview_repairs(
        principal, issue_id=evidence["execution"]["issue_id"]
    )["data"]
    accepted = maintenance.apply_repairs(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="oauth-apply",
    )["data"]
    start_task(accepted["job_id"])
    return accepted, plan


def test_accepted_delegated_repair_executes_after_access_token_expiry(delegated_world):
    world = delegated_world
    principal = world["principal"]
    accepted, plan = accepted_repair(world)
    expected_context = authorization_context(principal)
    change(
        "UPDATE mcp_oauth_tokens SET expires_at=NOW()-INTERVAL '1 second' WHERE authorization_id=:id",
        {"id": principal.authorization_id},
    )
    assert oauth_store.resolve_oauth_access_token(world["access_token"]) is None

    loaded = requests.load_job_for_execution(accepted["job_id"])
    assert loaded["authorization_context"] == expected_context
    assert loaded["plan"]["authorization_context"] == expected_context
    assert loaded["payload"]["plan_id"] == plan["plan_id"]
    assert (
        scalar(
            "SELECT authorization_context FROM agent_jobs WHERE task_id=:id",
            {"id": accepted["job_id"]},
        )
        == expected_context
    )
    result = maintenance.execute_agent_job(accepted["job_id"], world["config"])

    assert result["execution"]["status"] == "applied"
    assert result["verification"]["status"] == "verified"
    assert (
        scalar(
            "SELECT has_photo FROM library_artists WHERE entity_uid=:id", {"id": UID}
        )
        == 1
    )
    assert (
        scalar(
            "SELECT details_json->>'authorization_id' FROM audit_log WHERE action='agent.repair.applied' AND target_name=:id",
            {"id": accepted["job_id"]},
        )
        == principal.authorization_id
    )


@pytest.mark.parametrize("mutation", ["grant_revocation", "actor_downgrade"])
@pytest.mark.parametrize("boundary", ["before_worker", "before_write"])
def test_delegated_authority_is_revalidated_before_worker_and_effect(
    delegated_world, monkeypatch, mutation, boundary
):
    world = delegated_world
    principal = world["principal"]
    accepted, _ = accepted_repair(world)
    loaded = requests.load_job_for_execution(accepted["job_id"])
    assert (
        loaded["authorization_context"]["authorization_id"]
        == principal.authorization_id
    )
    assert loaded["authorization_context"]["actor_user_id"] == world["actor"]["id"]
    observed_targets = []

    def revoke_authority():
        if mutation == "grant_revocation":
            oauth_store.revoke_oauth_authorization(principal.authorization_id)
        else:
            set_user_roles(world["actor"]["id"], ["user"])

    def observe(config, artist_uid):
        observed_targets.append(artist_uid)
        if boundary == "before_write":
            revoke_authority()
        return observe_artist_photo(config, artist_uid)

    monkeypatch.setattr("crate.artist_photo.observe_artist_photo", observe)
    if boundary == "before_worker":
        revoke_authority()
    result = maintenance.execute_agent_job(accepted["job_id"], world["config"])

    assert result["execution"]["status"] == "failed"
    assert result["execution"]["error_code"] == "FORBIDDEN"
    assert observed_targets == ([UID] if boundary == "before_write" else [])
    assert (
        scalar(
            "SELECT has_photo FROM library_artists WHERE entity_uid=:id", {"id": UID}
        )
        == 0
    )
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.repair.applied'")
        == 0
    )
    assert (
        scalar(
            "SELECT details_json->>'authorization_id' FROM audit_log WHERE action='agent.command.failed' AND target_name=:id",
            {"id": accepted["job_id"]},
        )
        == principal.authorization_id
    )


@pytest.fixture
def delegated_read_audit(monkeypatch):
    principal = AgentPrincipal(
        "principal",
        "credential",
        "Delegated reader",
        frozenset({"library.health.read"}),
        authorization_id="authorization",
        actor_user_id=14,
        client_id="remote-client",
        accepted_scopes=frozenset({"library.health.read"}),
    )
    audit = Mock()
    monkeypatch.setattr(tools, "admission", lambda _principal_id: nullcontext())
    monkeypatch.setattr(tools, "log_audit", audit)
    return principal, audit


def test_delegated_diagnostic_audit_retains_authority_and_exact_target_only(
    delegated_read_audit, monkeypatch
):
    principal, audit = delegated_read_audit
    operation = Mock(return_value={"data": {}})
    monkeypatch.setattr(tools.agent_diagnostics, "inspect_artist", operation)
    tools._execute(
        principal, "inspect_artist", {"artist_uid": UID, "limit": 10}, "trace-one"
    )

    audit.assert_called_once()
    assert audit.call_args.args == ("agent.diagnostic", "agent_principal", principal.id)
    assert audit.call_args.kwargs["details"] == {
        "principal_id": principal.id,
        "credential_id": principal.credential_id,
        "tool": "inspect_artist",
        "trace_id": "trace-one",
        "event": "accepted",
        "authorization_id": principal.authorization_id,
        "actor_user_id": 14,
        "client_id": "remote-client",
        "accepted_scopes": ["library.health.read"],
        "artist_uid": UID,
    }
    operation.assert_called_once_with(artist_uid=UID, limit=10, principal=principal)


def test_diagnostic_audit_does_not_record_freeform_lookup_arguments(
    delegated_read_audit, monkeypatch
):
    principal, audit = delegated_read_audit
    monkeypatch.setattr(
        tools.agent_diagnostics, "inspect_artist", Mock(return_value={"data": {}})
    )
    tools._execute(
        principal,
        "inspect_artist",
        {"name": "token=lookup-secret /private/artist", "limit": 10},
        "trace-two",
    )
    encoded = json.dumps(audit.call_args.kwargs)
    assert "lookup-secret" not in encoded and "/private/artist" not in encoded
    assert (
        "arguments" not in encoded and "name" not in audit.call_args.kwargs["details"]
    )
    assert "artist_uid" not in audit.call_args.kwargs["details"]


def test_invalid_artist_identifier_cannot_be_recorded_as_audit_target(
    delegated_read_audit,
):
    principal, audit = delegated_read_audit
    with pytest.raises(DiagnosticError) as caught:
        tools._execute(
            principal,
            "inspect_artist",
            {"artist_uid": "token=raw-secret"},
            "trace-three",
        )
    assert caught.value.code == "INVALID_ARGUMENT"
    details = [call.kwargs.get("details", {}) for call in audit.call_args_list]
    assert all("artist_uid" not in item for item in details)
    assert "raw-secret" not in json.dumps(details)


def test_admin_policy_change_and_own_delegated_effect_do_not_deadlock(
    delegated_world, monkeypatch
):
    world = delegated_world
    accepted, _ = accepted_repair(world)
    evidence = observe_artist_photo(world["config"], UID)
    human_locked, continue_human, worker_entered = Event(), Event(), Event()
    worker_pid = {}
    real_human_guard = integrations.require_agent_human_capabilities
    real_execution_job = requests._execution_job

    def pause_after_real_human_guard(*args, **kwargs):
        actor = real_human_guard(*args, **kwargs)
        if not human_locked.is_set():
            human_locked.set()
            assert continue_human.wait(15), (
                "The test did not release the human policy transaction"
            )
        return actor

    def record_worker_pid(current, task_id):
        worker_pid["value"] = current.execute(
            text("SELECT pg_backend_pid()")
        ).scalar_one()
        worker_entered.set()
        return real_execution_job(current, task_id)

    def apply_effect():
        try:
            return requests.complete_photo_repair(accepted["job_id"], evidence)
        except DiagnosticError as error:
            return {"error_code": error.code}

    monkeypatch.setattr(
        integrations, "require_agent_human_capabilities", pause_after_real_human_guard
    )
    monkeypatch.setattr(requests, "_execution_job", record_worker_pid)
    with ThreadPoolExecutor(max_workers=2) as pool:
        human = pool.submit(
            integrations.update_integration,
            world["actor"],
            world["principal"].id,
            expected_policy_revision=1,
            require_approval=True,
        )
        try:
            assert human_locked.wait(8), (
                "Admin never acquired its real human-session locks"
            )
            effect = pool.submit(apply_effect)
            assert worker_entered.wait(8)
            deadline = monotonic() + 8
            while not effect.done():
                with read_scope() as session:
                    waiting = session.execute(
                        text(
                            "SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"
                        ),
                        {"pid": worker_pid["value"]},
                    ).scalar_one_or_none()
                if waiting == "Lock":
                    break
                assert monotonic() < deadline, (
                    "Worker neither completed nor reached a PostgreSQL lock wait"
                )
                continue_human.wait(0.01)
        finally:
            continue_human.set()
        updated = human.result(timeout=10)
        outcome = effect.result(timeout=10)

    assert updated["policy_revision"] == 2 and updated["require_approval"] is True
    assert outcome.get("error_code") == "PLAN_STALE" or outcome.get(
        "execution", {}
    ).get("status") in {"applied", "already_satisfied"}


def test_revocation_waiting_for_an_authorized_worker_does_not_deadlock(
    delegated_world, monkeypatch
):
    world = delegated_world
    accepted, _ = accepted_repair(world)
    evidence = observe_artist_photo(world["config"], UID)
    worker_holds_credential, continue_worker, revocation_entered = (
        Event(),
        Event(),
        Event(),
    )
    revoke_pid = {}
    real_grants = oauth_store.delegated_authorization_grants

    def pause_before_real_grant_validation(*args, **kwargs):
        if not worker_holds_credential.is_set():
            worker_holds_credential.set()
            assert continue_worker.wait(15), (
                "The test did not release worker validation"
            )
        return real_grants(*args, **kwargs)

    def revoke():
        with transaction_scope() as session:
            revoke_pid["value"] = session.execute(
                text("SELECT pg_backend_pid()")
            ).scalar_one()
            revocation_entered.set()
            oauth_store.revoke_oauth_authorization(
                world["principal"].authorization_id, session=session
            )

    monkeypatch.setattr(
        oauth_store,
        "delegated_authorization_grants",
        pause_before_real_grant_validation,
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        effect = pool.submit(
            requests.complete_photo_repair, accepted["job_id"], evidence
        )
        try:
            assert worker_holds_credential.wait(8), (
                "Worker never acquired its principal and credential locks"
            )
            revocation = pool.submit(revoke)
            assert revocation_entered.wait(8)
            deadline = monotonic() + 8
            while True:
                with read_scope() as session:
                    waiting = session.execute(
                        text(
                            "SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"
                        ),
                        {"pid": revoke_pid["value"]},
                    ).scalar_one_or_none()
                if waiting == "Lock":
                    break
                assert monotonic() < deadline, (
                    "Revocation did not wait for the authorized worker"
                )
                continue_worker.wait(0.01)
        finally:
            continue_worker.set()
        outcome = effect.result(timeout=10)
        revocation.result(timeout=10)

    assert outcome["execution"]["status"] == "applied"
    assert (
        scalar(
            "SELECT has_photo FROM library_artists WHERE entity_uid=:id", {"id": UID}
        )
        == 1
    )
    assert (
        scalar(
            "SELECT revoked_at IS NOT NULL FROM mcp_oauth_authorizations WHERE id=:id",
            {"id": world["principal"].authorization_id},
        )
        is True
    )
    assert oauth_store.resolve_oauth_access_token(world["access_token"]) is None
    with pytest.raises(DiagnosticError) as caught:
        requests.accept_health_check(world["principal"], UID, "after-revocation")
    assert caught.value.code == "FORBIDDEN"
    assert scalar("SELECT COUNT(*) FROM tasks") == 2
