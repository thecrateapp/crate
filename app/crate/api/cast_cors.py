from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send


_CAST_PATH_PREFIX = "/api/cast/"
_CAST_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Range",
    "Access-Control-Expose-Headers": (
        "Accept-Ranges, Content-Length, Content-Range, Content-Type"
    ),
    "Access-Control-Max-Age": "600",
}
_CAST_CORS_HEADER_NAMES = {
    name.lower().encode("latin-1") for name in _CAST_CORS_HEADERS
} | {b"access-control-allow-credentials"}


class CastReceiverCorsMiddleware:
    """Expose bearer-ticket Cast resources to credential-free receivers."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith(
            _CAST_PATH_PREFIX
        ):
            await self.app(scope, receive, send)
            return

        if scope.get("method") == "OPTIONS":
            await Response(status_code=204, headers=_CAST_CORS_HEADERS)(
                scope, receive, send
            )
            return

        async def send_with_cast_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() not in _CAST_CORS_HEADER_NAMES
                ]
                headers.extend(
                    (name.lower().encode("latin-1"), value.encode("latin-1"))
                    for name, value in _CAST_CORS_HEADERS.items()
                )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_cast_cors)
