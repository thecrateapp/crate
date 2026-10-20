"""Human cookie review of exact shows; async work uses the common operation engine."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Query
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from datetime import UTC, datetime

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
    ShowExtractionRequest,
)
from crate.db.repositories.show_imports import get_show_editor_principal, read_show_job
from crate.db.repositories.agent_plans import get_owned_plan


class _LimitedShowRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def limited(request):
            if request.url.path.endswith("/uploads"):
                try:
                    size = int(request.headers.get("content-length", "0"))
                except ValueError:
                    raise HTTPException(400, "Invalid upload size") from None
                if size > 9 * 1024 * 1024:
                    raise HTTPException(413, "Image upload exceeds 8 MiB")
                received = 0
                original = request.receive

                async def receive():
                    nonlocal received
                    message = await original()
                    received += len(message.get("body", b""))
                    if received > 9 * 1024 * 1024:
                        raise HTTPException(413, "Image upload exceeds 8 MiB")
                    return message

                request = Request(request.scope, receive)
            return await handler(request)

        return limited


router = APIRouter(
    route_class=_LimitedShowRoute,
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
                "CONFIGURATION_CHANGED",
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
        {"consolidation": body.consolidation.model_dump()}
        if body.consolidation
        else {"candidates": candidates},
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


@router.get("/shows/{show_id}", responses=AUTH_ERROR_RESPONSES, openapi_extra=_SECURITY)
def canonical_show(request: Request, show_id: int):
    from crate.db.queries.show_search import search_canonical_shows

    require_agent_admin_session(request, "library.view")
    if show_id < 1:
        raise HTTPException(422, "Invalid show ID")
    rows = search_canonical_shows(show_id=show_id)["items"]
    if not rows:
        raise HTTPException(404, "Show was not found")
    return rows[0]


@router.post(
    "/uploads",
    status_code=201,
    response_model=ShowPlanEvidence,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
)
async def upload_show_image(request: Request, file: UploadFile = File(...)):
    from crate.db.repositories.show_extraction_jobs import stage_show_image

    principal = await run_in_threadpool(_principal, request)
    data = await file.read(8 * 1024 * 1024 + 1)
    await file.close()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Image exceeds 8 MiB")
    try:
        return await run_in_threadpool(_invoke, stage_show_image, principal, data)
    except ValueError:
        raise HTTPException(
            422, "Use a static PNG, JPEG or WebP up to 20 megapixels"
        ) from None


@router.post(
    "/extractions",
    status_code=202,
    response_model=ShowAcceptedJob,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
)
def extract_shows(request: Request, body: ShowExtractionRequest):
    from crate.db.repositories.show_extraction_jobs import accept_show_extraction

    return _invoke(
        accept_show_extraction,
        _principal(request),
        body.model_dump(mode="json", exclude={"idempotency_key"}),
        body.idempotency_key,
    )


@router.get(
    "/availability",
    response_model=ShowPlanEvidence,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
)
def show_import_availability(request: Request):
    from crate.db.repositories.show_extraction_jobs import show_extractor_readiness
    from crate.show_extraction import SHOW_ACTIONS, show_llm_configuration

    _principal(request)
    config = show_llm_configuration()
    state = show_extractor_readiness()
    checked = state.get("checked_at")
    fresh = bool(
        checked
        and (datetime.now(UTC) - datetime.fromisoformat(checked)).total_seconds() < 900
    )
    if (
        not fresh
        or state.get("configuration_fingerprint") != config["configuration_fingerprint"]
    ):
        state = {
            "ocr": {"available": False, "reason": "Worker readiness not checked yet"}
        }
    return {
        **config,
        **state,
        "actions": {mode: show_llm_configuration(mode) for mode in SHOW_ACTIONS},
        "limits": {
            "images": 3,
            "image_bytes": 8388608,
            "image_pixels": 20000000,
            "draft_candidates": 200,
            "selected_shows": 50,
            "plan_bytes": 40000,
            "source_ttl_seconds": 86400,
        },
        "interpretation": "Configuration, connectivity and vision support are separate. Check worker readiness without a billable model call. Local OCR never requires an LLM.",
    }


@router.get(
    "/drafts",
    response_model=ShowPlanEvidence,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
)
def list_show_drafts(request: Request):
    from crate.db.repositories.show_extraction_jobs import read_show_drafts

    return _invoke(read_show_drafts, _principal(request))


@router.get(
    "/drafts/{draft_id}",
    response_model=ShowPlanEvidence,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
)
def get_show_draft(request: Request, draft_id: UUID):
    from crate.db.repositories.show_extraction_jobs import read_show_drafts

    return _invoke(read_show_drafts, _principal(request), str(draft_id))


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=ShowPlanEvidence,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
)
def stop_show_job(request: Request, job_id: str):
    from crate.db.repositories.show_extraction_jobs import cancel_show_job

    return _invoke(cancel_show_job, _principal(request), job_id)


@router.get(
    "/shows",
    response_model=ShowPlanEvidence,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra=_SECURITY,
)
def consolidation_shows(
    request: Request, ids: list[int] = Query(min_length=1, max_length=10)
):
    from crate.db.repositories.show_consolidation_plans import read_consolidation_shows

    _principal(request)
    return {"items": _invoke(read_consolidation_shows, ids)}
