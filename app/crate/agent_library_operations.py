"""Closed worker adapters sharing agent plans, admission and durable effects."""

import importlib
import os

from crate.agent_access import actions_enabled
from crate.agent_diagnostics import DiagnosticError
from crate.agent_operation_catalog import operation_grant
from crate.db.queries.agent_operation_targets import operation_target_keys
from crate.db.repositories import agent_operation_jobs as jobs

_ADAPTERS = {
    "acquisition": "crate.agent_acquisition",
    "acquisition_publish": "crate.agent_acquisition",
    "tidal_acquisition": "crate.agent_acquisition",
    "tidal_artist_acquisition": "crate.agent_acquisition",
    "shows_import": "crate.agent_shows",
    "job_retry": "crate.agent_instance_operations",
    "job_cancel": "crate.agent_instance_operations",
    "schedule_run": "crate.agent_instance_operations",
    "schedule_update": "crate.agent_runtime",
    "runtime_update": "crate.agent_runtime",
    "health_check": "crate.agent_health",
    "quality_check": "crate.agent_health",
    "repairs": "crate.agent_repairs",
    "metadata_update": "crate.agent_metadata",
    "enrichment": "crate.agent_enrichment",
    "analysis": "crate.agent_analysis",
    "library_sync": "crate.agent_sync",
    "metadata_export": "crate.agent_portability",
    "metadata_rehydrate": "crate.agent_portability",
    "editorial_change": "crate.agent_editorial",
}


def _require(principal, operation):
    if principal.human_actor_id is not None:
        if operation == "shows_import" and "curation.shows.write" in principal.grants:
            return
        raise DiagnosticError(
            "FORBIDDEN", "Human show editor permits only reviewed show imports"
        )
    grants = (
        {"editorial.prepare", "editorial.publish"}
        if operation == "editorial_change"
        else {operation_grant(operation)}
    )
    if not actions_enabled() or not principal.grants.intersection(grants):
        raise DiagnosticError(
            "FORBIDDEN", "Library operation is not granted or actions are disabled"
        )


def prepare_operation(
    principal, operation, parameters, idempotency_key, *, trace_id=None
):
    _require(principal, operation)
    return _envelope(
        jobs.prepare_operation(
            principal, operation, parameters, idempotency_key, trace_id=trace_id
        )
    )


def apply_operation(
    principal, operation, plan_id, plan_version, idempotency_key, *, trace_id=None
):
    _require(principal, operation)
    return _envelope(
        jobs.apply_operation(
            principal,
            operation,
            plan_id,
            plan_version,
            idempotency_key,
            trace_id=trace_id,
        )
    )


def _envelope(data):
    return {
        "schema_version": "1",
        "availability": "available",
        "source": "agent_library_operations",
        "data": data,
        "interpretation": "An accepted job, applied effects and verified final pipeline results are distinct. Inspect the exact plan and its result.",
    }


