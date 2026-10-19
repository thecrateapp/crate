"""Public OAuth endpoints, with interactive authorization bound to a human session."""

import html
import os
from collections.abc import Iterable
from urllib.parse import parse_qsl, quote

from authlib.oauth2.rfc6749.errors import OAuth2Error
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import HTMLResponse, JSONResponse, Response

from crate.agent_access import ALLOWED_GRANTS
from crate.agent_diagnostics import DiagnosticError
from crate.agent_scope_catalog import SCOPE_DETAILS
from crate.api.agent_guards import require_agent_admin_session
from crate.api.schemas.mcp_oauth import (
    MCPAuthorizationServerMetadata,
    MCPOAuthErrorResponse,
    MCPOAuthTokenResponse,
    MCPProtectedResourceMetadata,
)
from crate.mcp import oauth
from crate.mcp.oauth_config import oauth_enabled, oauth_settings

router = APIRouter(tags=["auth"])
_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}
_HTML_HEADERS = {
    **_NO_STORE,
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
}


def _scope_label(scope: str) -> str:
    """The Admin catalog label, so consent reads the same as Admin; an unknown
    scope falls back to its id."""
    detail = SCOPE_DETAILS.get(scope)
    return detail.label if detail else scope


def _permission_list(scopes: Iterable[str]):
    return "".join(
        "<li data-scope='"
        + html.escape(scope, quote=True)
        + "'>"
        + html.escape(_scope_label(scope))
        + "</li>"
        for scope in scopes
    )


def _settings():
    if not oauth_enabled():
        raise HTTPException(404, "MCP OAuth is disabled")
    return oauth_settings()


def _parameters(raw: str) -> dict:
    if len(raw.encode("utf-8")) > 8192:
        raise HTTPException(413, "OAuth request exceeds 8 KiB")
    try:
        pairs = parse_qsl(
            raw, keep_blank_values=True, strict_parsing=True, max_num_fields=24
        )
    except ValueError:
        raise HTTPException(400, "Malformed OAuth request") from None
    if len({key for key, _ in pairs}) != len(pairs):
        raise HTTPException(400, "Duplicate OAuth parameters are not allowed")
    return dict(pairs)


async def _form(request):
    if (
        request.headers.get("content-type", "").split(";", 1)[0]
        != "application/x-www-form-urlencoded"
    ):
        raise HTTPException(415, "OAuth requests require form encoding")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 8192:
            raise HTTPException(413, "OAuth request exceeds 8 KiB")
    try:
        return _parameters(body.decode("utf-8"))
    except UnicodeDecodeError:
        raise HTTPException(400, "OAuth request must use UTF-8") from None


def _error(exc):
    if isinstance(exc, OAuth2Error):
        return JSONResponse(
            {"error": exc.error, "error_description": exc.description},
            status_code=exc.status_code,
            headers=_NO_STORE,
        )
    return JSONResponse(
        {"error": "access_denied", "error_description": str(exc)},
        status_code=403,
        headers=_NO_STORE,
    )


def _response(result):
    status, body, headers = result
    headers.update(_NO_STORE)
    if isinstance(body, dict):
        return JSONResponse(body, status_code=status, headers=headers)
    return Response(body, status_code=status, headers=headers)


def _page(body, *, status_code=200):
    return HTMLResponse(
        "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Connect to Crate</title><style>body{font:16px system-ui;margin:4rem auto;padding:0 1.5rem;max-width:40rem;line-height:1.6}button{font:inherit;margin-right:1rem;padding:.6rem 1rem}li{overflow-wrap:anywhere}</style>"
        + body
        + "</html>",
        status_code=status_code,
        headers=_HTML_HEADERS,
    )


@router.get(
    "/.well-known/oauth-protected-resource/mcp",
    response_model=MCPProtectedResourceMetadata,
    summary="Discover the protected MCP resource",
)
def protected_resource_metadata(response: Response):
    settings = _settings()
    response.headers.update(_NO_STORE)
    return {
        "resource": settings.resource,
        "authorization_servers": [settings.issuer],
        "scopes_supported": sorted(ALLOWED_GRANTS),
        "bearer_methods_supported": ["header"],
    }


