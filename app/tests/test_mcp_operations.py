"""Instance controls retain domain permissions, ownership and reviewed scope."""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from threading import Barrier
from unittest.mock import Mock

import pytest
from sqlalchemy import text

from crate import agent_diagnostics, agent_instance_operations, agent_library_operations
from crate.agent_access import ALLOWED_GRANTS
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_plans, agent_task_control
from crate.db.repositories.agent_credentials import create_credential, revoke_credential
from crate.db.repositories.task_control import request_cancellation
from crate.db.repositories.tasks import create_task, start_task, update_task
from crate.db.queries.tasks import get_task
from crate.db.tx import read_scope, transaction_scope

from tests.test_agent_plan_approvals import decide
from tests.test_mcp_actions import PLAN_ID, PLAN_VERSION, _client
from tests.test_mcp_actions import action_transport as action_transport  # noqa: PLC0414
from tests.test_task_control_actor import actor_world as actor_world  # noqa: PLC0414

pytest_plugins = ["tests.test_agent_admin"]


@pytest.fixture
def control_world(pg_db, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    dispatch = Mock()
    monkeypatch.setattr("crate.db.repositories.tasks_mutations.dispatch_task", dispatch)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_shared.publish_tasks_surface_signal", lambda: None
    )
    issued = create_credential(
        "Instance maintenance",
        ALLOWED_GRANTS,
        datetime.now(timezone.utc) + timedelta(days=1),
    )
    return {"principal": issued.principal, "dispatch": dispatch}


def _row(task_id):
    row = get_task(task_id)
    assert row is not None
    return row


def _original(
    world,
    *,
    origin="scheduler",
    task_type="compute_analytics",
    status="failed",
    params=None,
    parent=None,
):
    principal = world["principal"]
    task_id = create_task(
        task_type,
        params or {},
        origin=origin,
        agent_context=agent_task_control.principal_context(principal)
        if origin == "agent"
        else None,
        required_grants=["ops.schedules.run"],
        parent_task_id=parent,
        dispatch=False,
    )
    if status != "pending":
        start_task(task_id)
        if status != "running":
            update_task(task_id, status=status, result={"previous_effects": "retained"})
    return task_id


def _inspect(
    world, task_id, *, operation="job_retry", scope="instance", principal=None
):
    return agent_task_control.inspect_control(
        principal or world["principal"], operation, {"job_id": task_id, "scope": scope}
    )


def _prepared(world, operation, parameters):
    queued = agent_library_operations.prepare_operation(
        world["principal"], operation, parameters, "prepare-exact-control"
    )["data"]
    start_task(queued["job_id"])
    result = agent_library_operations.execute_operation_job(queued["job_id"], {})
    assert result["execution"]["status"] == "prepared", result
    return result["plan"]


@pytest.mark.parametrize("origin", ["admin", "scheduler"])
def test_instance_retry_requires_explicit_scope_for_human_or_scheduler_work(
    control_world, origin
):
    task_id = _original(control_world, origin=origin)

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, task_id, scope="own")
    assert error.value.code == "FORBIDDEN"

    inspected = _inspect(control_world, task_id)
    assert inspected["origin"] == origin
    assert set(inspected["required_grants"]) == {
        "ops.jobs.retry",
        "ops.jobs.manage_instance",
        "ops.schedules.run",
    }


@pytest.mark.parametrize(
    "missing", ["ops.jobs.retry", "ops.jobs.manage_instance", "ops.schedules.run"]
)
def test_instance_retry_requires_action_instance_and_original_domain_grants(
    control_world, missing
):
    task_id = _original(control_world)
    limited = replace(
        control_world["principal"], grants=control_world["principal"].grants - {missing}
    )

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, task_id, principal=limited)

    assert error.value.code == "FORBIDDEN"


def test_own_control_cannot_target_another_integration_even_with_instance_grant(
    control_world,
):
    task_id = _original(control_world, origin="agent", status="pending")
    other = create_credential(
        "Other integration",
        ALLOWED_GRANTS,
        datetime.now(timezone.utc) + timedelta(days=1),
    ).principal

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, task_id, operation="job_cancel", principal=other)

    assert error.value.code == "FORBIDDEN"
    assert _row(task_id)["status"] == "pending"


def test_retry_creates_new_authorized_work_and_preserves_previous_result(control_world):
    task_id = _original(control_world)
    before = _row(task_id)
    execution = _inspect(control_world, task_id)

    result = agent_task_control.apply_control("job_retry", execution)

    assert result["status"] == "queued"
    retried = _row(result["task_id"])
    assert retried["id"] != task_id
    assert retried["origin"] == "agent"
    assert retried["retry_of"] == retried["retry_root"] == task_id
    assert retried["retry_depth"] == 1
    assert retried["params"] == {}
    assert retried["max_retries"] == 0
    assert set(retried["required_grants"]) == set(execution["required_grants"])
    assert str(retried["origin_principal_id"]) == control_world["principal"].id
    assert _row(task_id)["result"] == before["result"]
    control_world["dispatch"].assert_called_once_with(
        "compute_analytics", retried["id"]
    )


