"""Durable exact parent authority for delayed operator effects, using existing plans."""

import os

from crate.agent_access import actions_enabled
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.agent_plans import _get, validate_plan_authorization
from crate.db.repositories.task_control import cancellation_requested
from crate.db.tx import optional_scope


def parent_reference(task_id, *, session=None):
    from crate.db.repositories.agent_operation_jobs import _ACTIVE_AUTHORITY

    active = _ACTIVE_AUTHORITY.get()
    with optional_scope(
        active[1] if active and active[0] == task_id else session
    ) as current:
        job = requests._job(current, task_id)
        if not job or job["operation"] != "apply_operation":
            raise DiagnosticError(
                "FORBIDDEN", "An admitted parent operation is required"
            )
        plan = _get(current, job["payload"]["plan_id"])
        reference = {
            "job_id": task_id,
            "plan_id": str(plan["id"]),
            "plan_version": plan["version"],
        }
        validate_parent(reference, session=current)
        return reference


def validate_parent(reference, *, session):
    if (
        not actions_enabled()
        or os.environ.get("CRATE_MCP_ENABLED", "false").lower() != "true"
    ):
        raise DiagnosticError("FORBIDDEN", "Operator execution is disabled")
    from crate.db.repositories.agent_operation_jobs import _ACTIVE_AUTHORITY

    active = _ACTIVE_AUTHORITY.get()
    if active and active[0] == reference["job_id"]:
        session = active[1]
    job = requests._job(session, reference["job_id"])
    if (
        not job
        or job["operation"] != "apply_operation"
        or job["status"] not in {"running", "completed"}
        or cancellation_requested(reference["job_id"], session=session)
    ):
        raise DiagnosticError("FORBIDDEN", "Parent operation is unavailable or stopped")
    principal = requests._principal_for_job(job)
    requests._authorize(session, principal, job["required_grants"], worker=True)
    plan = _get(session, reference["plan_id"])
    if (
        not plan["unexpired"]
        or str(plan["id"]) != str(job["payload"]["plan_id"])
        or plan["task_id"] != job["task_id"]
        or reference["plan_version"] != plan["version"]
        or requests._hash(
            {"document": plan["document"], "execution": plan["execution_data"]}
        )
        != plan["version"]
    ):
        raise DiagnosticError(
            "PLAN_STALE", "Delayed work no longer matches its exact parent plan"
        )
    validate_plan_authorization(
        session, plan, principal, worker=True, job_id=job["task_id"]
    )
    return job


__all__ = ["parent_reference", "validate_parent"]
