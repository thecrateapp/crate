"""Human administration of machine credentials and delegated MCP connections."""

import os
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from crate.agent_access import ALLOWED_GRANTS, SCOPE_CAPABILITIES, actions_enabled
from crate.agent_diagnostics import DiagnosticError
from crate.api.agent_guards import require_agent_admin_session
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas import (
    AgentCollectionResponse,
    AgentCredentialSecretResponse,
    CredentialExpiry,
    IntegrationCreate,
    IntegrationUpdate,
    OAuthClientCreate,
    OAuthClientUpdate,
)
from crate.db.repositories import agent_integrations as store
from crate.db.repositories.mcp_oauth import list_oauth_clients


def private_response(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


router = APIRouter(
    prefix="/api/admin/agent-integrations",
    tags=["agents"],
    dependencies=[Depends(private_response)],
)


def invoke(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except DiagnosticError as error:
        code = (
            403
            if error.code == "FORBIDDEN"
            else 404
            if error.code == "NOT_FOUND"
            else 409
            if error.code in {"STATE_CONFLICT", "PLAN_STALE", "APPROVAL_REQUIRED"}
            else 400
        )
        raise HTTPException(
            code, str(error), headers={"X-Crate-Error": error.code}
        ) from None
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid integration configuration") from None


@router.get(
    "/catalog",
    response_model=dict[str, Any],
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Read the enabled MCP catalog and scope requirements",
)
def integration_catalog(request: Request):
    user = require_agent_admin_session(request, "agents.integrations.manage")
    from crate.mcp.tools import ACTION_CATALOG, CATALOG

    enabled = os.environ.get("CRATE_MCP_ENABLED", "false").lower() == "true"
    return {
        "mcp_enabled": enabled,
        "actions_enabled": actions_enabled(),
        "oauth_enabled": os.environ.get("CRATE_MCP_OAUTH_ENABLED", "false").lower()
        == "true",
        "scopes": [
            {
                "scope": scope,
                "capability": SCOPE_CAPABILITIES[scope],
                "can_grant": SCOPE_CAPABILITIES[scope] in user["capabilities"],
            }
            for scope in sorted(ALLOWED_GRANTS)
        ],
        "tools": [
            {
                "name": name,
                "grant": value[1],
                "enabled": enabled
                and (name not in ACTION_CATALOG or actions_enabled()),
                "reason": None
                if enabled and (name not in ACTION_CATALOG or actions_enabled())
                else "Feature disabled",
            }
            for name, value in (CATALOG | ACTION_CATALOG).items()
        ],
        "limits": {
            "calls_per_minute": 60,
            "concurrent_calls": 2,
            "global_concurrent_calls": 8,
            "active_maintenance_jobs": 1,
        },
    }


@router.get(
    "/oauth-clients",
    response_model=AgentCollectionResponse,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="List registered OAuth clients without secrets",
)
def oauth_clients(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None, max_length=2048),
):
    require_agent_admin_session(request, "agents.integrations.manage")
    rows = list_oauth_clients(limit=limit + 1, before=cursor)
    return {
        "items": rows[:limit],
        "next_cursor": rows[limit - 1]["client_id"] if len(rows) > limit else None,
    }


@router.post(
    "/oauth-clients",
    response_model=dict[str, Any],
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Register a public OAuth client with exact redirect URIs",
)
def create_oauth_client(request: Request, body: OAuthClientCreate):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(store.manage_oauth_client, actor, create=True, **body.model_dump())


@router.post(
    "/oauth-clients/update",
    response_model=dict[str, Any],
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Update an OAuth client or disable its access",
)
def update_oauth_client(request: Request, body: OAuthClientUpdate):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(store.manage_oauth_client, actor, **body.model_dump())


@router.post(
    "/authorizations/{authorization_id}/revoke",
    response_model=dict[str, bool],
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Revoke a delegated OAuth authorization",
)
def revoke_authorization(request: Request, authorization_id: UUID):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(store.revoke_delegated_authorization, actor, str(authorization_id))


@router.get(
    "",
    response_model=AgentCollectionResponse,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="List service and delegated integrations",
)
def integrations(
    request: Request, limit: int = Query(20, ge=1, le=100), cursor: UUID | None = None
):
    require_agent_admin_session(request, "agents.integrations.manage")
    rows = store.list_integrations(
        limit=limit + 1, before=str(cursor) if cursor else None
    )
    return {
        "items": rows[:limit],
        "next_cursor": rows[limit - 1]["principal_id"] if len(rows) > limit else None,
    }


@router.post(
    "",
    response_model=AgentCredentialSecretResponse,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Provision a service integration and reveal its token once",
)
def create_integration(request: Request, body: IntegrationCreate):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(store.create_integration, actor, **body.model_dump())


@router.get(
    "/{principal_id}",
    response_model=dict[str, Any],
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Read current integration policy without secrets",
)
def integration(request: Request, principal_id: UUID):
    require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(store.get_integration, str(principal_id))


@router.patch(
    "/{principal_id}",
    response_model=dict[str, Any],
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Update integration grants, status or approval policy with revision checking",
)
def update_integration(request: Request, principal_id: UUID, body: IntegrationUpdate):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(
        store.update_integration, actor, str(principal_id), **body.model_dump()
    )


@router.post(
    "/credentials/{credential_id}/rotate",
    response_model=AgentCredentialSecretResponse,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Rotate a service credential and reveal the replacement once",
)
def rotate_credential(request: Request, credential_id: UUID, body: CredentialExpiry):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(
        store.rotate_integration_credential,
        actor,
        str(credential_id),
        **body.model_dump(),
    )


@router.post(
    "/credentials/{credential_id}/revoke",
    response_model=dict[str, bool],
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Revoke a service integration credential",
)
def revoke_credential(request: Request, credential_id: UUID):
    actor = require_agent_admin_session(request, "agents.integrations.manage")
    return invoke(store.revoke_integration_credential, actor, str(credential_id))


@router.get(
    "/{principal_id}/activity",
    response_model=AgentCollectionResponse,
    responses=AUTH_ERROR_RESPONSES,
    openapi_extra={"security": [{"cookieAuth": []}]},
    summary="Read bounded, sanitized integration audit evidence",
)
def integration_activity(
    request: Request,
    principal_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    cursor: int | None = Query(None, ge=1),
):
    require_agent_admin_session(request, "agents.activity.view")
    rows = store.read_integration_activity(
        str(principal_id), limit=limit + 1, before=cursor
    )
    return {
        "items": rows[:limit],
        "next_cursor": str(rows[limit - 1]["id"]) if len(rows) > limit else None,
    }