@pytest.mark.parametrize("status", ["pending", "running", "delegated", "completing"])
def test_active_retry_blocks_every_failed_ancestor_and_an_older_preview(
    control_world, status
):
    original = _original(control_world)
    first = agent_task_control.apply_control(
        "job_retry", _inspect(control_world, original)
    )["task_id"]
    start_task(first)
    update_task(first, status="failed")
    previews = [_inspect(control_world, task_id) for task_id in (original, first)]
    active = agent_task_control.apply_control("job_retry", previews[1])["task_id"]
    if status != "pending":
        start_task(active)
        if status != "running":
            update_task(active, status=status)
    control_world["dispatch"].reset_mock()

    for task_id, preview in zip((original, first), previews, strict=True):
        with pytest.raises(DiagnosticError) as inspect_error:
            _inspect(control_world, task_id)
        assert inspect_error.value.code == "STATE_CONFLICT"
        with pytest.raises(DiagnosticError) as apply_error:
            agent_task_control.apply_control("job_retry", preview)
        assert apply_error.value.code == "STATE_CONFLICT"

    assert _row(active)["status"] == status
    control_world["dispatch"].assert_not_called()


def test_concurrent_retry_branches_admit_only_one_active_descendant(control_world):
    original = _original(control_world)
    previous = agent_task_control.apply_control(
        "job_retry", _inspect(control_world, original)
    )["task_id"]
    start_task(previous)
    update_task(previous, status="failed")
    previews = [_inspect(control_world, task_id) for task_id in (original, previous)]
    barrier = Barrier(2)
    control_world["dispatch"].reset_mock()

    def apply(preview):
        barrier.wait(timeout=10)
        try:
            return agent_task_control.apply_control("job_retry", preview)["status"]
        except DiagnosticError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, previews))

    assert sorted(results) == ["STATE_CONFLICT", "queued"]
    with read_scope() as session:
        assert (
            session.execute(
                text(
                    "SELECT COUNT(*) FROM tasks WHERE retry_root=:root AND status='pending'"
                ),
                {"root": original},
            ).scalar_one()
            == 1
        )
    control_world["dispatch"].assert_called_once()


@pytest.mark.parametrize("revocation", ["credential", "original_grant"])
def test_raw_retry_checkpoint_revalidates_credential_and_original_domain_grants(
    control_world, revocation
):
    from crate.worker_handlers import is_cancelled

    original = _original(control_world)
    retried = agent_task_control.apply_control(
        "job_retry", _inspect(control_world, original)
    )["task_id"]
    assert start_task(retried) is not None
    assert is_cancelled(retried) is False
    principal = control_world["principal"]
    if revocation == "credential":
        revoke_credential(principal.credential_id)
    else:
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE agent_principals SET grants=array_remove(grants,'ops.schedules.run') WHERE id=CAST(:id AS uuid)"
                ),
                {"id": principal.id},
            )

    with pytest.raises(DiagnosticError) as error:
        is_cancelled(retried)

    assert error.value.code == "FORBIDDEN"
    assert _row(retried)["status"] == "running"
    assert _row(retried)["cancellation_acknowledged_at"] is None


@pytest.mark.parametrize(
    "params",
    [
        {"ignore_resource_governor": True},
        {"trigger": "admin"},
        {"agent_command": True},
        {"unknown": "do-not-clone"},
    ],
)
def test_retry_never_clones_free_task_parameters_or_governor_bypass(
    control_world, params
):
    task_id = _original(control_world, params=params)

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, task_id)

    assert error.value.code == "NOT_EXECUTABLE"
    control_world["dispatch"].assert_not_called()


@pytest.mark.parametrize("task_type", ["repair", "delete_artist", "library_pipeline"])
def test_uncatalogued_replay_requires_a_new_domain_plan(control_world, task_type):
    task_id = _original(control_world, task_type=task_type)

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, task_id)

    assert error.value.code == "NOT_EXECUTABLE"


def test_failed_child_cannot_be_retried_outside_its_parent_contract(control_world):
    parent = _original(control_world, status="running")
    child = _original(control_world, parent=parent)

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, child)

    assert error.value.code == "NOT_EXECUTABLE"


def test_retry_budget_applies_across_descendants_and_branches(control_world):
    original = _original(control_world)
    previous = original
    for _ in range(3):
        execution = _inspect(control_world, previous)
        retried = agent_task_control.apply_control("job_retry", execution)
        previous = retried["task_id"]
        start_task(previous)
        update_task(previous, status="failed", result={"temporary_error": True})

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, original)

    assert error.value.code == "LIMIT_EXCEEDED"
    assert _row(previous)["retry_depth"] == 3


