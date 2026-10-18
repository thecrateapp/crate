"""The shared plan engine keeps preparation, authority and durable effects distinct."""

import copy
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from queue import Queue
from threading import Event
from time import monotonic, sleep
from types import ModuleType
from uuid import uuid4

import pytest
from sqlalchemy import text

from crate import agent_library_operations as operations
from crate.agent_diagnostics import DiagnosticError
from crate.api.permissions import ROLE_CAPABILITIES
from crate.db.queries.agent_operation_targets import operation_target_keys
from crate.db.repositories import agent_operation_jobs as jobs
from crate.db.repositories import agent_plans as plans
from crate.db.repositories import agent_requests as requests
from crate.db.repositories import mcp_oauth as oauth_store
from crate.db.repositories.agent_credentials import revoke_credential
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope, transaction_scope

from tests.agent_command_fixtures import UID, OTHER_UID, change, other_principal, scalar
from tests.agent_plan_support import decide
from tests.test_mcp_oauth_integration import _code, _exchange

pytest_plugins = [
    "tests.agent_command_fixtures",
    "tests.test_agent_admin",
    "tests.test_mcp_oauth_integration",
]

OPERATION = "metadata_update"
GRANT = "library.metadata.write"


def _compiled(uid=UID, *, risk="safe", global_scope=False):
    return {
        "document": {
            "operation": OPERATION,
            "targets": [{"entity_type": "artist", "entity_uid": uid}],
            "source_versions": {"database": "a" * 64},
            "changes": [
                {"entity_uid": uid, "field": "bio", "before": "Old", "after": "New"}
            ],
            "impact": {
                "scope": "global" if global_scope else "selected",
                "filesystem": False,
            },
            "risk": risk,
            "reversibility": "new_plan_required",
        },
        "execution": {
            "entity_uid": uid,
            "private_source_path": "/music/private/source",
            "patch": {"bio": "New"},
        },
    }


