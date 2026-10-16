"""Bounded maintenance operations shared by the MCP adapter and workers."""

import os

from crate.agent_access import AgentPrincipal, actions_enabled
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_repair_plans, agent_requests


def _require(principal: AgentPrincipal, grant: str) -> None:
    if not actions_enabled():
        raise DiagnosticError("FORBIDDEN", "MCP actions are disabled")
    if grant not in principal.grants:
        raise DiagnosticError("FORBIDDEN", "Integration lacks the operation grant")


def _result(data: dict) -> dict:
    return {
        "schema_version": "1",
        "availability": "available",
        "source": "agent_maintenance",
        "data": data,
        "interpretation": "Acceptance, execution and verification are separate. Library projection may still be pending.",
    }


def run_health_check(
    principal: AgentPrincipal,
    *,
    artist_uid: str,
    idempotency_key: str,
    check_type: str = "has_photo_desync",
    trace_id: str | None = None,
) -> dict:
    _require(principal, "library.health.run")
    if check_type != "has_photo_desync":
        raise DiagnosticError("INVALID_ARGUMENT", "Only has_photo_desync is enabled")
    return _result(
        agent_requests.accept_health_check(
            principal, artist_uid, idempotency_key, trace_id=trace_id
        )
    )


def preview_repairs(
    principal: AgentPrincipal, *, issue_id: int, trace_id: str | None = None
) -> dict:
    _require(principal, "library.repair.photo_flag")
    return _result(
        agent_repair_plans.preview_repair(principal, issue_id, trace_id=trace_id)
    )


def apply_repairs(
    principal: AgentPrincipal,
    *,
    plan_id: str,
    plan_version: str,
    idempotency_key: str,
    trace_id: str | None = None,
) -> dict:
    _require(principal, "library.repair.photo_flag")
    return _result(
        agent_requests.accept_apply(
            principal, plan_id, plan_version, idempotency_key, trace_id=trace_id
        )
    )


def retry_job(
    principal: AgentPrincipal,
    *,
    job_id: str,
    idempotency_key: str,
    trace_id: str | None = None,
) -> dict:
    _require(principal, "ops.jobs.retry")
    return _result(
        agent_requests.retry_job(principal, job_id, idempotency_key, trace_id=trace_id)
    )


def cancel_job(
    principal: AgentPrincipal, *, job_id: str, trace_id: str | None = None
) -> dict:
    _require(principal, "ops.jobs.cancel_pending")
    return _result(agent_requests.cancel_job(principal, job_id, trace_id=trace_id))


def execute_agent_job(task_id: str, config: dict) -> dict:
    from crate.artist_photo import PhotoObservationError, observe_artist_photo

    try:
        if (
            not actions_enabled()
            or os.environ.get("CRATE_MCP_ENABLED", "false").lower() != "true"
        ):
            raise DiagnosticError("FORBIDDEN", "MCP actions are disabled")
        job = agent_requests.load_job_for_execution(task_id)
        if job.get("result") is not None:
            if (
                job.get("operation") == "apply_repairs"
                and job["result"].get("verification", {}).get("status") == "pending"
                and job["result"].get("execution", {}).get("status")
                in {"applied", "already_satisfied"}
            ):
                return _verify_photo(task_id, config, job["artist_uid"])
            return job["result"]
        if job["operation"] not in {"run_health_check", "apply_repairs"}:
            raise DiagnosticError("FORBIDDEN", "Operation is not in the worker catalog")
        observation = observe_artist_photo(config, job["artist_uid"])
        if job["operation"] == "run_health_check":
            return agent_requests.record_photo_observation(task_id, observation)
        result = agent_requests.complete_photo_repair(task_id, observation)
        if result.get("execution", {}).get("status") in {
            "applied",
            "already_satisfied",
        }:
            return _verify_photo(task_id, config, job["artist_uid"])
        return result
    except (DiagnosticError, PhotoObservationError) as error:
        return agent_requests.fail_job(task_id, error.code, str(error))
    except Exception:  # noqa: BLE001 — persist a safe result, never filesystem paths or credentials.
        return agent_requests.fail_job(
            task_id,
            "OPERATION_FAILED",
            "Maintenance could not finish; inspect persisted execution and verification",
        )


def _verify_photo(task_id, config, artist_uid):
    from crate.artist_photo import PhotoObservationError, observe_artist_photo

    try:
        observation = observe_artist_photo(config, artist_uid)
    except PhotoObservationError as error:
        return agent_requests.record_photo_verification(
            task_id, None, error_code=error.code
        )
    return agent_requests.record_photo_verification(task_id, observation)


__all__ = [
    "apply_repairs",
    "cancel_job",
    "execute_agent_job",
    "preview_repairs",
    "retry_job",
    "run_health_check",
]