def test_failed_work_with_unacknowledged_cancellation_cannot_be_replayed(control_world):
    task_id = _original(control_world, status="running")
    request_cancellation(task_id)
    update_task(task_id, status="failed", result={"uncertain_effects": True})

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, task_id)

    assert error.value.code == "STATE_CONFLICT"


@pytest.mark.parametrize("mutation", ["state", "params", "grant"])
def test_apply_rejects_a_target_changed_since_preview(control_world, mutation):
    task_id = _original(control_world)
    execution = _inspect(control_world, task_id)
    statements = {
        "state": "UPDATE tasks SET status='running' WHERE id=:id",
        "params": "UPDATE tasks SET params_json=CAST(:params AS jsonb) WHERE id=:id",
        "grant": "UPDATE tasks SET required_grants=ARRAY['library.metadata.write'] WHERE id=:id",
    }
    with transaction_scope() as session:
        session.execute(
            text(statements[mutation]),
            {"id": task_id, "params": json.dumps({"ignore_resource_governor": True})},
        )

    with pytest.raises(DiagnosticError) as error:
        agent_task_control.apply_control("job_retry", execution)

    assert error.value.code == "PLAN_STALE"
    control_world["dispatch"].assert_not_called()


def test_running_heartbeat_does_not_invalidate_an_exact_cancel_plan(control_world):
    task_id = _original(control_world, status="running")
    execution = _inspect(control_world, task_id, operation="job_cancel")
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE tasks SET heartbeat_at=NOW(),updated_at=NOW(),progress='Still processing' WHERE id=:id"
            ),
            {"id": task_id},
        )

    requested = agent_task_control.apply_control("job_cancel", execution)

    assert requested["status"] == "running"
    assert requested["request_state"] == "cancellation_requested"
    assert _row(task_id)["cancellation_acknowledged_at"] is None


@pytest.mark.parametrize("revocation", ["credential", "original_grant"])
def test_apply_revalidates_authority_at_effect_time(control_world, revocation):
    task_id = _original(control_world)
    execution = _inspect(control_world, task_id)
    principal = control_world["principal"]
    if revocation == "credential":
        revoke_credential(principal.credential_id)
    else:
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE agent_principals SET grants=array_remove(grants,'ops.schedules.run') WHERE id=CAST(:id AS uuid)"
                ),
                {"id": principal.id},
            )

    with pytest.raises(DiagnosticError) as error:
        agent_task_control.apply_control("job_retry", execution)

    assert error.value.code == "FORBIDDEN"
    control_world["dispatch"].assert_not_called()


def test_adapter_review_document_exposes_exact_control_without_raw_task_params(
    control_world,
):
    task_id = _original(control_world)

    compiled = agent_instance_operations.compile_operation(
        "job_retry",
        {"job_id": task_id, "scope": "instance"},
        {},
        principal=control_world["principal"],
    )

    assert compiled["document"]["risk"] == "high"
    assert compiled["document"]["targets"] == [{"entity_type": "task", "name": task_id}]
    assert compiled["document"]["changes"][0]["from"] == "failed"
    assert compiled["execution"]["required_grants"]
    assert "params_json" not in compiled["document"]


def test_new_agent_preparation_records_owner_and_retains_original_control_grants(
    control_world,
):
    original = _original(control_world)
    principal = control_world["principal"]
    queued = agent_library_operations.prepare_operation(
        principal,
        "job_retry",
        {"job_id": original, "scope": "instance"},
        "owned-preparation",
    )["data"]

    prepared = _row(queued["job_id"])
    assert prepared["origin"] == "agent"
    assert str(prepared["origin_principal_id"]) == principal.id
    assert prepared["origin_context"] == agent_task_control.principal_context(principal)
    assert {"ops.jobs.retry", "ops.jobs.manage_instance", "ops.schedules.run"} <= set(
        prepared["required_grants"]
    )
    owned_cancel = _inspect(
        control_world, queued["job_id"], operation="job_cancel", scope="own"
    )
    assert owned_cancel["job_id"] == queued["job_id"]


def test_own_running_agent_job_does_not_consume_the_slot_needed_to_prepare_its_cancel(
    control_world,
):
    principal = control_world["principal"]
    existing = agent_library_operations.prepare_operation(
        principal, "quality_check", {"scope": "global"}, "running-quality-preparation"
    )["data"]
    start_task(existing["job_id"])

    cancellation = agent_library_operations.prepare_operation(
        principal,
        "job_cancel",
        {"job_id": existing["job_id"], "scope": "own"},
        "cancel-my-running-job",
    )["data"]
    start_task(cancellation["job_id"])
    prepared = agent_library_operations.execute_operation_job(
        cancellation["job_id"], {}
    )

    assert prepared["execution"]["status"] == "prepared", prepared
    assert _row(existing["job_id"])["status"] == "running"
    assert prepared["plan"]["targets"] == [
        {"entity_type": "task", "name": existing["job_id"]}
    ]


