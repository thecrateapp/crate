"""The existing agent job/plan engine, extended to closed library operations."""

import json
from uuid import uuid4

from sqlalchemy import text

from crate.agent_access import AgentPrincipal
from crate.agent_diagnostics import DiagnosticError
from crate.agent_operation_catalog import operation_grant, public_operation_result
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.agent_plans import (
    _document,
    _get,
    reserve_plan_approval,
    validate_plan_authorization,
)
from crate.db.tx import optional_scope

_MUTATES_QUALITY = {
    "acquisition_publish",
    "repairs",
    "metadata_update",
    "enrichment",
    "library_sync",
    "metadata_rehydrate",
}


def prepare_operation(
    principal: AgentPrincipal,
    operation: str,
    parameters: dict,
    idempotency_key: str,
    *,
    trace_id=None,
    session=None,
) -> dict:
    grant = (
        "editorial.publish"
        if operation == "editorial_change" and parameters.get("kind") == "visibility"
        else operation_grant(operation)
    )
    payload = {
        "domain_operation": operation,
        "parameters": parameters,
        "required_grants": [grant],
        "target_keys": [],
    }
    from crate.operator_provenance import capture

    provenance = capture(principal.id)
    if provenance is not None:
        payload["operator_provenance"] = provenance
    control = operation in {"job_retry", "job_cancel"}
    request_hash = (
        requests._hash({"domain_operation": operation, "parameters": parameters})
        if control
        else requests._hash(payload)
    )
    key = requests._key(idempotency_key)
    with optional_scope(session) as current:
        requests._authorize(current, principal, {grant})
        requests._lock_principal(current, principal.id)
        replay = requests._replay(
            current, principal, "prepare_operation", key, request_hash
        )
        if replay:
            accepted = requests._job(current, replay["job_id"])
            if accepted is None:
                raise DiagnosticError(
                    "RESULT_EXPIRED", "Previously accepted job has expired"
                )
            requests._authorize(current, principal, accepted["required_grants"])
            return replay
        if control:
            from crate.db.repositories.agent_task_control import inspect_control

            payload["required_grants"] = inspect_control(
                principal, operation, parameters, session=current
            )["required_grants"]
            requests._authorize(current, principal, payload["required_grants"])
        return requests._accept(
            current,
            principal,
            "prepare_operation",
            payload,
            key,
            request_hash=request_hash,
            trace_id=trace_id,
        )


def publish_plan(task_id: str, compiled: dict, *, session=None) -> dict:
    document, execution = compiled["document"], compiled["execution"]
    if not document.get("targets") or not document.get("changes"):
        raise DiagnosticError(
            "EMPTY_SELECTION", "An operation plan requires exact targets and changes"
        )
    if len(json.dumps(document, default=str).encode()) > 40000:
        raise DiagnosticError(
            "LIMIT_EXCEEDED",
            "The complete plan exceeds its review budget; narrow the selection",
        )
    with optional_scope(session) as current:
        job = requests._execution_job(current, task_id)
        if job["result"] is not None:
            return job["result"]
        if (
            job["operation"] != "prepare_operation"
            or document["operation"] != job["payload"]["domain_operation"]
        ):
            raise DiagnosticError(
                "STATE_CONFLICT", "Compiled operation does not match its job"
            )
        from crate.operator_provenance import validate

        reviewed = job["payload"].get("operator_provenance")
        validate(job["principal_id"], reviewed)
        if reviewed is not None:
            document = {**document, "operator_provenance": reviewed}
            execution = {**execution, "operator_provenance": reviewed}
        policy = (
            current.execute(
                text(
                    "SELECT policy_revision,require_approval FROM agent_principals WHERE id=:id FOR SHARE"
                ),
                {"id": job["principal_id"]},
            )
            .mappings()
            .one()
        )
        mandatory = (
            reviewed is not None
            or document.get("risk") in {"high", "destructive"}
            or document.get("impact", {}).get("scope") == "global"
        )
        approval = bool(mandatory or policy["require_approval"])
        plan_id = str(uuid4())
        version = requests._hash({"document": document, "execution": execution})
        current.execute(
            text("""INSERT INTO agent_repair_plans
            (id,principal_id,version,operation,document,execution_data,mandatory_approval,approval_required,
             policy_revision,required_grants,authorization_context,state)
            VALUES (:id,:principal,:version,:operation,CAST(:document AS jsonb),CAST(:execution AS jsonb),
             :mandatory,:approval,:policy,:grants,CAST(:context AS jsonb),:state)"""),
            {
                "id": plan_id,
                "principal": job["principal_id"],
                "version": version,
                "operation": document["operation"],
                "document": json.dumps(document, default=str),
                "execution": json.dumps(execution, default=str),
                "mandatory": mandatory,
                "approval": approval,
                "policy": policy["policy_revision"],
                "grants": job["required_grants"],
                "context": json.dumps(job["authorization_context"]),
                "state": "awaiting_approval" if approval else "ready",
            },
        )
        result = {
            "execution": {
                "status": "prepared",
                "plan_id": plan_id,
                "plan_version": version,
            },
            "verification": {"status": "not_required"},
            "plan": _document(_get(current, plan_id)),
        }
        requests._store_result(current, job, result, "completed")
        requests._audit(
            current,
            requests._principal_for_job(job),
            "agent.plan.prepared",
            job_id=task_id,
            plan_id=plan_id,
        )
        return result


