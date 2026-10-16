"""Dedicated machine authentication through the official SDK Bearer backend."""

import anyio
from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend
from pydantic import AnyHttpUrl
from starlette.requests import Request
from starlette.responses import JSONResponse

from crate.db.repositories.agent_credentials import resolve_credential
from crate.mcp.oauth import CrateTokenVerifier
from crate.mcp.oauth_config import oauth_enabled, oauth_settings
from crate import metrics


class AgentAuth:
    def __init__(self, app):
        self.app = app
        self.limiter = anyio.CapacityLimiter(8)
        self.verifier = CrateTokenVerifier(
            self.limiter, service_resolver=resolve_credential
        )
        resource = AnyHttpUrl(oauth_settings().resource) if oauth_enabled() else None
        self.backend = BearerAuthBackend(self.verifier, resource_server_url=resource)

    async def __call__(self, scope, receive, send):
        request = Request(scope)
        headers = request.headers
        authorization = headers.getlist("authorization")
        mixed = bool(request.cookies or request.query_params) or any(
            key.lower().startswith("remote-") for key in headers
        )
        principal = None
        if len(authorization) == 1 and not mixed:
            scheme, _, value = authorization[0].partition(" ")
            if scheme.lower() == "bearer" and value.startswith("crate_mcp_"):
                try:
                    authenticated = await self.backend.authenticate(request)
                except Exception:  # noqa: BLE001 — fail closed without exposing backend errors.
                    metrics.record_later("mcp.auth.unavailable", 1)
                    response = JSONResponse(
                        {"error": "AUTH_UNAVAILABLE"}, status_code=503
                    )
                    await response(scope, receive, send)
                    return
                if authenticated:
                    credentials, user = authenticated
                    principal = (user.access_token.claims or {}).get("agent_principal")
                    scope["auth"], scope["user"] = credentials, user
        if principal is None:
            metrics.record_later("mcp.auth.denied", 1)
            challenge = 'Bearer realm="crate-mcp"'
            if oauth_enabled():
                challenge += (
                    ', resource_metadata="'
                    + oauth_settings().issuer
                    + '/.well-known/oauth-protected-resource/mcp"'
                )
            response = JSONResponse(
                {"error": "UNAUTHORIZED"},
                status_code=401,
                headers={"WWW-Authenticate": challenge, "Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return
        scope.setdefault("state", {})["agent_principal"] = principal
        await self.app(scope, receive, send)