def test_cancel_preparation_and_apply_can_claim_reserved_capacity_when_work_is_full(
    control_world, human_actor
):
    from crate.db.repositories import runtime_policy
    from crate.runtime_policy_contract import POOLS

    runtime_policy.update_runtime_policy(
        {"max_running": 1, "pools": dict.fromkeys(POOLS, 1)}, expected_revision=0
    )
    target = _original(control_world, status="running")
    principal = control_world["principal"]
    queued = agent_library_operations.prepare_operation(
        principal,
        "job_cancel",
        {"job_id": target, "scope": "instance"},
        "reserved-cancel",
    )["data"]
    assert _row(queued["job_id"])["type"] == "agent_control"
    assert start_task(queued["job_id"]) is not None
    prepared = agent_library_operations.execute_operation_job(queued["job_id"], {})
    assert prepared["execution"]["status"] == "prepared", prepared
    plan = prepared["plan"]
    update_task(queued["job_id"], status="completed")
    decide(human_actor, plan)
    accepted = agent_library_operations.apply_operation(
        principal, "job_cancel", plan["plan_id"], plan["plan_version"], "reserved-apply"
    )["data"]
    assert _row(accepted["job_id"])["type"] == "agent_control"
    assert start_task(accepted["job_id"]) is not None

    result = agent_library_operations.execute_operation_job(accepted["job_id"], {})

    assert result["execution"]["status"] == "completed", result
    assert _row(target)["status"] == "running"
    assert _row(target)["cancellation_requested_at"] is not None
    assert _row(target)["cancellation_acknowledged_at"] is None


@pytest.mark.parametrize("operation", ["job_retry", "job_cancel"])
@pytest.mark.parametrize("revocation", ["credential", "original_grant"])
def test_control_prepare_replay_survives_changed_eligibility_and_rechecks_authority(
    control_world, operation, revocation
):
    from crate.db.repositories.task_control import acknowledge_cancellation

    principal = control_world["principal"]
    target = _original(
        control_world, status="failed" if operation == "job_retry" else "running"
    )
    parameters = {"job_id": target, "scope": "instance"}
    queued = agent_library_operations.prepare_operation(
        principal, operation, parameters, "replay-control-prepare"
    )["data"]
    if operation == "job_retry":
        agent_task_control.apply_control("job_retry", _inspect(control_world, target))
    else:
        request_cancellation(target)
        acknowledge_cancellation(target)

    replayed = agent_library_operations.prepare_operation(
        principal, operation, parameters, "replay-control-prepare"
    )["data"]

    assert replayed["job_id"] == queued["job_id"]
    if revocation == "credential":
        revoke_credential(principal.credential_id)
    else:
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE agent_principals SET grants=array_remove(grants,'ops.schedules.run') WHERE id=CAST(:id AS uuid)"
                ),
                {"id": principal.id},
            )
    with pytest.raises(DiagnosticError) as error:
        agent_library_operations.prepare_operation(
            principal, operation, parameters, "replay-control-prepare"
        )
    assert error.value.code == "FORBIDDEN"


def test_shared_plan_engine_recovers_scheduler_maintenance_after_human_approval(
    control_world, human_actor
):
    task_id = _original(control_world)
    plan = _prepared(
        control_world, "job_retry", {"job_id": task_id, "scope": "instance"}
    )
    assert plan["state"] == "awaiting_approval"
    assert plan["approval_required"] is True
    principal = control_world["principal"]
    with pytest.raises(DiagnosticError) as error:
        agent_library_operations.apply_operation(
            principal,
            "job_retry",
            plan["plan_id"],
            plan["plan_version"],
            "apply-review",
        )
    assert error.value.code == "APPROVAL_REQUIRED"
    decide(human_actor, plan)
    accepted = agent_library_operations.apply_operation(
        principal, "job_retry", plan["plan_id"], plan["plan_version"], "apply-review"
    )["data"]
    start_task(accepted["job_id"])

    result = agent_library_operations.execute_operation_job(accepted["job_id"], {})

    assert result["execution"]["status"] == "completed", result
    retried = _row(result["execution"]["items"][0]["task_id"])
    assert retried["status"] == "pending"
    assert retried["retry_of"] == task_id
    assert {"ops.jobs.manage_instance", "ops.schedules.run", "ops.jobs.retry"} <= set(
        retried["required_grants"]
    )
    replay = agent_library_operations.apply_operation(
        principal, "job_retry", plan["plan_id"], plan["plan_version"], "apply-review"
    )["data"]
    assert replay["job_id"] == accepted["job_id"]
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM tasks WHERE retry_of=:id"), {"id": task_id}
            ).scalar_one()
            == 1
        )
    assert agent_plans.get_owned_plan(principal, plan["plan_id"])["state"] == "applied"


