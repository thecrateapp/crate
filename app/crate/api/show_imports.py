"""Human cookie review of exact shows; async work uses the common operation engine."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from crate.agent_diagnostics import DiagnosticError
from crate.agent_library_operations import prepare_operation, apply_operation
from crate.api.agent_guards import require_agent_admin_session
from crate.api.agent_integrations import private_response
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.show_imports import (
    ShowImportSelection,
    ShowPlanApplyInput,
    ShowAcceptedJob,
    ShowJobState,
    ShowPlanEvidence,
)
from crate.db.repositories.show_imports import get_show_editor_principal, read_show_job
from crate.db.repositories.agent_plans import get_owned_plan

router = APIRouter(
    prefix="/api/show-imports",
    tags=["curation"],
    dependencies=[Depends(private_response)],
)
_SECURITY = {"security": [{"cookieAuth": []}]}


def _invoke(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except DiagnosticError as error:
        status = (
            403
            if error.code == "FORBIDDEN"
            else 404
            if error.code == "NOT_FOUND"
            else 409
            if error.code
            in {
                "PLAN_STALE",
                "STATE_CONFLICT",
                "APPROVAL_REQUIRED",
                "IDEMPOTENCY_CONFLICT",
                "TARGET_BUSY",
            }
            else 429
            if error.code == "LIMIT_EXCEEDED"
            else 422
        )
        raise HTTPException(
            status, str(error), headers={"X-Crate-Error": error.code}
        ) from None


def _principal(request):
    actor = require_agent_admin_session(request, "curation.shows.write")
    return _invoke(get_show_editor_principal, actor["id"])


@router.post(
    "/plans",
    status_code=202,
    response_model=ShowAcceptedJob,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
    summary="Prepare an exact private show selection without publishing",
)
def prepare_show_plan(request: Request, body: ShowImportSelection):
    principal = _principal(request)
    candidates = [
        item.model_dump(mode="json", exclude_unset=True) for item in body.candidates
    ]
    return _invoke(
        prepare_operation,
        principal,
        "shows_import",
        {"candidates": candidates},
        body.idempotency_key,
    )["data"]


@router.get(
    "/jobs/{job_id}",
    response_model=ShowJobState,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
    summary="Read complete private evidence of an owned show job",
)
def show_job(request: Request, job_id: str):
    if not 1 <= len(job_id) <= 128:
        raise HTTPException(422, "Invalid show job ID")
    return _invoke(read_show_job, _principal(request), job_id)


@router.get(
    "/plans/{plan_id}",
    response_model=ShowPlanEvidence,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
    summary="Review the complete exact owned show plan",
)
def show_plan(request: Request, plan_id: UUID):
    return _invoke(get_owned_plan, _principal(request), str(plan_id))


@router.post(
    "/plans/{plan_id}/apply",
    status_code=202,
    response_model=ShowAcceptedJob,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
    summary="Apply the reviewed show plan with current authority and idempotency",
)
def apply_show_plan(request: Request, plan_id: UUID, body: ShowPlanApplyInput):
    return _invoke(
        apply_operation,
        _principal(request),
        "shows_import",
        str(plan_id),
        body.plan_version,
        body.idempotency_key,
    )["data"]
