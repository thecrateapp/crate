"""Reviewed job controls and scheduler admission through immutable plans."""

from crate.agent_access import AgentPrincipal
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.agent_task_control import (
    apply_control,
    inspect_control,
    principal_context,
)

MCP_RUNNABLE_SCHEDULES = frozenset({"compute_analytics"})


def compile_operation(operation, parameters, config, *, principal: AgentPrincipal):
    if operation in {"job_retry", "job_cancel"}:
        if set(parameters) != {"job_id", "scope"} or parameters["scope"] not in {
            "own",
            "instance",
        }:
            raise ValueError("An exact job and control scope are required")
        execution = inspect_control(principal, operation, parameters)
        target = {"entity_type": "task", "name": execution["job_id"]}
        change = {
            "task_type": execution["type"],
            "from": execution["status"],
            "to": "queued" if operation == "job_retry" else "cancellation_requested",
        }
    elif operation == "schedule_run":
        from crate.db.queries.agent_runtime_policy import read_schedules_state

        if (
            set(parameters) != {"schedule"}
            or parameters["schedule"] not in MCP_RUNNABLE_SCHEDULES
        ):
            raise DiagnosticError(
                "NOT_EXECUTABLE", "This schedule has no reviewed MCP execution contract"
            )
        state = read_schedules_state()
        name = parameters["schedule"]
        if state["schedules"][name] <= 0:
            raise DiagnosticError("NOT_EXECUTABLE", "Schedule is disabled")
        execution = {"schedule": name, "principal": principal_context(principal)}
        target = {"entity_type": "schedule", "name": name}
        change = {
            "from": "idle",
            "to": "guarded_enqueue",
            "dedup": True,
            "governor": True,
        }
    else:
        raise ValueError("Unknown instance control")
    return {
        "document": {
            "operation": operation,
            "risk": "high",
            "targets": [target],
            "changes": [{**target, **change}],
            "impact": {"scope": "instance"},
            "preconditions": {"exact_source": execution.get("fingerprint")},
            "verification": {"status": "observe_target_job"},
        },
        "execution": execution,
    }


def apply_operation(operation, execution, config, *, task_id, authorize):
    if operation == "schedule_run":
        from crate.scheduler import guarded_run_schedule

        context = execution["principal"]
        result = authorize(
            lambda: guarded_run_schedule(
                execution["schedule"],
                origin="agent",
                actor_user_id=context["authorization_context"].get("actor_user_id"),
                agent_context=context,
                required_grants=["ops.schedules.run"],
            )
        )
    else:
        result = authorize(lambda: apply_control(operation, execution))
    return {
        "execution": {"status": "completed", "items": [result]},
        "verification": {
            "status": "pending"
            if result["status"] in {"queued", "running", "delegated"}
            else "passed"
        },
        "projection": {"status": "not_required"},
    }


__all__ = ["compile_operation", "apply_operation"]