def test_actor_acknowledges_cancelled_agent_effects_after_persisting_partial_result(
    control_world, human_actor, actor_world, monkeypatch
):
    from crate.db.repositories import agent_operation_jobs

    original = _original(control_world)
    plan = _prepared(
        control_world, "job_retry", {"job_id": original, "scope": "instance"}
    )
    decide(human_actor, plan)
    accepted = agent_library_operations.apply_operation(
        control_world["principal"],
        "job_retry",
        plan["plan_id"],
        plan["plan_version"],
        "cancel-during-effect",
    )["data"]
    actors, _handlers, events = actor_world
    observed = {}
    effects = []
    finish = agent_operation_jobs.finish_operation

    def apply(_operation, _execution, _config, *, task_id, authorize):
        def first():
            effects.append("first")
            request_cancellation(task_id)

        authorize(first)
        authorize(lambda: effects.append("second"))

    def store(task_id, result):
        value = finish(task_id, result)
        observed["before_ack"] = _row(task_id)
        observed["private_result"] = value
        return value

    monkeypatch.setattr(agent_instance_operations, "apply_operation", apply)
    monkeypatch.setattr(agent_operation_jobs, "finish_operation", store)

    actors._execute_task("agent_maintenance", accepted["job_id"])

    assert effects == ["first"]
    before_ack = observed["before_ack"]
    assert before_ack["status"] == "running"
    assert before_ack["cancellation_acknowledged_at"] is None
    assert before_ack["result"]["status"] == "cancelled"
    row = _row(accepted["job_id"])
    assert row["status"] == "cancelled"
    assert row["cancellation_acknowledged_at"] is not None
    assert row["result"]["execution"]["status"] == "partial"
    assert row["result"]["execution"]["error_code"] == "CANCELLED"
    assert row["result"]["verification"]["status"] == "manual_reconciliation_required"
    private = agent_operation_jobs.load_operation_job(accepted["job_id"])["result"]
    assert private == observed["private_result"]
    assert (
        agent_plans.get_owned_plan(control_world["principal"], plan["plan_id"])[
            "result"
        ]
        == private
    )
    assert private["execution"]["status"] == "partial"
    assert private["execution"]["error_code"] == "CANCELLED"
    assert [event[2]["status"] for event in events if event[1] == "task_done"] == [
        "cancelled"
    ]


def test_quality_retry_plan_reconstructs_global_scope_and_runs_real_quality_handler(
    control_world, human_actor, actor_world, monkeypatch, tmp_path
):
    original = _original(
        control_world, task_type="quality_check", params={"scope": "global"}
    )
    plan = _prepared(
        control_world, "job_retry", {"job_id": original, "scope": "instance"}
    )
    decide(human_actor, plan)
    accepted = agent_library_operations.apply_operation(
        control_world["principal"],
        "job_retry",
        plan["plan_id"],
        plan["plan_version"],
        "retry-global-quality",
    )["data"]
    start_task(accepted["job_id"])
    result = agent_library_operations.execute_operation_job(accepted["job_id"], {})
    assert result["execution"]["status"] == "completed", result
    retried = result["execution"]["items"][0]["task_id"]
    assert _row(retried)["params"] == {"scope": "global"}
    monkeypatch.setattr(
        "crate.config.load_config", lambda: {"library_path": str(tmp_path)}
    )

    actor_world[0]._execute_task("quality_check", retried)

    row = _row(retried)
    assert row["status"] == "completed"
    assert row["result"]["published"] is True
    assert row["result"]["scanned_tracks"] == 0
    assert row["retry_of"] == original


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"scope": "artist"},
        {"scope": "global", "ignore_resource_governor": True},
        {"scope": "global", "unknown": "not-reviewed"},
    ],
)
def test_quality_retry_rejects_missing_or_unreviewed_scope_parameters(
    control_world, params
):
    original = _original(control_world, task_type="quality_check", params=params)

    with pytest.raises(DiagnosticError) as error:
        _inspect(control_world, original)

    assert error.value.code == "NOT_EXECUTABLE"
    control_world["dispatch"].assert_not_called()