def execute_operation_job(task_id: str, config: dict) -> dict:
    from crate.worker_handlers import is_cancelled

    effect_depth = 0
    attempted_effect = False
    human_show_editor = False

    def authorize(effect=None):
        nonlocal effect_depth, attempted_effect
        if is_cancelled(task_id):
            raise DiagnosticError("CANCELLED", "Operation cancellation was requested")
        if not human_show_editor and (
            not actions_enabled()
            or os.environ.get("CRATE_MCP_ENABLED", "false").lower() != "true"
        ):
            raise DiagnosticError("FORBIDDEN", "MCP library operations are disabled")
        if effect_depth:
            from crate.operator_provenance import validate

            validate(
                job["principal_id"],
                job["plan"]["execution_data"].get("operator_provenance"),
            )
            return effect() if effect is not None else None

        def held():
            nonlocal effect_depth, attempted_effect
            effect_depth += 1
            try:
                if effect is not None:
                    attempted_effect = True
                    return effect()
                return None
            finally:
                effect_depth -= 1

        return jobs.with_operation_authority(task_id, held)

    try:
        job = jobs.load_operation_job(task_id)
        context = job.get("authorization_context") or {}
        human_show_editor = bool(
            context.get("human_actor_id")
            and job["payload"]["domain_operation"] == "shows_import"
        )
        if not human_show_editor and (
            not actions_enabled()
            or os.environ.get("CRATE_MCP_ENABLED", "false").lower() != "true"
        ):
            raise DiagnosticError("FORBIDDEN", "MCP library operations are disabled")
        if job["result"] is not None:
            return job["result"]
        operation = job["payload"]["domain_operation"]
        adapter = importlib.import_module(_ADAPTERS[operation])
        if job["operation"] == "prepare_operation":
            if is_cancelled(task_id):
                raise DiagnosticError(
                    "CANCELLED", "Operation cancellation was requested"
                )
            compiled = adapter.compile_operation(
                operation,
                job["payload"]["parameters"],
                config,
                **(
                    {"task_id": task_id}
                    if operation
                    in {
                        "acquisition",
                        "acquisition_publish",
                        "tidal_acquisition",
                        "tidal_artist_acquisition",
                    }
                    else {}
                ),
                **(
                    {"principal": jobs.requests._principal_for_job(job)}
                    if operation
                    in {
                        "job_retry",
                        "job_cancel",
                        "schedule_run",
                        "editorial_change",
                        "shows_import",
                        "acquisition",
                        "acquisition_publish",
                        "tidal_acquisition",
                        "tidal_artist_acquisition",
                    }
                    else {}
                ),
            )
            compiled["execution"]["target_keys"] = operation_target_keys(
                compiled["document"]["targets"]
            )
            if not compiled["execution"]["target_keys"]:
                raise DiagnosticError(
                    "INVALID_ARGUMENT", "Operation has no lockable local targets"
                )
            return jobs.publish_plan(task_id, compiled)
        if not jobs.start_operation_effect(task_id):
            return jobs.finish_operation(
                task_id,
                {
                    "execution": {
                        "status": "partial",
                        "error_code": "RECONCILIATION_REQUIRED",
                        "error": "A previous delivery may have started effects. Inspect current state and prepare a new plan; this delivery did not repeat effects.",
                    },
                    "verification": {"status": "manual_reconciliation_required"},
                },
            )
        authorize()
        result = adapter.apply_operation(
            operation,
            job["plan"]["execution_data"],
            config,
            task_id=task_id,
            authorize=authorize,
        )
        return jobs.finish_operation(task_id, result)
    except DiagnosticError as error:
        status = (
            "partial"
            if attempted_effect
            else "cancelled"
            if error.code == "CANCELLED"
            else "conflict"
            if error.code in {"PLAN_STALE", "EVIDENCE_STALE"}
            else "failed"
        )
        return jobs.finish_operation(
            task_id,
            {
                "execution": {
                    "status": status,
                    "error_code": error.code,
                    "error": str(error),
                },
                "verification": {
                    "status": "manual_reconciliation_required"
                    if attempted_effect
                    else "not_required"
                },
            },
        )
    except (ValueError, KeyError) as error:
        from crate.agent_diagnostics import _text

        return jobs.finish_operation(
            task_id,
            {
                "execution": {
                    "status": "partial" if attempted_effect else "conflict",
                    "error_code": "SOURCE_CONFLICT",
                    "error": _text(str(error), 512),
                },
                "verification": {
                    "status": "manual_reconciliation_required"
                    if attempted_effect
                    else "not_required"
                },
            },
        )
    except Exception:  # noqa: BLE001 — persist partial uncertainty without paths or credentials.
        return jobs.finish_operation(
            task_id,
            {
                "execution": {
                    "status": "partial" if attempted_effect else "failed",
                    "error_code": "OPERATION_FAILED",
                    "error": "Operation could not finish; inspect its persisted effects",
                },
                "verification": {
                    "status": "manual_reconciliation_required"
                    if attempted_effect
                    else "not_required"
                },
            },
        )


__all__ = ["apply_operation", "execute_operation_job", "prepare_operation"]
