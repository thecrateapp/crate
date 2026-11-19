from collections.abc import Iterable

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def _normalize_origin(value: str) -> str:
    return value.strip().rstrip("/").lower()


def is_cross_site_request(headers: Headers, allowed_origins: frozenset[str]) -> bool:
    origin = headers.get("origin")
    if origin is not None:
        return _normalize_origin(origin) not in allowed_origins
    return headers.get("sec-fetch-site", "").strip().lower() == "cross-site"


class CookieCsrfMiddleware:
    def __init__(self, app: ASGIApp, allowed_origins: Iterable[str]) -> None:
        self.app = app
        self.allowed_origins = frozenset(
            _normalize_origin(origin) for origin in allowed_origins if origin
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        state = scope.get("state", {})
        if (
            scope["type"] == "http"
            and scope["method"] not in SAFE_METHODS
            and (state.get("cookie_authenticated") or state.get("proxy_authenticated"))
            and is_cross_site_request(Headers(scope=scope), self.allowed_origins)
        ):
            response = JSONResponse(
                {"detail": "Cross-site request rejected"}, status_code=403
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


__all__ = ["CookieCsrfMiddleware", "is_cross_site_request"]