def test_audit_pages_are_filtered_and_never_expose_arbitrary_stored_details(
    control_world, monkeypatch
):
    now = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(agent_diagnostics, "_now", lambda: now)
    secret = "private-audit-secret-should-never-be-returned"
    with transaction_scope() as session:
        for task_id in ("audited-job", "audited-job", "other-job"):
            session.execute(
                text("""INSERT INTO audit_log(timestamp,action,target_type,target_name,task_id,details_json)
                    VALUES(:at,'agent.task.retry','agent_job',:job,:job,CAST(:details AS jsonb))"""),
                {
                    "at": now - timedelta(minutes=5),
                    "job": task_id,
                    "details": json.dumps(
                        {
                            "job_id": task_id,
                            "tool": "retry_job",
                            "password": secret,
                            "nested_payload": {"api_key": secret},
                            "token": "Bearer " + secret,
                        }
                    ),
                },
            )
    args = {
        "task_id": "audited-job",
        "since": now - timedelta(hours=1),
        "until": now,
        "limit": 1,
    }

    first = agent_diagnostics.read_audit(**args)
    second = agent_diagnostics.read_audit(**args, cursor=first["next_cursor"])

    assert first["truncated"] is True
    assert first["data"][0]["id"] != second["data"][0]["id"]
    assert second["next_cursor"] is None
    assert second["truncated"] is False
    for page in (first, second):
        assert page["data"][0]["task_id"] == "audited-job"
        assert page["data"][0]["details"]["tool"] == "retry_job"
        assert secret not in json.dumps(page, default=str)
        assert "nested_payload" not in page["data"][0]["details"]

    with pytest.raises(DiagnosticError) as error:
        agent_diagnostics.read_audit(
            **{**args, "task_id": "other-job"}, cursor=first["next_cursor"]
        )
    assert error.value.code == "INVALID_ARGUMENT"


@pytest.mark.parametrize("since_only", [False, True])
def test_audit_pagination_freezes_implicit_window_while_time_advances(
    control_world, monkeypatch, since_only
):
    now = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(agent_diagnostics, "_now", lambda: now)
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO audit_log(timestamp,action,target_type,target_name,task_id)
                SELECT :at,'agent.task.retry','agent_job','page-job','page-job'
                FROM generate_series(1,3)"""),
            {"at": now - timedelta(minutes=5)},
        )
    args = {"task_id": "page-job", "limit": 1}
    if since_only:
        args["since"] = now - timedelta(hours=1)
    first = agent_diagnostics.read_audit(**args)
    now += timedelta(minutes=30)

    second = agent_diagnostics.read_audit(**args, cursor=first["next_cursor"])
    third = agent_diagnostics.read_audit(**args, cursor=second["next_cursor"])

    assert len({page["data"][0]["id"] for page in (first, second, third)}) == 3
    assert first["window"] == second["window"] == third["window"]
    assert third["next_cursor"] is None
    assert third["truncated"] is False


def test_job_evidence_keeps_bounded_partial_effects_for_parent_and_children(
    control_world,
):
    parent = _original(control_world, status="running")
    child = _original(control_world, parent=parent, status="running")
    request_cancellation(parent)
    from crate.db.repositories.task_control import acknowledge_cancellation

    effects = {
        "processed": 2,
        "remaining": 4,
        "execution": {
            "status": "partial",
            "applied": 2,
            "analytics_cache_updated": True,
        },
        "private_secret": "never-return-this-value",
    }
    acknowledge_cancellation(child, effects)
    acknowledge_cancellation(parent, effects)

    evidence = agent_diagnostics.get_job(parent)

    rows = [evidence["data"], evidence["data"]["children"][0]]
    for row in rows:
        assert row["partial_effects"]["processed"] == 2
        assert row["partial_effects"]["remaining"] == 4
        assert row["execution_status"] == "partial"
        assert row["partial_effects"]["applied"] == 2
        assert row["partial_effects"]["analytics_cache_updated"] is True
    assert "never-return-this-value" not in json.dumps(evidence, default=str)


def test_job_evidence_exposes_origin_delegation_and_pending_cancellation_with_bounded_children(
    control_world,
):
    parent = _original(control_world, status="running")
    update_task(parent, status="delegated")
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO tasks(id,type,status,created_at,updated_at,parent_task_id)
                SELECT 'bounded-child-'||n,'compute_analytics','pending',NOW(),NOW(),:parent
                FROM generate_series(1,101) n"""),
            {"parent": parent},
        )
    _original(control_world, parent=parent, status="running")
    request_cancellation(parent)

    evidence = agent_diagnostics.get_job(parent)

    assert evidence["data"]["origin"] == "scheduler"
    assert evidence["data"]["status"] == "delegated"
    assert evidence["data"]["cancellation_requested"] is True
    assert evidence["data"]["cancellation_acknowledged_at"] is None
    assert len(evidence["data"]["children"]) == 100
    assert evidence["data"]["children_truncated"] is True
    assert all(child["status"] == "cancelled" for child in evidence["data"]["children"])