@router.get(
    "/.well-known/oauth-authorization-server",
    response_model=MCPAuthorizationServerMetadata,
    summary="Discover Crate MCP authorization",
)
def authorization_server_metadata(response: Response):
    settings = _settings()
    response.headers.update(_NO_STORE)
    return {
        "issuer": settings.issuer,
        "authorization_endpoint": settings.issuer + "/oauth/authorize",
        "token_endpoint": settings.issuer + "/oauth/token",
        "revocation_endpoint": settings.issuer + "/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": sorted(ALLOWED_GRANTS),
        "authorization_response_iss_parameter_supported": True,
        "client_id_metadata_document_supported": True,
    }


@router.get(
    "/oauth/authorize",
    response_class=HTMLResponse,
    summary="Review delegated MCP permissions",
)
def authorize(request: Request):
    settings = _settings()
    parameters = _parameters(request.url.query)
    try:
        user = require_agent_admin_session(request)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
        domain = os.environ.get("DOMAIN", "localhost")
        admin_origin = (
            "http://localhost:5173"
            if domain == "localhost"
            else f"https://admin.{domain}"
        )
        return_to = settings.issuer + "/oauth/authorize?" + request.url.query
        login_url = admin_origin + "/login?redirect=" + quote(return_to, safe="")
        return _page(
            "<h1>Connect to Crate</h1><p>Sign in to review the permissions this application requests.</p><a href='"
            + html.escape(login_url, quote=True)
            + "'>Sign in to Crate</a>",
            status_code=401,
        )
    try:
        client, consent_id, nonce = oauth.prepare_consent(parameters, user)
    except (OAuth2Error, DiagnosticError) as exc:
        return _error(exc)
    scopes = _permission_list(client["accepted_scopes"])
    return _page(
        "<h1>Connect "
        + html.escape(client["name"])
        + " to Crate</h1><p>Signed in as "
        + html.escape(user.get("email", ""))
        + ". This application requests:</p><ul>"
        + scopes
        + "</ul><p>Access is limited to your current permissions. <a href='/oauth/connections'>Manage your connected applications</a>.</p><form method='post' action='/oauth/consent'><input type='hidden' name='consent_id' value='"
        + html.escape(consent_id, quote=True)
        + "'><input type='hidden' name='nonce' value='"
        + html.escape(nonce, quote=True)
        + "'><button name='decision' value='approve'>Allow access</button><button name='decision' value='deny'>Deny</button></form>"
    )


@router.post(
    "/oauth/consent",
    response_class=Response,
    summary="Record a session-bound MCP consent decision",
)
async def consent(request: Request):
    _settings()
    parameters = await _form(request)
    user = await run_in_threadpool(require_agent_admin_session, request)
    if parameters.get("decision") not in {"approve", "deny"}:
        raise HTTPException(400, "An explicit consent decision is required")
    try:
        result = await run_in_threadpool(
            oauth.complete_consent,
            parameters.get("consent_id", ""),
            parameters.get("nonce", ""),
            user,
            parameters["decision"] == "approve",
        )
        return _response(result)
    except (OAuth2Error, DiagnosticError) as exc:
        return _error(exc)


@router.post(
    "/oauth/token",
    response_class=JSONResponse,
    response_model=MCPOAuthTokenResponse,
    responses={400: {"model": MCPOAuthErrorResponse}},
    summary="Exchange a PKCE code or rotate a refresh token",
)
async def token(request: Request):
    _settings()
    parameters = await _form(request)
    return _response(
        await run_in_threadpool(oauth.token_response, parameters, dict(request.headers))
    )


@router.post(
    "/oauth/revoke",
    response_class=JSONResponse,
    response_model=dict[str, object],
    responses={400: {"model": MCPOAuthErrorResponse}},
    summary="Revoke an MCP token family",
)
async def revoke(request: Request):
    _settings()
    parameters = await _form(request)
    return _response(
        await run_in_threadpool(
            oauth.revocation_response, parameters, dict(request.headers)
        )
    )