@pytest.fixture
def operation_world(command_world, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    module = ModuleType("crate_test_operation_adapter")
    state = {
        "compiled": _compiled(),
        "compilations": [],
        "effects": [],
        "before_effect": None,
    }

    def compile_operation(operation, parameters, config):
        state["compilations"].append((operation, parameters, config))
        return copy.deepcopy(state["compiled"])

    def apply_operation(operation, execution, config, *, task_id, authorize):
        authorize()
        if state["before_effect"] is not None:
            state["before_effect"]()
        authorize(lambda: state["effects"].append((task_id, copy.deepcopy(execution))))
        return {
            "execution": {
                "status": "completed",
                "items": [{"entity_uid": execution["entity_uid"], "status": "applied"}],
            },
            "verification": {"status": "passed"},
        }

    module.compile_operation = compile_operation
    module.apply_operation = apply_operation
    monkeypatch.setitem(sys.modules, module.__name__, module)
    monkeypatch.setitem(operations._ADAPTERS, OPERATION, module.__name__)
    return {**command_world, "adapter": state}


def _queued(world, *, key="prepare", parameters=None):
    return operations.prepare_operation(
        world["principal"],
        OPERATION,
        parameters or {"entity_uid": UID, "patch": {"bio": "New"}},
        key,
    )["data"]


def _prepared(world, *, key="prepare"):
    queued = _queued(world, key=key)
    start_task(queued["job_id"])
    result = operations.execute_operation_job(queued["job_id"], world["config"])
    assert result["execution"]["status"] == "prepared", result
    return result["plan"]


def _apply(world, plan, *, key="apply", principal=None):
    return operations.apply_operation(
        principal or world["principal"],
        OPERATION,
        plan["plan_id"],
        plan["plan_version"],
        key,
    )["data"]


def _running(world, plan=None):
    plan = plan or _prepared(world)
    queued = _apply(world, plan)
    start_task(queued["job_id"])
    return queued, plan


def _cancel_through_reviewed_plan(world, target_job_id, human_actor):
    prepared = operations.prepare_operation(
        world["principal"],
        "job_cancel",
        {"job_id": target_job_id, "scope": "own"},
        "prepare-generic-cancel",
    )["data"]
    assert start_task(prepared["job_id"]) is not None
    control = operations.execute_operation_job(prepared["job_id"], world["config"])
    assert control["execution"]["status"] == "prepared", control
    control_plan = control["plan"]
    assert control_plan["approval_required"] is True
    with pytest.raises(DiagnosticError) as error:
        operations.apply_operation(
            world["principal"],
            "job_cancel",
            control_plan["plan_id"],
            control_plan["plan_version"],
            "apply-generic-cancel",
        )
    assert error.value.code == "APPROVAL_REQUIRED"
    decide(human_actor, control_plan)
    accepted = operations.apply_operation(
        world["principal"],
        "job_cancel",
        control_plan["plan_id"],
        control_plan["plan_version"],
        "apply-generic-cancel",
    )["data"]
    assert start_task(accepted["job_id"]) is not None
    cancelled = operations.execute_operation_job(accepted["job_id"], world["config"])
    assert cancelled["execution"]["status"] == "completed", cancelled
    assert cancelled["execution"]["items"][0]["status"] == "cancelled"


def _with_backend_pid(pids: Queue[int], operation, *args):
    with transaction_scope() as session:
        session.execute(text("SET LOCAL lock_timeout = '10s'"))
        pids.put(session.execute(text("SELECT pg_backend_pid()")).scalar_one())
        return operation(*args, session=session)


def _assert_backend_waits_for(future, worker_pid: int, blocker_pid: int):
    deadline = monotonic() + 8
    while True:
        # Read scopes keep PostgreSQL statistics fresh. Only an actual lock wait
        # on the effect's backend satisfies this assertion, regardless of SQL text.
        with read_scope() as observer:
            blocked = observer.execute(
                text(
                    "SELECT state='active' AND wait_event_type='Lock' "
                    "AND :blocker_pid=ANY(pg_blocking_pids(pid)) "
                    "FROM pg_stat_activity WHERE pid=:worker_pid"
                ),
                {"blocker_pid": blocker_pid, "worker_pid": worker_pid},
            ).scalar_one_or_none()
        if blocked:
            return
        if future.done():
            future.result()
            pytest.fail("Operation completed without waiting for the effect's lock")
        assert monotonic() < deadline, (
            "Operation never waited for the effect's backend to release its lock"
        )
        sleep(0.01)


def test_prepare_admits_a_durable_worker_job_without_compiling_in_request(
    operation_world,
):
    world = operation_world
    parameters = {"entity_uid": UID, "patch": {"bio": "New"}}
    queued = _queued(world, parameters=parameters)
    assert queued["status"] == "pending"
    assert queued["operation"] == "prepare_operation"
    assert world["adapter"]["compilations"] == []
    assert scalar("SELECT COUNT(*) FROM agent_repair_plans") == 0
    assert (
        scalar("SELECT type FROM tasks WHERE id=:id", {"id": queued["job_id"]})
        == "agent_maintenance"
    )
    assert (
        scalar("SELECT max_retries FROM tasks WHERE id=:id", {"id": queued["job_id"]})
        == 0
    )
    assert (
        scalar(
            "SELECT payload->'parameters' FROM agent_jobs WHERE task_id=:id",
            {"id": queued["job_id"]},
        )
        == parameters
    )
    assert scalar(
        "SELECT required_grants FROM agent_jobs WHERE task_id=:id",
        {"id": queued["job_id"]},
    ) == [GRANT]
    assert world["dispatched"] == [("agent_maintenance", queued["job_id"])]


def test_worker_publishes_one_full_plan_and_keeps_execution_data_private(
    operation_world,
):
    world = operation_world
    plan = _prepared(world)
    assert len(world["adapter"]["compilations"]) == 1
    assert plan["operation"] == OPERATION
    assert plan["changes"] == world["adapter"]["compiled"]["document"]["changes"]
    assert plan["source_versions"] == {"database": "a" * 64}
    assert plan["target_count"] == plan["returned_count"] == 1
    assert plan["truncated"] is False
    assert plan["state"] == "ready"
    assert plan["approval_required"] is False
    assert "private_source_path" not in json.dumps(plan)
    assert scalar(
        "SELECT execution_data->'target_keys' FROM agent_repair_plans WHERE id=:id",
        {"id": plan["plan_id"]},
    ) == [f"artist:{UID}"]
    assert scalar("SELECT COUNT(*) FROM agent_repair_plans") == 1
    assert (
        plans.get_owned_plan(world["principal"], plan["plan_id"])["plan_id"]
        == plan["plan_id"]
    )
    assert plans.list_plans(operations=[OPERATION])[0]["plan_id"] == plan["plan_id"]


def test_reviewed_metadata_values_preserve_long_unicode_content(operation_world):
    world = operation_world
    biography = "Biografía íntegra: " + "música contemporánea " * 250
    world["adapter"]["compiled"]["document"]["changes"][0]["after"] = biography
    plan = _prepared(world)

    assert plan["changes"][0]["after"] == biography
    assert plans.get_plan(plan["plan_id"])["changes"][0]["after"] == biography
    assert (
        plans.get_owned_plan(world["principal"], plan["plan_id"])["changes"][0]["after"]
        == biography
    )


def test_cancelled_prepare_never_observes_the_library(operation_world, human_actor):
    world = operation_world
    queued = _queued(world)
    with pytest.raises(DiagnosticError) as error:
        requests.cancel_job(world["principal"], queued["job_id"])
    assert error.value.code == "NOT_EXECUTABLE"
    _cancel_through_reviewed_plan(world, queued["job_id"], human_actor)

    assert start_task(queued["job_id"]) is None
    assert (
        scalar("SELECT status FROM tasks WHERE id=:id", {"id": queued["job_id"]})
        == "cancelled"
    )
    assert (
        scalar(
            "SELECT result_json->'execution'->>'effects' FROM tasks WHERE id=:id",
            {"id": queued["job_id"]},
        )
        == "not_started"
    )
    assert world["adapter"]["compilations"] == []
    assert (
        scalar(
            "SELECT COUNT(*) FROM agent_repair_plans WHERE operation=:operation",
            {"operation": OPERATION},
        )
        == 0
    )


def test_over_budget_worker_prepare_returns_failure_without_partial_plan(
    operation_world,
):
    world = operation_world
    world["adapter"]["compiled"]["document"]["changes"][0]["after"] = "x" * 40000
    queued = _queued(world)
    start_task(queued["job_id"])

    result = operations.execute_operation_job(queued["job_id"], world["config"])

    assert result["execution"]["status"] == "failed"
    assert result["execution"]["error_code"] == "LIMIT_EXCEEDED"
    assert scalar("SELECT COUNT(*) FROM agent_repair_plans") == 0


def test_prepare_is_idempotent_and_key_cannot_be_rebound_to_different_parameters(
    operation_world,
):
    world = operation_world
    first = _queued(world)
    assert _queued(world)["job_id"] == first["job_id"]
    assert _queued(world)["replayed"] is True
    with pytest.raises(DiagnosticError) as caught:
        _queued(world, parameters={"entity_uid": OTHER_UID})
    assert caught.value.code == "IDEMPOTENCY_CONFLICT"
    assert scalar("SELECT COUNT(*) FROM tasks") == 1


def test_one_principal_cannot_prepare_two_active_jobs(operation_world):
    world = operation_world
    _queued(world)
    with pytest.raises(DiagnosticError) as caught:
        _queued(world, key="second", parameters={"entity_uid": OTHER_UID})
    assert caught.value.code == "LIMIT_EXCEEDED"


@pytest.mark.parametrize("boundary", ["prepare", "apply", "owned_read"])
def test_each_boundary_requires_the_current_operation_grant(operation_world, boundary):
    world = operation_world
    plan = _prepared(world) if boundary != "prepare" else None
    change(
        "UPDATE agent_principals SET grants=array_remove(grants,:grant) WHERE id=:id",
        {"id": world["principal"].id, "grant": GRANT},
    )
    with pytest.raises(DiagnosticError) as caught:
        if boundary == "prepare":
            _queued(world)
        elif boundary == "apply":
            _apply(world, plan)
        else:
            plans.get_owned_plan(world["principal"], plan["plan_id"])
    assert caught.value.code == "FORBIDDEN"


def test_owned_plan_uses_its_dynamic_grant_and_authorization_identity(operation_world):
    world = operation_world
    plan = _prepared(world)
    metadata_only = replace(world["principal"], grants=frozenset({GRANT}))
    assert (
        plans.get_owned_plan(metadata_only, plan["plan_id"])["operation"] == OPERATION
    )
    with pytest.raises(DiagnosticError) as caught:
        plans.get_owned_plan(
            replace(metadata_only, authorization_id=str(uuid4())), plan["plan_id"]
        )
    assert caught.value.code == "NOT_FOUND"
    with pytest.raises(DiagnosticError) as caught:
        plans.get_owned_plan(other_principal(), plan["plan_id"])
    assert caught.value.code == "NOT_FOUND"


@pytest.mark.parametrize(
    "risk,global_scope", [("high", False), ("destructive", False), ("safe", True)]
)
def test_high_risk_or_global_plans_always_require_exact_human_approval(
    operation_world, human_actor, risk, global_scope
):
    world = operation_world
    world["adapter"]["compiled"] = _compiled(risk=risk, global_scope=global_scope)
    assert (
        scalar(
            "SELECT require_approval FROM agent_principals WHERE id=:id",
            {"id": world["principal"].id},
        )
        is False
    )
    plan = _prepared(world)
    assert plan["approval_required"] is True
    assert plan["state"] == "awaiting_approval"
    with pytest.raises(DiagnosticError) as caught:
        _apply(world, plan)
    assert caught.value.code == "APPROVAL_REQUIRED"
    authorized = decide(human_actor, plan)
    assert authorized["state"] == "authorized"
    queued = _apply(world, plan)
    assert (
        scalar(
            "SELECT reserved_job_id FROM agent_plan_approvals WHERE plan_id=:id",
            {"id": plan["plan_id"]},
        )
        == queued["job_id"]
    )
    assert _apply(world, plan, key="another-apply")["job_id"] == queued["job_id"]


def test_human_plan_approval_also_requires_the_domain_capability(
    operation_world, human_actor, monkeypatch
):
    world = operation_world
    world["adapter"]["compiled"] = _compiled(risk="high")
    plan = _prepared(world)
    monkeypatch.setitem(
        ROLE_CAPABILITIES,
        "ops",
        tuple(
            set(ROLE_CAPABILITIES["ops"])
            | {"agents.plans.review", "agents.plans.approve"}
        ),
    )
    set_user_roles(human_actor["id"], ["ops"])
    with pytest.raises(DiagnosticError) as caught:
        decide(human_actor, plan)
    assert caught.value.code == "FORBIDDEN"
    assert scalar("SELECT COUNT(*) FROM agent_plan_approvals") == 0


def test_human_cannot_approve_after_required_integration_scope_is_removed(
    operation_world, human_actor
):
    world = operation_world
    world["adapter"]["compiled"] = _compiled(risk="high")
    plan = _prepared(world)
    change(
        "UPDATE agent_principals SET grants=array_remove(grants,:grant) WHERE id=:id",
        {"id": world["principal"].id, "grant": GRANT},
    )
    with pytest.raises(DiagnosticError) as caught:
        decide(human_actor, plan)
    assert caught.value.code in {"FORBIDDEN", "PLAN_STALE"}


def test_apply_once_persists_result_and_never_repeats_effects(operation_world):
    world = operation_world
    queued, plan = _running(world)
    loaded = jobs.load_operation_job(queued["job_id"])
    assert loaded["plan"]["execution_data"]["target_keys"] == [f"artist:{UID}"]
    result = operations.execute_operation_job(queued["job_id"], world["config"])
    assert result["execution"]["status"] == "completed"
    assert result["verification"]["status"] == "passed"
    assert len(world["adapter"]["effects"]) == 1
    assert operations.execute_operation_job(queued["job_id"], world["config"]) == result
    assert (
        jobs.finish_operation(queued["job_id"], {"execution": {"status": "failed"}})
        == result
    )
    replay = _apply(world, plan)["result"]
    assert replay["execution"]["status"] == result["execution"]["status"]
    assert replay["verification"] == result["verification"]
    assert replay["outcome_count"] == 1
    assert replay["details"]["plan_id"] == plan["plan_id"]
    assert replay["details"]["job_id"] == queued["job_id"]
    assert _apply(world, plan, key="later-key")["job_id"] == queued["job_id"]
    assert len(world["adapter"]["effects"]) == 1
    assert plans.get_plan(plan["plan_id"])["state"] == "applied"
    assert plans.get_plan(plan["plan_id"])["result"] == result


def test_concurrent_applies_reserve_exactly_one_job(operation_world):
    world = operation_world
    plan = _prepared(world)
    with ThreadPoolExecutor(max_workers=2) as pool:
        accepted = list(
            pool.map(lambda key: _apply(world, plan, key=key), ["apply-a", "apply-b"])
        )

    assert accepted[0]["job_id"] == accepted[1]["job_id"]
    assert (
        scalar("SELECT COUNT(*) FROM agent_jobs WHERE operation='apply_operation'") == 1
    )


def test_apply_idempotency_key_cannot_identify_another_plan(operation_world):
    world = operation_world
    first = _prepared(world)
    second = _prepared(world, key="second-prepare")
    _apply(world, first)
    with pytest.raises(DiagnosticError) as caught:
        _apply(world, second)
    assert caught.value.code == "IDEMPOTENCY_CONFLICT"


def test_active_target_reservation_covers_other_integrations_and_releases_after_finish(
    operation_world,
):
    world = operation_world
    plan = _prepared(world)
    foreign = other_principal()
    other_job = operations.prepare_operation(
        foreign, OPERATION, {"entity_uid": UID}, "foreign-prepare"
    )["data"]
    start_task(other_job["job_id"])
    other_plan = operations.execute_operation_job(other_job["job_id"], world["config"])[
        "plan"
    ]
    queued = _apply(world, plan)
    with pytest.raises(DiagnosticError) as caught:
        _apply(world, other_plan, principal=foreign, key="foreign-apply")
    assert caught.value.code == "TARGET_BUSY"
    start_task(queued["job_id"])
    operations.execute_operation_job(queued["job_id"], world["config"])
    assert (
        _apply(world, other_plan, principal=foreign, key="foreign-apply")["status"]
        == "pending"
    )


@pytest.mark.parametrize(
    "boundary", ["before_accept", "before_worker", "before_effect"]
)
def test_live_policy_revision_is_checked_at_each_mutation_boundary(
    operation_world, boundary
):
    world = operation_world
    plan = _prepared(world)

    def revise():
        change(
            "UPDATE agent_principals SET policy_revision=policy_revision+1 WHERE id=:id",
            {"id": world["principal"].id},
        )

    if boundary == "before_accept":
        revise()
        with pytest.raises(DiagnosticError) as caught:
            _apply(world, plan)
        assert caught.value.code == "PLAN_STALE"
    else:
        queued, _ = _running(world, plan)
        if boundary == "before_worker":
            revise()
        else:
            world["adapter"]["before_effect"] = revise
        result = operations.execute_operation_job(queued["job_id"], world["config"])
        assert result["execution"]["error_code"] == "PLAN_STALE"
        assert result["execution"]["status"] == "conflict"
    assert world["adapter"]["effects"] == []


@pytest.mark.parametrize(
    "mutation", ["document", "private_execution", "version", "expiry"]
)
def test_worker_rejects_changed_immutable_plan_or_expired_sources(
    operation_world, mutation
):
    world = operation_world
    queued, plan = _running(world)
    statements = {
        "document": "UPDATE agent_repair_plans SET document=jsonb_set(document,'{changes,0,after}','\"Tampered\"'::jsonb) WHERE id=:id",
        "private_execution": "UPDATE agent_repair_plans SET execution_data=jsonb_set(execution_data,'{patch,bio}','\"Tampered\"'::jsonb) WHERE id=:id",
        "version": "UPDATE agent_repair_plans SET version=repeat('f',64) WHERE id=:id",
        "expiry": "UPDATE agent_repair_plans SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:id",
    }
    change(statements[mutation], {"id": plan["plan_id"]})
    result = operations.execute_operation_job(queued["job_id"], world["config"])
    assert result["execution"]["status"] == "conflict"
    assert result["execution"]["error_code"] == "PLAN_STALE"
    assert world["adapter"]["effects"] == []


def test_started_effect_ledger_blocks_redelivery_and_requires_reconciliation(
    operation_world,
):
    world = operation_world
    queued, plan = _running(world)
    assert jobs.start_operation_effect(queued["job_id"]) is True
    assert jobs.start_operation_effect(queued["job_id"]) is False
    result = operations.execute_operation_job(queued["job_id"], world["config"])
    assert result["execution"]["status"] == "partial"
    assert result["execution"]["error_code"] == "RECONCILIATION_REQUIRED"
    assert result["verification"]["status"] == "manual_reconciliation_required"
    assert world["adapter"]["effects"] == []
    assert plans.get_plan(plan["plan_id"])["state"] == "partial"


def test_cancellation_of_pending_generic_apply_is_durable_and_prevents_worker_effect(
    operation_world,
    human_actor,
):
    world = operation_world
    plan = _prepared(world)
    queued = _apply(world, plan)
    with pytest.raises(DiagnosticError) as error:
        requests.cancel_job(world["principal"], queued["job_id"])
    assert error.value.code == "NOT_EXECUTABLE"
    assert plans.get_plan(plan["plan_id"])["state"] == "queued"

    _cancel_through_reviewed_plan(world, queued["job_id"], human_actor)
    assert start_task(queued["job_id"]) is None
    assert plans.get_plan(plan["plan_id"])["state"] == "cancelled"
    result = operations.execute_operation_job(queued["job_id"], world["config"])
    assert result["execution"]["status"] == "cancelled"
    assert world["adapter"]["effects"] == []


def test_large_valid_plan_is_returned_without_silent_field_or_item_truncation(
    operation_world,
):
    world = operation_world
    changes = [
        {"entity_uid": UID, "field": "bio", "before": str(n), "after": "x" * 100}
        for n in range(120)
    ]
    world["adapter"]["compiled"]["document"]["changes"] = changes
    plan = _prepared(world)
    assert len(json.dumps(world["adapter"]["compiled"]["document"]).encode()) < 40000
    assert plan["changes"] == changes
    assert (
        plans.get_owned_plan(world["principal"], plan["plan_id"])["changes"] == changes
    )
    assert plan["truncated"] is False


def test_over_budget_plan_is_rejected_as_a_whole_instead_of_being_truncated(
    operation_world,
):
    world = operation_world
    world["adapter"]["compiled"]["document"]["changes"][0]["after"] = "x" * 40000
    queued = _queued(world)
    start_task(queued["job_id"])
    with pytest.raises(DiagnosticError) as caught:
        jobs.publish_plan(queued["job_id"], world["adapter"]["compiled"])
    assert caught.value.code == "LIMIT_EXCEEDED"
    assert scalar("SELECT COUNT(*) FROM agent_repair_plans") == 0


@pytest.mark.parametrize("missing", ["targets", "changes"])
def test_empty_compiled_plans_are_never_published(operation_world, missing):
    world = operation_world
    queued = _queued(world)
    start_task(queued["job_id"])
    compiled = _compiled()
    compiled["document"][missing] = []
    with pytest.raises(DiagnosticError) as caught:
        jobs.publish_plan(queued["job_id"], compiled)
    assert caught.value.code == "EMPTY_SELECTION"


def test_current_authority_holds_revocation_behind_effect_and_blocks_future_effects(
    operation_world,
):
    world = operation_world
    queued, _ = _running(world)
    assert jobs.start_operation_effect(queued["job_id"])
    entered, release = Event(), Event()
    applying_pids: Queue[int] = Queue()
    revoking_pids: Queue[int] = Queue()
    effects = []

    def effect():
        entered.set()
        assert release.wait(15)
        effects.append("applied")

    with ThreadPoolExecutor(max_workers=2) as pool:
        applying = pool.submit(
            _with_backend_pid,
            applying_pids,
            jobs.with_operation_authority,
            queued["job_id"],
            effect,
        )
        try:
            assert entered.wait(8)
            effect_pid = applying_pids.get(timeout=8)
            revocation = pool.submit(
                _with_backend_pid,
                revoking_pids,
                revoke_credential,
                world["principal"].credential_id,
            )
            _assert_backend_waits_for(
                revocation, revoking_pids.get(timeout=8), effect_pid
            )
        finally:
            release.set()
        applying.result(timeout=5)
        assert revocation.result(timeout=5) is True
    assert effects == ["applied"]
    with pytest.raises(DiagnosticError) as caught:
        jobs.with_operation_authority(
            queued["job_id"], lambda: effects.append("forbidden")
        )
    assert caught.value.code == "FORBIDDEN"
    assert effects == ["applied"]


def test_running_effect_cannot_lose_its_target_reservation_to_concurrent_finish(
    operation_world,
):
    world = operation_world
    queued, _ = _running(world)
    assert jobs.start_operation_effect(queued["job_id"])
    entered, release = Event(), Event()
    applying_pids: Queue[int] = Queue()
    finishing_pids: Queue[int] = Queue()

    def effect():
        entered.set()
        assert release.wait(15)

    result = {
        "execution": {"status": "partial"},
        "verification": {"status": "manual_reconciliation_required"},
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        applying = pool.submit(
            _with_backend_pid,
            applying_pids,
            jobs.with_operation_authority,
            queued["job_id"],
            effect,
        )
        try:
            assert entered.wait(8)
            effect_pid = applying_pids.get(timeout=8)
            finishing = pool.submit(
                _with_backend_pid,
                finishing_pids,
                jobs.finish_operation,
                queued["job_id"],
                result,
            )
            _assert_backend_waits_for(
                finishing, finishing_pids.get(timeout=8), effect_pid
            )
            assert (
                scalar(
                    "SELECT status FROM tasks WHERE id=:id", {"id": queued["job_id"]}
                )
                == "running"
            )
        finally:
            release.set()
        applying.result(timeout=5)
        assert finishing.result(timeout=5) == result
    assert (
        scalar("SELECT status FROM tasks WHERE id=:id", {"id": queued["job_id"]})
        == "completed"
    )


def test_target_resolution_batches_track_album_and_artist_into_one_shared_artist_lock(
    command_world,
):
    album_uid, track_uid = str(uuid4()), str(uuid4())
    with transaction_scope() as session:
        album_id = session.execute(
            text(
                "INSERT INTO library_albums (artist,name,path,entity_uid) VALUES ('Echo','Album','/music/echo/album',CAST(:uid AS uuid)) RETURNING id"
            ),
            {"uid": album_uid},
        ).scalar_one()
        session.execute(
            text(
                "INSERT INTO library_tracks (album_id,artist,album,filename,path,entity_uid) VALUES (:album,'Echo','Album','song.flac','/music/echo/album/song.flac',CAST(:uid AS uuid))"
            ),
            {"album": album_id, "uid": track_uid},
        )
    keys = operation_target_keys(
        [
            {"entity_type": "track", "entity_uid": track_uid},
            {"entity_type": "album", "entity_uid": album_uid},
            {"entity_type": "artist", "entity_uid": UID},
        ]
    )
    assert keys == sorted([f"artist:{UID}", f"album:{album_uid}", f"track:{track_uid}"])
    assert operation_target_keys([{"entity_type": "library", "scope": "global"}]) == [
        "library:global"
    ]
    with pytest.raises(ValueError, match="Too many"):
        operation_target_keys([{"entity_type": "artist", "entity_uid": UID}] * 501)


def test_delegated_prepare_plan_and_effect_keep_live_oauth_context(
    operation_world, oauth_env
):
    world = operation_world
    oauth_store.update_oauth_client("test-client", scopes={GRANT})
    exchanged = _exchange(_code(oauth_env, scope=GRANT))
    assert exchanged[0] == 200
    principal = oauth_store.resolve_oauth_access_token(exchanged[1]["access_token"])[0]
    world["principal"] = principal
    plan = _prepared(world)
    assert (
        plan["authorization_context"]["authorization_id"] == principal.authorization_id
    )
    assert plan["authorization_context"]["accepted_scopes"] == [GRANT]
    queued, _ = _running(world, plan)
    oauth_store.revoke_oauth_authorization(principal.authorization_id)
    result = operations.execute_operation_job(queued["job_id"], world["config"])
    assert result["execution"]["error_code"] == "FORBIDDEN"
    assert world["adapter"]["effects"] == []