@pytest.mark.parametrize(
    "series,minutes",
    [
        ("unknown.metric", 60),
        ("worker.task.duration", 101),
        ("worker.task.duration", True),
    ],
)
def test_metric_diagnostics_reject_arbitrary_series_and_unbounded_windows(
    monkeypatch, series, minutes
):
    query = Mock()
    monkeypatch.setattr("crate.metrics.query_recent", query)

    with pytest.raises(DiagnosticError) as error:
        agent_diagnostics.read_diagnostics(
            source="metric_series", series=series, minutes=minutes
        )

    assert error.value.code == "INVALID_ARGUMENT"
    query.assert_not_called()


def test_missing_metric_samples_are_unavailable_and_do_not_mean_zero_activity(
    monkeypatch,
):
    monkeypatch.setattr("crate.metrics.query_recent", lambda *_args, **_kwargs: [])

    result = agent_diagnostics.read_diagnostics(
        source="metric_series", series="worker.task.duration", minutes=5
    )

    assert result["availability"] == "unavailable"
    assert result["data"]["samples"] == []
    assert result["observed_at"] is None


_APPLY = {
    "plan_id": PLAN_ID,
    "plan_version": PLAN_VERSION,
    "idempotency_key": "apply-instance-one",
}
_INSTANCE_TOOLS = [
    ("read_audit", "ops.audit.read", {}),
    ("list_schedules", "ops.schedules.read", {}),
    ("get_runtime_policy", "ops.runtime.read", {}),
    (
        "preview_job_retry",
        "ops.jobs.retry",
        {"job_id": "job-one", "idempotency_key": "preview-instance-one"},
    ),
    (
        "preview_job_cancel",
        "ops.jobs.cancel",
        {
            "job_id": "job-one",
            "scope": "instance",
            "idempotency_key": "preview-instance-one",
        },
    ),
    ("apply_job_retry", "ops.jobs.retry", _APPLY),
    ("apply_job_cancel", "ops.jobs.cancel", _APPLY),
    (
        "run_schedule",
        "ops.schedules.run",
        {"schedule": "compute_analytics", "idempotency_key": "preview-instance-one"},
    ),
    (
        "preview_schedule_update",
        "ops.schedules.write",
        {
            "schedule": "compute_analytics",
            "interval_seconds": 900,
            "expected_revision": PLAN_VERSION,
            "idempotency_key": "preview-instance-one",
        },
    ),
    ("apply_schedule_update", "ops.schedules.write", _APPLY),
    (
        "preview_runtime_update",
        "ops.runtime.write",
        {
            "expected_revision": 0,
            "patch": {"pools": {"heavy": 2}},
            "idempotency_key": "preview-instance-one",
        },
    ),
    ("apply_runtime_update", "ops.runtime.write", _APPLY),
]


@pytest.fixture
def operation_transport(action_transport):
    app, token, principal, credentials, admission = action_transport
    principal = replace(principal, grants=ALLOWED_GRANTS)
    credentials[token] = principal
    return app, token, principal, credentials, admission


def test_instance_tool_discovery_publishes_closed_nested_schemas(operation_transport):
    from crate.mcp.tools import ACTION_CATALOG

    app, token, *_ = operation_transport

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            tools = {tool.name: tool for tool in (await session[0].list_tools()).tools}
            for name, _grant, _arguments in _INSTANCE_TOOLS:
                tool = tools[name]
                assert tool.input_schema["additionalProperties"] is False
                assert tool.annotations.read_only_hint is (name not in ACTION_CATALOG)
                assert tool.annotations.open_world_hint is False
            schema = tools["preview_runtime_update"].input_schema
            for definition in schema["$defs"].values():
                if definition.get("type") == "object":
                    assert definition["additionalProperties"] is False
            scope = tools["preview_job_retry"].input_schema["properties"]["scope"]
            assert scope["default"] == "own"
            assert scope["enum"] == ["own", "instance"]

    asyncio.run(run())


@pytest.mark.parametrize("name,grant,arguments", _INSTANCE_TOOLS)
def test_instance_tools_route_authenticated_typed_arguments_through_sdk(
    operation_transport, monkeypatch, name, grant, arguments
):
    from crate.mcp.tools import ACTION_CATALOG

    app, token, principal, _credentials, admission = operation_transport
    payload = {
        "schema_version": "1",
        "availability": "available",
        "data": {"accepted": True},
    }
    operation = Mock(return_value=payload)
    module = (
        "crate.agent_diagnostics" if name == "read_audit" else "crate.agent_operations"
    )
    monkeypatch.setattr(f"{module}.{name}", operation)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool(name, arguments)
            assert result.is_error is False
            assert result.structured_content == payload

    asyncio.run(run())
    operation.assert_called_once()
    assert all(
        operation.call_args.kwargs[key] == value for key, value in arguments.items()
    )
    if name in ACTION_CATALOG:
        assert operation.call_args.args == (principal,)
        assert operation.call_args.kwargs["trace_id"] == "action-transport-trace"
    if name == "preview_job_retry":
        assert operation.call_args.kwargs["scope"] == "own"
    if name == "preview_runtime_update":
        assert operation.call_args.kwargs["patch"] == {"pools": {"heavy": 2}}
    admission.assert_called_once_with(principal.id)


