"""Distributed tracing skeleton — propagates X-Trace-ID across requests."""

import contextvars
import logging
import re
import secrets

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from crate.observability.redaction import redact_cast_session_lease

log = logging.getLogger(__name__)
_TRACE_ID_HEADER = "X-Trace-ID"
_TRACE_ID_HEADER_BYTES = _TRACE_ID_HEADER.lower().encode("latin-1")
_TRACE_ID_VALUE_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_trace_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "trace_id", default=None
)
_log_record_factory_installed = False


def _generate_trace_id() -> str:
    return secrets.token_hex(16)


def _current_trace_id() -> str:
    return _trace_id_var.get() or "-"


def _coerce_trace_id(raw_trace_id: bytes | None) -> str:
    if not raw_trace_id:
        return _generate_trace_id()
    try:
        trace_id = raw_trace_id.decode("latin-1").strip()
    except UnicodeDecodeError:
        return _generate_trace_id()
    if not _TRACE_ID_VALUE_RE.fullmatch(trace_id):
        return _generate_trace_id()
    return trace_id


def install_trace_id_log_record_factory() -> None:
    """Inject ``trace_id`` into LogRecords globally, once per process."""
    global _log_record_factory_installed
    if _log_record_factory_installed:
        return

    previous_factory = logging.getLogRecordFactory()

    def record_factory(*args, **kwargs):
        record = previous_factory(*args, **kwargs)
        if not hasattr(record, "trace_id"):
            record.trace_id = _current_trace_id()
        return record

    logging.setLogRecordFactory(record_factory)
    _log_record_factory_installed = True


class TraceIDFilter(logging.Filter):
    """Backward-compatible filter for handlers that opt into it directly."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "trace_id"):
            record.trace_id = _current_trace_id()
        return True


class TraceMiddleware:
    """ASGI middleware that reads or generates a trace ID, injects it
    into the response headers, and makes it available to loggers.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        trace_id = _coerce_trace_id(headers.get(_TRACE_ID_HEADER_BYTES))

        scope["trace_id"] = trace_id
        token = _trace_id_var.set(trace_id)
        log.info(
            "request started",
            extra={
                "method": scope.get("method"),
                "path": redact_cast_session_lease(str(scope.get("path") or "")),
            },
        )

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_code = int(message.get("status", 0))
                if status_code >= 500:
                    route = scope.get("route")
                    route_path = getattr(route, "path", None) or "<unmatched>"
                    try:
                        from crate.observability.sentry import (
                            capture_handled_http_error,
                        )

                        capture_handled_http_error(
                            method=str(scope.get("method") or "UNKNOWN"),
                            route=str(route_path),
                            status_code=status_code,
                        )
                    except Exception:
                        log.debug("Failed to report handled HTTP error", exc_info=True)
                response_headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != _TRACE_ID_HEADER_BYTES
                ]
                response_headers.append(
                    (_TRACE_ID_HEADER.encode("latin-1"), trace_id.encode("latin-1"))
                )
                message["headers"] = response_headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            _trace_id_var.reset(token)
