"""Terminal runtime failures retain observable uncertainty without redelivery."""

import hashlib
import json

import pytest

from crate.db.queries.agent_operations import read_job
from crate.agent_operation_catalog import interrupted_operation_result
from crate.db.repositories import agent_operation_jobs as jobs
from crate.db.repositories import agent_plans as plans
from crate.db.repositories.tasks_maintenance import cleanup_zombie_tasks
from crate.db.repositories.tasks_updates import fail_or_retry_task

from tests.agent_command_fixtures import change, scalar
from tests.test_agent_library_operations import (
    OPERATION,
    _apply,
    _running,
    operation_world as operation_world,
)

pytest_plugins = ["tests.agent_command_fixtures"]


@pytest.mark.parametrize("started", [False, True])
@pytest.mark.parametrize("failure", ["timeout", "zombie"])
def test_terminal_failure_is_observable_without_repeating_effects(
    operation_world, started, failure
):
    world = operation_world
    queued, plan = _running(world)
    job_id = queued["job_id"]
    if started:
        assert jobs.start_operation_effect(job_id)
    if failure == "timeout":
        assert fail_or_retry_task(job_id, "Time limit exceeded") == "failed"
    else:
        change(
            "UPDATE tasks SET heartbeat_at=NOW()-INTERVAL '10 minutes' WHERE id=:id",
            {"id": job_id},
        )
        assert cleanup_zombie_tasks() == 1

    owned = plans.get_owned_plan(world["principal"], plan["plan_id"])
    expected_state = "partial" if started else "failed"
    expected_verification = (
        "manual_reconciliation_required" if started else "not_required"
    )
    assert owned["state"] == expected_state
    assert owned["result"]["execution"]["status"] == expected_state
    assert owned["result"]["verification"]["status"] == expected_verification
    if started:
        assert owned["result"]["execution"]["error_code"] == "RECONCILIATION_REQUIRED"

    listed = plans.list_plans(state=expected_state, operations=[OPERATION])
    assert [item["plan_id"] for item in listed] == [plan["plan_id"]]
    assert plans.list_plans(state="queued", operations=[OPERATION]) == []
    diagnostic = read_job(job_id)
    assert diagnostic["status"] == "failed"
    assert diagnostic["execution_status"] == expected_state
    assert diagnostic["verification_status"] == expected_verification
    replay = _apply(world, plan)["result"]
    assert replay["execution"] == owned["result"]["execution"]
    assert replay["verification"] == owned["result"]["verification"]
    assert replay["details"]["plan_id"] == plan["plan_id"]
    assert replay["details"]["job_id"] == job_id
    assert (
        replay["details"]["result_hash"]
        == hashlib.sha256(
            json.dumps(
                owned["result"], sort_keys=True, separators=(",", ":"), default=str
            ).encode()
        ).hexdigest()
    )
    assert _apply(world, plan, key="another-key")["job_id"] == job_id
    assert world["adapter"]["effects"] == []
    assert (
        scalar("SELECT result FROM agent_jobs WHERE task_id=:id", {"id": job_id})
        is None
    )


def test_successful_result_is_not_replaced_by_runtime_failure(operation_world):
    from crate import agent_library_operations as operations

    world = operation_world
    queued, plan = _running(world)
    result = operations.execute_operation_job(queued["job_id"], world["config"])
    assert fail_or_retry_task(queued["job_id"], "Late actor failure") == "completed"
    assert plans.get_plan(plan["plan_id"])["result"] == result
    assert read_job(queued["job_id"])["execution_status"] == "completed"


@pytest.mark.parametrize("status", ["failed", "cancelled", "completed"])
def test_interrupted_result_preserves_recorded_evidence_and_distinguishes_effects(
    status,
):
    result = {
        "execution": {"status": "completed"},
        "verification": {"status": "passed"},
    }
    assert (
        interrupted_operation_result("apply_operation", status, True, result) is result
    )
    assert interrupted_operation_result("prepare_operation", status, True, None) is None
    assert (
        interrupted_operation_result("apply_operation", "running", True, None) is None
    )
    uncertain = interrupted_operation_result("apply_operation", status, True, None)
    assert uncertain["execution"]["status"] == "partial"
    assert uncertain["verification"]["status"] == "manual_reconciliation_required"
    before_effects = interrupted_operation_result("apply_operation", status, None, None)
    assert before_effects["execution"]["status"] == (
        "cancelled" if status == "cancelled" else "failed"
    )
    assert before_effects["verification"]["status"] == "not_required"
