"""Capability-separated human AI configuration administration."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import ValidationError

from crate.ai import configuration as service, operations
from crate.ai.contracts import AIConfigurationError
from crate.api.agent_guards import require_agent_admin_session
from crate.api.agent_integrations import private_response
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.permissions import require_permission
from crate.api.schemas import ai_agents as dto
from crate.db.repositories.ai_usage import usage_summary


class PrivateAIRoute(APIRoute):
    """Never echo write-only credentials in FastAPI validation error responses."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def validated(request):
            try:
                return await handler(request)
            except RequestValidationError:
                raise HTTPException(
                    422, "Invalid AI request", headers={"Cache-Control": "no-store"}
                ) from None

        return validated


router = APIRouter(
    route_class=PrivateAIRoute,
    prefix="/api/admin/ai",
    tags=["agents"],
    dependencies=[Depends(private_response)],
)


def _invoke(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except AIConfigurationError as error:
        status = (
            404
            if error.code.endswith("UNKNOWN")
            else 409
            if error.code.endswith(("CONFLICT", "STALE"))
            else 422
        )
        raise HTTPException(
            status, error.message, headers={"X-Crate-Error": error.code}
        ) from None
    except (ValidationError, ValueError, TypeError):
        raise HTTPException(422, "Invalid AI configuration") from None


def _write(request, capability="ai.config.manage"):
    actor = require_agent_admin_session(request, capability)
    if capability == "ai.tests.run" and "ai.config.read" not in actor["capabilities"]:
        raise HTTPException(403, "Permission denied")
    return actor["id"]


@router.get(
    "/snapshot",
    response_model=dto.Snapshot,
    responses=AUTH_ERROR_RESPONSES,
    summary="Read AI configuration without provider requests",
)
def snapshot(request: Request):
    require_permission(request, "ai.config.read")
    return _invoke(service.snapshot)


@router.get(
    "/connections/{id}/models",
    response_model=dto.ModelsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Read cached model capabilities",
)
def models(request: Request, id: str):
    require_permission(request, "ai.config.read")
    return _invoke(service.connection_models, id)


@router.post(
    "/connections",
    response_model=dto.Connection,
    responses=AUTH_ERROR_RESPONSES,
    summary="Create an AI connection",
)
def create_connection(request: Request, body: dto.ConnectionCreate):
    return _invoke(service.create_connection, body.model_dump(), _write(request))


@router.patch(
    "/connections/{id}",
    response_model=dto.Connection,
    responses=AUTH_ERROR_RESPONSES,
    summary="Update an AI connection with revision checking",
)
def patch_connection(request: Request, id: dto.UUIDText, body: dto.ConnectionPatch):
    return _invoke(
        service.patch_connection,
        id,
        body.model_dump(exclude_unset=True, exclude={"expected_revision"}),
        body.expected_revision,
        _write(request),
    )


@router.post(
    "/connections/{id}/credential",
    response_model=dto.Connection,
    responses=AUTH_ERROR_RESPONSES,
    summary="Replace or revoke an AI credential",
)
def credential(request: Request, id: dto.UUIDText, body: dto.CredentialWrite):
    return _invoke(
        service.set_credential,
        id,
        body.api_key,
        body.expected_revision,
        _write(request, "ai.credentials.manage"),
    )


@router.post(
    "/connections/{id}/refresh",
    response_model=dto.Enqueued,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue model catalog discovery",
)
def refresh(request: Request, id: str, body: dto.RefreshRequest):
    return _invoke(
        operations.queue_refresh, id, body.expected_revision, _write(request)
    )


@router.post(
    "/connections/{id}/models",
    response_model=dto.Connection,
    responses=AUTH_ERROR_RESPONSES,
    summary="Register a pending model identifier",
)
def manual_model(request: Request, id: dto.UUIDText, body: dto.ManualModel):
    _write(request)
    return _invoke(
        service.register_manual_model, id, body.model_id, body.expected_revision
    )


@router.post(
    "/profiles",
    response_model=dto.Profile,
    responses=AUTH_ERROR_RESPONSES,
    summary="Create a validated immutable profile",
)
def profile(request: Request, body: dto.ProfileCreate):
    return _invoke(service.create_profile, body.model_dump(), _write(request))


@router.post(
    "/profiles/{id}/versions",
    response_model=dto.ProfileVersion,
    responses=AUTH_ERROR_RESPONSES,
    summary="Append a validated immutable profile version",
)
def profile_version(request: Request, id: dto.UUIDText, body: dto.ProfileVersionCreate):
    return _invoke(
        service.create_profile_version,
        id,
        body.model_dump(exclude={"expected_version"}),
        body.expected_version,
        _write(request),
    )


@router.post(
    "/bindings",
    response_model=dto.BindingsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Atomically apply selected action bindings",
)
def bindings(request: Request, body: dto.BindingBatch):
    return {
        "bindings": _invoke(
            service.apply_bindings, body.model_dump()["changes"], _write(request)
        )
    }


@router.post(
    "/activate",
    response_model=dto.ActivationResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Explicitly snapshot and activate reviewed legacy configuration",
)
def activate(request: Request, body: dto.Activation):
    return _invoke(
        service.activate,
        body.expected_revision,
        _write(request),
        body.expected_review_fingerprint,
    )


@router.post(
    "/profiles/{id}/versions/{version}/test",
    response_model=dto.Enqueued,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue one explicitly acknowledged billable synthetic test",
)
def probe(request: Request, id: dto.UUIDText, version: int, body: dto.ProbeRequest):
    return _invoke(
        operations.queue_probe,
        id,
        version,
        body.expected_fingerprint,
        body.idempotency_key,
        _write(request, "ai.tests.run"),
    )


@router.get(
    "/jobs/{id}",
    response_model=dto.JobResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Read a bounded AI job outcome",
)
def job(request: Request, id: str):
    require_permission(request, "ai.config.read")
    return _invoke(operations.job, id)


@router.get(
    "/activity",
    response_model=dto.Activity,
    responses=AUTH_ERROR_RESPONSES,
    summary="Read bounded AI invocation metadata",
)
def activity(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = Query(None, max_length=2048),
    connection_id: dto.UUIDText | None = None,
    action_id: str | None = Query(None, max_length=200),
    provider: dto.Provider | None = None,
    model_id: dto.ModelID | None = None,
):
    require_permission(request, "ai.usage.read")
    return _invoke(
        operations.activity,
        {
            k: v
            for k, v in {
                "connection_id": connection_id,
                "action_id": action_id,
                "provider": provider,
                "model_id": model_id,
            }.items()
            if v is not None
        },
        limit,
        cursor,
    )


@router.get(
    "/usage",
    response_model=dto.Usage,
    responses=AUTH_ERROR_RESPONSES,
    summary="Read precomputed usage totals",
)
def usage(request: Request):
    require_permission(request, "ai.usage.read")
    return _invoke(usage_summary, daily_limit=5000)
