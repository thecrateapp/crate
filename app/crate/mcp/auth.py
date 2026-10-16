"""Dedicated machine authentication; no human credential fallback."""

import anyio
from starlette.requests import Request
from starlette.responses import JSONResponse

from crate.db.repositories.agent_credentials import resolve_credential


class AgentAuth:
    def __init__(self, app):
        self.app = app
        self.limiter = anyio.CapacityLimiter(8)

    async def __call__(self, scope, receive, send):
        request = Request(scope)
        headers = request.headers
        authorization = headers.getlist("authorization")
        mixed = bool(request.cookies or request.query_params) or any(
            key.lower().startswith("remote-") for key in headers
        )
        token = None
        if len(authorization) == 1:
            scheme, _, value = authorization[0].partition(" ")
            if scheme.lower() == "bearer" and value.startswith("crate_mcp_"):
                token = value
        principal = None
        if token and not mixed:
            try:
                principal = await anyio.to_thread.run_sync(
                    resolve_credential, token, limiter=self.limiter
                )
            except Exception:  # noqa: BLE001 — authentication fails closed without leaking backend errors.
                response = JSONResponse({"error": "AUTH_UNAVAILABLE"}, status_code=503)
                await response(scope, receive, send)
                return
        if principal is None:
            response = JSONResponse(
                {"error": "UNAUTHORIZED"},
                status_code=401,
                headers={
                    "WWW-Authenticate": 'Bearer realm="crate-mcp"',
                    "Cache-Control": "no-store",
                },
            )
            await response(scope, receive, send)
            return
        scope.setdefault("state", {})["agent_principal"] = principal
        await self.app(scope, receive, send)
