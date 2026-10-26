"""Transport-independent instance tools using the existing plan engine."""

from crate.agent_diagnostics import _envelope
from crate.agent_library_operations import apply_operation, prepare_operation
from crate.db.queries.agent_runtime_policy import (
    read_runtime_policy_state,
    read_schedules_state,
)


def preview_job_retry(
    principal, *, job_id, scope="own", idempotency_key, trace_id=None
):
    return prepare_operation(
        principal,
        "job_retry",
        {"job_id": job_id, "scope": scope},
        idempotency_key,
        trace_id=trace_id,
    )


def preview_job_cancel(
    principal, *, job_id, scope="own", idempotency_key, trace_id=None
):
    return prepare_operation(
        principal,
        "job_cancel",
        {"job_id": job_id, "scope": scope},
        idempotency_key,
        trace_id=trace_id,
    )


def apply_job_retry(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return apply_operation(
        principal,
        "job_retry",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def apply_job_cancel(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return apply_operation(
        principal,
        "job_cancel",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def list_schedules():
    from crate.agent_instance_operations import (
        MCP_RUNNABLE_SCHEDULES,
        MCP_SCHEDULE_REASONS,
    )

    state = read_schedules_state()
    state["readiness"] = {
        name: {
            "run": name in MCP_RUNNABLE_SCHEDULES and interval > 0,
            "update": name in MCP_RUNNABLE_SCHEDULES,
            "minimum_nonzero_interval_seconds": 600
            if name in MCP_RUNNABLE_SCHEDULES
            else None,
            "reason": MCP_SCHEDULE_REASONS.get(
                name,
                "Reviewed analytics rebuild through scheduler dedup, governor and runtime admission",
            ),
            "missing": []
            if name in MCP_RUNNABLE_SCHEDULES and interval > 0
            else [
                "schedule_enabled" if interval <= 0 else "reviewed_execution_contract"
            ],
        }
        for name, interval in state["schedules"].items()
    }
    return _envelope("schedules", state)


def get_runtime_policy():
    return _envelope(
        "runtime_policy",
        read_runtime_policy_state(),
        interpretation="Configured policy and observed worker adoption are distinct. Pool limits govern new starts; they do not resize processes or interrupt running work.",
    )


def run_schedule(
    principal,
    *,
    schedule=None,
    plan_id=None,
    plan_version=None,
    idempotency_key,
    trace_id=None,
):
    if plan_id:
        return apply_operation(
            principal,
            "schedule_run",
            plan_id,
            plan_version,
            idempotency_key,
            trace_id=trace_id,
        )
    return prepare_operation(
        principal,
        "schedule_run",
        {"schedule": schedule},
        idempotency_key,
        trace_id=trace_id,
    )


def preview_schedule_update(
    principal,
    *,
    schedule,
    interval_seconds,
    expected_revision,
    idempotency_key,
    trace_id=None,
):
    return prepare_operation(
        principal,
        "schedule_update",
        {
            "schedule": schedule,
            "interval_seconds": interval_seconds,
            "expected_revision": expected_revision,
        },
        idempotency_key,
        trace_id=trace_id,
    )


def apply_schedule_update(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return apply_operation(
        principal,
        "schedule_update",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def preview_runtime_update(
    principal, *, expected_revision, patch, idempotency_key, trace_id=None
):
    return prepare_operation(
        principal,
        "runtime_update",
        {"expected_revision": expected_revision, "patch": patch},
        idempotency_key,
        trace_id=trace_id,
    )


def apply_runtime_update(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return apply_operation(
        principal,
        "runtime_update",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


__all__ = [
    "apply_job_cancel",
    "apply_job_retry",
    "apply_runtime_update",
    "apply_schedule_update",
    "get_runtime_policy",
    "list_schedules",
    "preview_job_cancel",
    "preview_job_retry",
    "preview_runtime_update",
    "preview_schedule_update",
    "run_schedule",
]
