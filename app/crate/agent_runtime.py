"""Exact schedule and runtime updates through shared agent plans."""

from crate.runtime_policy_contract import (
    SCHEDULE_MAX_INTERVAL,
    PolicyRevisionConflict,
    merge_runtime_policy,
)


def _reviewed_schedule(name, interval):
    from crate.agent_diagnostics import DiagnosticError
    from crate.agent_instance_operations import MCP_RUNNABLE_SCHEDULES

    if name not in MCP_RUNNABLE_SCHEDULES:
        raise DiagnosticError(
            "NOT_EXECUTABLE", "This schedule has no reviewed MCP update contract"
        )
    if (
        type(interval) is not int
        or interval != 0
        and not 600 <= interval <= SCHEDULE_MAX_INTERVAL
    ):
        raise DiagnosticError(
            "NOT_EXECUTABLE",
            "Reviewed analytics interval must be zero (disabled) or at least 600 seconds",
        )


def compile_operation(operation: str, parameters: dict, config: dict) -> dict:
    from crate.agent_diagnostics import DiagnosticError
    from crate.db.repositories.runtime_policy import (
        read_runtime_policy_state,
        read_schedules_state,
    )

    if operation == "schedule_update":
        if set(parameters) != {"schedule", "interval_seconds", "expected_revision"}:
            raise ValueError(
                "Schedule updates require schedule, interval_seconds and expected_revision"
            )
        state = read_schedules_state()
        name, interval = parameters["schedule"], parameters["interval_seconds"]
        if (
            name not in state["schedules"]
            or type(interval) is not int
            or not 0 <= interval <= SCHEDULE_MAX_INTERVAL
        ):
            raise ValueError("Invalid schedule name or interval")
        _reviewed_schedule(name, interval)
        if parameters["expected_revision"] != state["revision"]:
            raise DiagnosticError("PLAN_STALE", "Schedule revision changed")
        before, after = state["schedules"][name], interval
        target = {"entity_type": "schedule", "name": name}
        execution = {
            "schedule": name,
            "interval_seconds": interval,
            "expected_revision": state["revision"],
        }
    elif operation == "runtime_update":
        if (
            set(parameters) != {"expected_revision", "patch"}
            or type(parameters["expected_revision"]) is not int
        ):
            raise ValueError(
                "Runtime updates require expected_revision and a typed patch"
            )
        state = read_runtime_policy_state()
        if parameters["expected_revision"] != state["configured_revision"]:
            raise DiagnosticError("PLAN_STALE", "Runtime revision changed")
        before, after = (
            state["policy"],
            merge_runtime_policy(state["policy"], parameters["patch"]),
        )
        target = {"entity_type": "runtime", "name": "policy"}
        execution = {
            "patch": parameters["patch"],
            "expected_revision": state["configured_revision"],
            "expected_policy_hash": state["policy_hash"],
        }
    else:
        raise ValueError("Unsupported runtime operation")
    if before == after:
        raise ValueError("The proposed update does not change current configuration")
    return {
        "document": {
            "operation": operation,
            "risk": "high",
            "targets": [target],
            "changes": [{**target, "before": before, "after": after}],
            "impact": {
                "scope": "instance",
                "configured_policy_only": operation == "runtime_update",
                "running_tasks_interrupted": False,
                "process_resize": False,
            },
            "preconditions": {"revision": parameters["expected_revision"]},
            "verification": {
                "configured_revision": "compare_and_swap",
                "worker_adoption": "observed_separately",
            },
        },
        "execution": execution,
    }


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize
) -> dict:
    from crate.agent_diagnostics import DiagnosticError
    from crate.db.repositories.runtime_policy import (
        update_runtime_policy,
        update_schedules,
    )

    def apply(callback):
        try:
            return authorize(callback)
        except PolicyRevisionConflict as error:
            raise DiagnosticError("PLAN_STALE", str(error)) from None

    if operation == "schedule_update":
        _reviewed_schedule(execution["schedule"], execution["interval_seconds"])
        state = apply(
            lambda: update_schedules(
                {execution["schedule"]: execution["interval_seconds"]},
                expected_revision=execution["expected_revision"],
            )
        )
        return {
            "execution": {
                "status": "completed",
                "configured_revision": state["revision"],
            },
            "verification": {"status": "passed"},
            "projection": {"status": "not_required"},
        }
    if operation == "runtime_update":
        state = apply(
            lambda: update_runtime_policy(
                execution["patch"],
                expected_revision=execution["expected_revision"],
                expected_policy_hash=execution["expected_policy_hash"],
            )
        )
        return {
            "execution": {
                "status": "completed",
                "configured_revision": state["configured_revision"],
                "effective_revision": state["effective_revision"],
            },
            "verification": {
                "status": "configuration_persisted",
                "adoption": state["adoption_status"],
            },
            "projection": {"status": "pending_adoption"},
        }
    raise ValueError("Unsupported runtime operation")


__all__ = ["apply_operation", "compile_operation"]
