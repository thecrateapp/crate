"""Human plan decisions bind exact content, policy and one accepted job."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from crate.agent_diagnostics import DiagnosticError
from crate.artist_photo import observe_artist_photo
from crate.db.repositories import agent_plans as plans
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.repositories.tasks_updates import start_task
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.agent_command_fixtures import UID, change, observed_plan, scalar
from tests.test_agent_admin import ORIGIN, human_token

pytest_plugins = ["tests.agent_command_fixtures", "tests.test_agent_admin"]


def pending_plan(world):
    change(
        "UPDATE agent_principals SET require_approval=TRUE WHERE id=:id",
        {"id": world["principal"].id},
    )
    _, preview = observed_plan(world)
    return plans.get_plan(preview["plan_id"])


def decide(actor, plan, decision="approved", **overrides):
    args = {
        key: plan[key]
        for key in (
            "plan_version",
            "content_hash",
            "policy_revision",
            "authorization_context_hash",
        )
    }
    return plans.decide_plan(
        actor, plan["plan_id"], decision=decision, **{**args, **overrides}
    )


def test_default_photo_policy_is_preauthorized_in_single_plan_store(command_world):
    _, preview = observed_plan(command_world)
    plan = plans.get_plan(preview["plan_id"])
    assert plan["state"] == "ready" and plan["approval_required"] is False
    assert plan["operation"] == "repair_photo_flag"
    assert plan["targets"] == [{"artist_uid": UID, "name": "Echo"}]
    assert plan["changes"] == [
        {"artist_uid": UID, "field": "has_photo", "before": False, "after": True}
    ]
    assert (
        plan["target_count"] == plan["returned_count"] == 1
        and plan["truncated"] is False
    )
    assert plan["impact"]["filesystem_writes"] is False
    assert plan["risk"] == "low"
    assert len(plan["content_hash"]) == 64
    assert scalar("SELECT COUNT(*) FROM agent_repair_plans") == 1
    assert scalar("SELECT COUNT(*) FROM agent_plan_approvals") == 0


def test_scope_does_not_bypass_human_policy_and_approval_reserves_one_job(
    command_world, human_actor
):
    plan = pending_plan(command_world)
    assert plan["state"] == "awaiting_approval"
    assert plans.list_plans(state="awaiting_approval")[0]["plan_id"] == plan["plan_id"]
    principal = command_world["principal"]
    with pytest.raises(DiagnosticError) as caught:
        requests.accept_apply(principal, plan["plan_id"], plan["plan_version"], "apply")
    assert caught.value.code == "APPROVAL_REQUIRED"
    assert scalar("SELECT COUNT(*) FROM tasks") == 1
    assert decide(human_actor, plan)["state"] == "authorized"
    assert decide(human_actor, plan)["state"] == "authorized"
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(
            pool.map(
                lambda key: requests.accept_apply(
                    principal, plan["plan_id"], plan["plan_version"], key
                ),
                ["apply-a", "apply-b"],
            )
        )
    assert jobs[0]["job_id"] == jobs[1]["job_id"]
    assert scalar("SELECT COUNT(*) FROM tasks") == 2
    assert (
        scalar("SELECT reserved_job_id FROM agent_plan_approvals") == jobs[0]["job_id"]
    )
    start_task(jobs[0]["job_id"])
    result = requests.complete_photo_repair(
        jobs[0]["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    assert result["execution"]["status"] == "applied"
    assert result["verification"]["status"] == "pending"
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.plan.approved'") == 1
    )


@pytest.mark.parametrize(
    "field,invalid",
    [
        ("plan_version", "0" * 64),
        ("content_hash", "0" * 64),
        ("policy_revision", 99),
        ("authorization_context_hash", "0" * 64),
    ],
)
def test_human_decision_rejects_changed_review_identity(
    command_world, human_actor, field, invalid
):
    plan = pending_plan(command_world)
    with pytest.raises(DiagnosticError) as caught:
        decide(human_actor, plan, **{field: invalid})
    assert caught.value.code == "PLAN_STALE"
    assert scalar("SELECT COUNT(*) FROM agent_plan_approvals") == 0
    assert plans.get_plan(plan["plan_id"])["state"] == "awaiting_approval"


@pytest.mark.parametrize("mutation", ["expired", "content", "policy", "disabled"])
def test_decision_cannot_approve_stale_or_disabled_plan(
    command_world, human_actor, mutation
):
    plan = pending_plan(command_world)
    statements = {
        "expired": "UPDATE agent_repair_plans SET expires_at=NOW()-INTERVAL '1 second'",
        "content": "UPDATE agent_repair_plans SET artist_uid='10000000-0000-0000-0000-000000000002'",
        "policy": "UPDATE agent_principals SET policy_revision=policy_revision+1",
        "disabled": "UPDATE agent_principals SET enabled=FALSE",
    }
    change(statements[mutation])
    with pytest.raises(DiagnosticError) as caught:
        decide(human_actor, plan)
    assert caught.value.code == "PLAN_STALE"
    assert scalar("SELECT COUNT(*) FROM agent_plan_approvals") == 0


def test_human_decision_reloads_actor_permissions(command_world, human_actor):
    plan = pending_plan(command_world)
    set_user_roles(human_actor["id"], ["librarian"])
    with pytest.raises(DiagnosticError) as caught:
        decide(human_actor, plan)
    assert caught.value.code == "FORBIDDEN"
    assert scalar("SELECT COUNT(*) FROM agent_plan_approvals") == 0


def test_concurrent_conflicting_human_decisions_have_one_winner(
    command_world, human_actor
):
    plan = pending_plan(command_world)

    def attempt(decision):
        try:
            return decide(human_actor, plan, decision)["state"]
        except DiagnosticError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(attempt, ["approved", "rejected"]))
    assert "STATE_CONFLICT" in outcomes
    assert len(set(outcomes) & {"authorized", "rejected"}) == 1
    assert scalar("SELECT COUNT(*) FROM agent_plan_approvals") == 1
    assert (
        scalar(
            "SELECT COUNT(*) FROM audit_log WHERE action IN ('agent.plan.approved','agent.plan.rejected')"
        )
        == 1
    )


def test_rejection_is_final_and_does_not_queue_or_grant_permissions(
    command_world, human_actor
):
    plan = pending_plan(command_world)
    assert decide(human_actor, plan, "rejected")["state"] == "rejected"
    with pytest.raises(DiagnosticError) as caught:
        decide(human_actor, plan)
    assert caught.value.code == "STATE_CONFLICT"
    with pytest.raises(DiagnosticError) as caught:
        requests.accept_apply(
            command_world["principal"], plan["plan_id"], plan["plan_version"], "apply"
        )
    assert caught.value.code == "APPROVAL_REQUIRED"
    assert scalar("SELECT COUNT(*) FROM tasks") == 1


@pytest.mark.parametrize(
    "mutation", ["policy", "approval_expiry", "scope", "reservation"]
)
def test_worker_revalidates_approved_authority_before_effect(
    command_world, human_actor, mutation
):
    plan = pending_plan(command_world)
    decide(human_actor, plan)
    principal = command_world["principal"]
    job = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "apply"
    )
    start_task(job["job_id"])
    statements = {
        "policy": "UPDATE agent_principals SET policy_revision=policy_revision+1",
        "approval_expiry": "UPDATE agent_plan_approvals SET expires_at=NOW()-INTERVAL '1 second'",
        "scope": "UPDATE agent_principals SET grants=ARRAY['library.health.read']",
        "reservation": "UPDATE agent_plan_approvals SET reserved_job_id='different-job'",
    }
    change(statements[mutation])
    with pytest.raises(DiagnosticError) as caught:
        requests.complete_photo_repair(
            job["job_id"], observe_artist_photo(command_world["config"], UID)
        )
    assert caught.value.code in {"PLAN_STALE", "FORBIDDEN", "APPROVAL_REQUIRED"}
    assert scalar("SELECT has_photo FROM library_artists WHERE name='Echo'") == 0
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.repair.applied'")
        == 0
    )


def test_policy_change_blocks_replay_of_accepted_job(command_world, human_actor):
    plan = pending_plan(command_world)
    decide(human_actor, plan)
    principal = command_world["principal"]
    requests.accept_apply(principal, plan["plan_id"], plan["plan_version"], "apply")
    change("UPDATE agent_principals SET policy_revision=policy_revision+1")
    with pytest.raises(DiagnosticError) as caught:
        requests.accept_apply(principal, plan["plan_id"], plan["plan_version"], "apply")
    assert caught.value.code == "PLAN_STALE"


def test_cancelled_job_cannot_consume_approval_for_another_job(
    command_world, human_actor
):
    plan = pending_plan(command_world)
    decide(human_actor, plan)
    principal = command_world["principal"]
    job = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "apply"
    )
    requests.cancel_job(principal, job["job_id"])
    replay = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "new-key"
    )
    assert replay["job_id"] == job["job_id"]
    assert scalar("SELECT COUNT(*) FROM tasks") == 2
    assert scalar("SELECT reserved_job_id FROM agent_plan_approvals") == job["job_id"]


def test_expiry_is_part_of_exact_plan_content(command_world):
    plan = pending_plan(command_world)
    change("UPDATE agent_repair_plans SET expires_at=expires_at-INTERVAL '1 second'")
    assert plans.get_plan(plan["plan_id"])["content_hash"] != plan["content_hash"]


def test_deleting_reviewer_preserves_plan_decision_and_audit(
    command_world, human_actor
):
    plan = pending_plan(command_world)
    decide(human_actor, plan)
    change("DELETE FROM users WHERE id=:id", {"id": human_actor["id"]})
    assert (
        scalar(
            "SELECT approved_by FROM agent_plan_approvals WHERE plan_id=:id",
            {"id": plan["plan_id"]},
        )
        is None
    )
    assert (
        scalar(
            "SELECT decision FROM agent_plan_approvals WHERE plan_id=:id",
            {"id": plan["plan_id"]},
        )
        == "approved"
    )
    assert plans.get_plan(plan["plan_id"])["state"] == "authorized"
    assert (
        scalar(
            "SELECT user_id FROM audit_log WHERE action='agent.plan.approved' AND target_name=:id",
            {"id": plan["plan_id"]},
        )
        == human_actor["id"]
    )


def test_human_plan_http_review_and_exact_decision_contract(command_world, human_actor):
    from crate.api.agent_plans import router

    plan = pending_plan(command_world)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app, base_url="https://api.example.test") as client:
        client.cookies.set("crate_session", human_token(human_actor))
        client.headers["Origin"] = ORIGIN
        listed = client.get("/api/admin/agent-plans?state=awaiting_approval")
        assert listed.status_code == 200
        assert listed.json()["items"][0]["plan_id"] == plan["plan_id"]
        path = f"/api/admin/agent-plans/{plan['plan_id']}"
        document = client.get(path)
        assert document.status_code == 200
        assert document.headers["Cache-Control"] == "no-store"
        assert document.json()["targets"] == plan["targets"]
        body = {
            key: plan[key]
            for key in (
                "plan_version",
                "content_hash",
                "policy_revision",
                "authorization_context_hash",
            )
        }
        altered = client.post(
            f"{path}/approve", json={**body, "content_hash": "0" * 64}
        )
        assert altered.status_code == 409
        assert altered.headers["X-Crate-Error"] == "PLAN_STALE"
        bearer = client.post(
            f"{path}/approve",
            json=body,
            headers={"Authorization": f"Bearer {human_token(human_actor)}"},
        )
        assert bearer.status_code == 401
        accepted = client.post(f"{path}/approve", json=body)
        assert accepted.status_code == 200
        assert accepted.headers["Cache-Control"] == "no-store"
        assert accepted.json()["state"] == "authorized"
        assert client.post(f"{path}/approve", json=body).status_code == 200
        rejected = client.post(f"{path}/reject", json=body)
        assert rejected.status_code == 409
    assert scalar("SELECT COUNT(*) FROM agent_plan_approvals") == 1
    assert scalar("SELECT COUNT(*) FROM tasks") == 1


@pytest.mark.parametrize(
    "granted",
    [
        ("agents.plans.review", "agents.plans.approve"),
        ("agents.plans.approve", "library.repair.run"),
    ],
)
def test_review_http_requires_plan_and_domain_capabilities(
    command_world, human_actor, monkeypatch, granted
):
    from crate.api.agent_plans import router
    from crate.api.permissions import ROLE_CAPABILITIES

    plan = pending_plan(command_world)
    monkeypatch.setitem(
        ROLE_CAPABILITIES,
        "ops",
        (*ROLE_CAPABILITIES["ops"], *granted),
    )
    set_user_roles(human_actor["id"], ["ops"])
    app = FastAPI()
    app.include_router(router)
    with TestClient(app, base_url="https://api.example.test") as client:
        client.cookies.set("crate_session", human_token(human_actor))
        client.headers["Origin"] = ORIGIN
        collection = client.get("/api/admin/agent-plans")
        if "agents.plans.review" in granted:
            assert collection.status_code == 200
            assert collection.json() == {"items": [], "next_cursor": None}
        else:
            assert collection.status_code == 403
        assert (
            client.get(f"/api/admin/agent-plans/{plan['plan_id']}").status_code == 403
        )
        body = {
            key: plan[key]
            for key in (
                "plan_version",
                "content_hash",
                "policy_revision",
                "authorization_context_hash",
            )
        }
        assert (
            client.post(
                f"/api/admin/agent-plans/{plan['plan_id']}/approve", json=body
            ).status_code
            == 403
        )
    assert scalar("SELECT COUNT(*) FROM agent_plan_approvals") == 0
    with pytest.raises(DiagnosticError) as caught:
        decide(human_actor, plan)
    assert caught.value.code == "FORBIDDEN"