def apply_operation(
    principal: AgentPrincipal,
    operation: str,
    plan_id: str,
    plan_version: str,
    idempotency_key: str,
    *,
    trace_id=None,
    session=None,
) -> dict:
    grant = operation_grant(operation)
    plan_id, key = requests._uuid(plan_id), requests._key(idempotency_key)
    request_payload = {
        "domain_operation": operation,
        "plan_id": plan_id,
        "plan_version": plan_version,
    }
    with optional_scope(session) as current:
        requests._authorize(
            current, principal, set() if operation == "editorial_change" else {grant}
        )
        requests._lock_principal(current, principal.id)
        replay = requests._replay(
            current, principal, "apply_operation", key, requests._hash(request_payload)
        )
        if replay and replay["status"] in {"completed", "failed", "cancelled"}:
            accepted = requests._job(current, replay["job_id"])
            if accepted is not None:
                requests._authorize(current, principal, accepted["required_grants"])
            return replay
        plan = _get(current, plan_id, lock=True)
        if plan["operation"] != operation:
            raise DiagnosticError(
                "INVALID_ARGUMENT", "Plan has a different library operation"
            )
        validate_plan_authorization(current, plan, principal, job_id=plan["task_id"])
        extra_grants = set()
        if operation == "editorial_change":
            extra_grants = {"editorial.publish"}
            if plan["document"].get("kind") != "visibility":
                extra_grants.add("editorial.write")
            requests._authorize(current, principal, extra_grants)
            requests._authorize(current, principal, plan["required_grants"])
        if replay:
            return replay
        if plan["version"] != plan_version:
            raise DiagnosticError("PLAN_STALE", "Plan version changed")
        if plan["document"].get("executable") is False:
            raise DiagnosticError(
                "NOT_EXECUTABLE", "This plan contains manual or diagnostic items only"
            )
        if plan["task_id"]:
            requests._remember_request(
                current,
                principal,
                "apply_operation",
                key,
                requests._hash(request_payload),
                plan["task_id"],
            )
            return requests._summary(requests._job(current, plan["task_id"]), True)
        if not plan["unexpired"] or plan["state"] not in {"ready", "authorized"}:
            raise DiagnosticError("PLAN_STALE", "Plan is not ready or has expired")
        payload = {
            **request_payload,
            "required_grants": sorted(set(plan["required_grants"]) | extra_grants),
            "target_keys": plan["execution_data"]["target_keys"],
        }
        summary = requests._accept(
            current,
            principal,
            "apply_operation",
            payload,
            key,
            request_hash=requests._hash(request_payload),
            trace_id=trace_id,
        )
        current.execute(
            text(
                "UPDATE agent_repair_plans SET state='queued',task_id=:task WHERE id=:id"
            ),
            {"task": summary["job_id"], "id": plan_id},
        )
        reserve_plan_approval(current, plan_id, summary["job_id"])
        return summary