def _connections_login(request):
    domain = os.environ.get("DOMAIN", "localhost")
    admin_origin = (
        "http://localhost:5173" if domain == "localhost" else f"https://admin.{domain}"
    )
    login_url = admin_origin + "/login"
    try:
        login_url += "?redirect=" + quote(
            oauth_settings().issuer + "/oauth/connections", safe=""
        )
    except ValueError:
        pass
    return _page(
        "<h1>Your connected applications</h1><p>Sign in to review and revoke access.</p><a href='"
        + html.escape(login_url, quote=True)
        + "'>Sign in to Crate</a>",
        status_code=401,
    )


@router.get(
    "/oauth/connections",
    response_class=HTMLResponse,
    summary="Review the current user's delegated connections",
)
def connections(request: Request, before: str | None = None):
    from datetime import datetime
    from uuid import UUID

    from crate.db.repositories import mcp_oauth as store

    try:
        user = require_agent_admin_session(request)
    except HTTPException as exc:
        if exc.status_code == 401:
            return _connections_login(request)
        raise
    cursor = None
    if before:
        try:
            if len(before) > 128:
                raise ValueError("Cursor too long")
            created, identifier = before.split("|", 1)
            observed = datetime.fromisoformat(created)
            if observed.utcoffset() is None:
                raise ValueError("Cursor needs a timezone")
            cursor = observed, str(UUID(identifier))
        except (ValueError, TypeError):
            raise HTTPException(400, "Invalid connections cursor") from None
    rows = store.list_oauth_authorizations(user["id"], limit=21, before=cursor)
    visible = rows[:20]
    active = [row for row in visible if row["revoked_at"] is None]
    consent_id = nonce = None
    if active:
        consent_id, nonce = store.create_consent(
            user["id"],
            user["session_id"],
            {
                "client_id": active[0]["client_id"],
                "purpose": "revoke_connection",
                "authorization_ids": [row["id"] for row in active],
            },
        )
    body = (
        "<h1>Your connected applications</h1><p>Signed in as "
        + html.escape(user.get("email", ""))
        + ". Revoking a connection prevents further access and new effects from its pending jobs.</p>"
    )
    if not oauth_enabled():
        body += "<p>OAuth access is currently disabled. You can still revoke existing connections.</p>"
    if not visible:
        body += "<p>No connected applications.</p>"
    for row in visible:
        state = (
            "Revoked"
            if row["revoked_at"]
            else "Connected"
            if row["client_enabled"] and row["principal_enabled"]
            else "Disabled"
        )
        body += (
            "<article><h2>"
            + html.escape(row["client_name"])
            + "</h2><p>"
            + state
            + "</p><ul>"
        )
        body += _permission_list(row["scopes"])
        body += "</ul>"
        if row["revoked_at"] is None:
            if consent_id is None or nonce is None:
                raise HTTPException(503, "Connection controls are unavailable")
            body += (
                "<form method='post' action='/oauth/connections/"
                + row["id"]
                + "/revoke'><input type='hidden' name='consent_id' value='"
                + html.escape(consent_id, quote=True)
                + "'><input type='hidden' name='nonce' value='"
                + html.escape(nonce, quote=True)
                + "'><button>Revoke access</button></form>"
            )
        body += "</article>"
    if len(rows) > 20:
        last = visible[-1]
        next_cursor = quote(last["created_at"].isoformat() + "|" + last["id"], safe="")
        body += (
            "<p><a href='/oauth/connections?before="
            + next_cursor
            + "'>Older connections</a></p>"
        )
    return _page(body)


@router.post(
    "/oauth/connections/{authorization_id}/revoke",
    response_class=Response,
    summary="Revoke a delegated connection owned by the current user",
)
async def revoke_connection(authorization_id: str, request: Request):
    from crate.db.repositories import mcp_oauth as store

    parameters = await _form(request)
    user = await run_in_threadpool(require_agent_admin_session, request)
    try:
        await run_in_threadpool(
            store.revoke_owned_connection,
            authorization_id,
            parameters.get("consent_id", ""),
            parameters.get("nonce", ""),
            user["id"],
            user["session_id"],
        )
    except DiagnosticError as exc:
        return _error(exc)
    return Response(
        status_code=303, headers={**_NO_STORE, "Location": "/oauth/connections"}
    )
