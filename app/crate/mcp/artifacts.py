"""Authenticated, bounded export downloads; never a filesystem browser."""

import hashlib
from functools import partial

import anyio
from mcp.server.transport_security import TransportSecurityMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from crate.agent_diagnostics import DiagnosticError
from crate.agent_portability import _read_regular
from crate.db.repositories.agent_artifacts import get_owned_artifact
from crate.mcp.auth import AgentAuth
from crate.mcp.limits import admission


class ArtifactDownload:
    def __init__(self):
        from crate.mcp.server import transport_security_settings

        self.authenticated = AgentAuth(self._download)
        self.security = TransportSecurityMiddleware(transport_security_settings())
        self.limiter = anyio.CapacityLimiter(4)

    async def __call__(self, scope, receive, send):
        rejected = await self.security.validate_request(Request(scope))
        if rejected is not None:
            await rejected(scope, receive, send)
            return
        await self.authenticated(scope, receive, send)

    async def _download(self, scope, receive, send):
        from pathlib import Path

        principal = scope["state"]["agent_principal"]

        def read():
            with admission(principal.id):
                artifact = get_owned_artifact(
                    principal, str(scope["path_params"]["artifact_id"])
                )
                path = Path(artifact["path"])
                for parent in (path, *path.parents):
                    if parent.is_symlink():
                        raise DiagnosticError(
                            "SOURCE_CHANGED", "Artifact source changed"
                        )
                raw = _read_regular(path)
                if (
                    len(raw) != artifact["byte_size"]
                    or hashlib.sha256(raw).hexdigest() != artifact["sha256"]
                ):
                    raise DiagnosticError("SOURCE_CHANGED", "Artifact source changed")
                return raw

        try:
            raw = await anyio.to_thread.run_sync(partial(read), limiter=self.limiter)
            response = Response(
                raw,
                media_type="application/zip",
                headers={
                    "Content-Disposition": 'attachment; filename="crate-metadata.zip"',
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        except DiagnosticError as error:
            response = JSONResponse(
                {"error": error.code},
                status_code=404 if error.code == "NOT_FOUND" else 403,
                headers={"Cache-Control": "no-store"},
            )
        except (OSError, ValueError):
            response = JSONResponse(
                {"error": "ARTIFACT_UNAVAILABLE"},
                status_code=409,
                headers={"Cache-Control": "no-store"},
            )
        await response(scope, receive, send)