def load_operation_job(task_id: str, *, session=None) -> dict:
    with optional_scope(session) as current:
        job = requests._execution_job(current, task_id)
        if job["result"] is not None:
            return job
        if job["operation"] == "apply_operation":
            plan = _get(current, job["payload"]["plan_id"])
            if job["result"] is None:
                _validate_execution(current, job, plan)
            job["plan"] = plan
        return job


def _validate_execution(current, job, plan):
    if (
        not plan["unexpired"]
        or plan["state"] not in {"queued", "running"}
        or plan["task_id"] != job["task_id"]
    ):
        raise DiagnosticError("PLAN_STALE", "Plan is no longer executable")
    if (
        requests._hash(
            {"document": plan["document"], "execution": plan["execution_data"]}
        )
        != plan["version"]
    ):
        raise DiagnosticError(
            "PLAN_STALE", "Stored plan content does not match its immutable version"
        )
    validate_plan_authorization(
        current,
        plan,
        requests._principal_for_job(job),
        worker=True,
        job_id=job["task_id"],
    )


def start_operation_effect(task_id: str, *, session=None) -> bool:
    with optional_scope(session) as current:
        job = requests._execution_job(current, task_id)
        if job["result"] is not None or job["effect_started_at"] is not None:
            return False
        plan = _get(current, job["payload"]["plan_id"])
        _validate_execution(current, job, plan)
        current.execute(
            text("UPDATE agent_jobs SET effect_started_at=NOW() WHERE task_id=:id"),
            {"id": task_id},
        )
        if job["payload"]["domain_operation"] in _MUTATES_QUALITY:
            from crate.db.analytics_quality_surface import mark_quality_report_stale

            mark_quality_report_stale(session=current)
        return True


def with_operation_authority(task_id: str, effect, *, session=None):
    with optional_scope(session) as current:
        initial = requests._job(current, task_id)
        if initial is None:
            raise DiagnosticError("NOT_FOUND", "Operation job is unavailable")
        requests._authorize(
            current,
            requests._principal_for_job(initial),
            initial["required_grants"],
            worker=True,
        )
        current.execute(
            text("SELECT task_id FROM agent_jobs WHERE task_id=:id FOR UPDATE"),
            {"id": task_id},
        )
        job = requests._job(current, task_id)
        if job is None or job["status"] != "running" or job["result"] is not None:
            raise DiagnosticError("STATE_CONFLICT", "Operation is no longer running")
        plan = _get(current, job["payload"]["plan_id"])
        _validate_execution(current, job, plan)
        return effect() if effect is not None else None


def finish_operation(task_id: str, result: dict, *, session=None) -> dict:
    with optional_scope(session) as current:
        job = requests._job(current, task_id, lock=True)
        if job is None:
            raise DiagnosticError("NOT_FOUND", "Operation job is unavailable")
        if job["result"] is not None:
            return job["result"]
        execution = result["execution"]["status"]
        status = (
            "cancelled"
            if execution == "cancelled"
            else "failed"
            if execution in {"failed", "conflict"}
            else "completed"
        )
        requests._store_result(current, job, result, status)
        if (
            job["operation"] == "apply_operation"
            and job["payload"]["domain_operation"] in _MUTATES_QUALITY
        ):
            from crate.db.analytics_quality_surface import mark_quality_report_stale

            mark_quality_report_stale(session=current)
        requests._audit(
            current,
            requests._principal_for_job(job),
            "agent.operation.finished",
            job_id=task_id,
            plan_id=job["payload"].get("plan_id"),
            result=public_operation_result(result)
            if job["payload"].get("domain_operation")
            in {"shows_import", "shows_extract"}
            else result,
        )
        return result


__all__ = [
    "apply_operation",
    "finish_operation",
    "load_operation_job",
    "prepare_operation",
    "publish_plan",
    "start_operation_effect",
    "with_operation_authority",
]