@pytest.mark.parametrize("name,grant,arguments", _INSTANCE_TOOLS)
def test_instance_tool_discovery_and_direct_calls_require_each_exact_grant(
    operation_transport, monkeypatch, name, grant, arguments
):
    app, token, principal, credentials, admission = operation_transport
    credentials[token] = replace(principal, grants=principal.grants - {grant})
    execute = Mock()
    monkeypatch.setattr("crate.mcp.tools._execute", execute)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            tools = await session[0].list_tools()
            assert name not in {tool.name for tool in tools.tools}
            result = await session[0].call_tool(name, arguments)
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    execute.assert_not_called()
    admission.assert_not_called()


def test_instance_action_switch_blocks_every_new_mutation_before_admission(
    operation_transport, monkeypatch
):
    from crate.mcp.tools import ACTION_CATALOG

    app, token, *_rest, admission = operation_transport
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "false")
    execute = Mock()
    monkeypatch.setattr("crate.mcp.tools._execute", execute)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            listed = {tool.name for tool in (await session[0].list_tools()).tools}
            assert {"read_audit", "list_schedules", "get_runtime_policy"} <= listed
            for name, _grant, arguments in _INSTANCE_TOOLS:
                if name not in ACTION_CATALOG:
                    continue
                assert name not in listed
                result = await session[0].call_tool(name, arguments)
                assert result.is_error is True
                assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    execute.assert_not_called()
    admission.assert_not_called()


@pytest.mark.parametrize(
    "name,arguments",
    [
        ("read_audit", {"limit": True}),
        ("read_audit", {"limit": 101}),
        ("read_audit", {"cursor": "x" * 2049}),
        ("read_audit", {"raw_sql": "SELECT *"}),
        ("list_schedules", {"refresh": True}),
        ("get_runtime_policy", {"refresh": True}),
        (
            "preview_job_retry",
            {"job_id": "job-one", "scope": "global", "idempotency_key": "one"},
        ),
        (
            "preview_job_cancel",
            {"job_id": "job-one", "force": True, "idempotency_key": "one"},
        ),
        ("apply_job_retry", {**_APPLY, "scope": "instance"}),
        ("apply_job_cancel", {**_APPLY, "job_id": "other-job"}),
        ("run_schedule", {"idempotency_key": "one"}),
        ("run_schedule", {**_APPLY, "schedule": "compute_analytics"}),
        ("run_schedule", {"schedule": "arbitrary_actor", "idempotency_key": "one"}),
        (
            "preview_schedule_update",
            {
                "schedule": "compute_analytics",
                "interval_seconds": True,
                "expected_revision": PLAN_VERSION,
                "idempotency_key": "one",
            },
        ),
        (
            "preview_schedule_update",
            {
                "schedule": "compute_analytics",
                "interval_seconds": 2678401,
                "expected_revision": PLAN_VERSION,
                "idempotency_key": "one",
            },
        ),
        (
            "preview_runtime_update",
            {
                "expected_revision": True,
                "patch": {"pools": {"heavy": 2}},
                "idempotency_key": "one",
            },
        ),
        (
            "preview_runtime_update",
            {
                "expected_revision": 0,
                "patch": {"pools": {"heavy": True}},
                "idempotency_key": "one",
            },
        ),
        (
            "preview_runtime_update",
            {
                "expected_revision": 0,
                "patch": {"pools": {"other": 2}},
                "idempotency_key": "one",
            },
        ),
        (
            "preview_runtime_update",
            {
                "expected_revision": 0,
                "patch": {"force": True},
                "idempotency_key": "one",
            },
        ),
        ("apply_schedule_update", {**_APPLY, "interval_seconds": 1}),
        ("apply_runtime_update", {**_APPLY, "patch": {"max_running": 64}}),
    ],
)
def test_instance_sdk_rejects_unknown_fields_invalid_bounds_and_mixed_stages(
    operation_transport, monkeypatch, name, arguments
):
    app, token, *_rest, admission = operation_transport
    execute = Mock()
    monkeypatch.setattr("crate.mcp.tools._execute", execute)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool(name, arguments)
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "INVALID_ARGUMENT"

    asyncio.run(run())
    execute.assert_not_called()
    admission.assert_not_called()
