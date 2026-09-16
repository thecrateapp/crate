"""Sentry configuration and privacy safeguards for Crate runtimes."""

from __future__ import annotations

import copy
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import sentry_sdk

from crate.observability.redaction import redact_cast_session_lease

_FILTERED = "[Filtered]"
_DEFAULT_TRACE_SAMPLE_RATE = 0.1
_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "code",
    "media_ticket",
    "password",
    "refresh_token",
    "secret",
    "session",
    "signature",
    "state",
    "token",
}
_OPENSUBSONIC_SECRET_KEYS = {"p", "t", "s"}
_SENSITIVE_KEY_PARTS = (
    "authorization",
    "cookie",
    "credential",
    "password",
    "secret",
    "token",
)
_SUBSONIC_TARGET = re.compile(
    r"(?:https?://[^\s\"']+)?/rest(?:/[^\s?\"']*)?(?:\?[^\s\"'<>),;]+)?"
)


@dataclass(frozen=True)
class SentrySettings:
    service: str
    dsn: str | None
    environment: str
    release: str | None
    traces_sample_rate: float
    profiles_sample_rate: float

    @property
    def enabled(self) -> bool:
        return bool(self.dsn)


def resolve_service_name(default: str) -> str:
    """Resolve the low-cardinality runtime name used to segment shared projects."""
    return os.getenv("SENTRY_SERVICE", "").strip() or default


def load_settings(service: str) -> SentrySettings:
    """Load runtime Sentry settings without requiring Sentry to be enabled."""
    dsn = os.getenv("SENTRY_DSN", "").strip() or None
    enabled = os.getenv("SENTRY_ENABLED", "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        dsn = None

    environment = (
        os.getenv("SENTRY_ENVIRONMENT", "").strip()
        or os.getenv("CRATE_ENV", "").strip()
        or "development"
    )
    release = os.getenv("SENTRY_RELEASE", "").strip() or None
    if release is None:
        git_sha = os.getenv("GITHUB_SHA", "").strip()
        release = f"crate-{git_sha}" if git_sha else None

    return SentrySettings(
        service=service,
        dsn=dsn,
        environment=environment,
        release=release,
        traces_sample_rate=_sample_rate(
            "SENTRY_TRACES_SAMPLE_RATE", _DEFAULT_TRACE_SAMPLE_RATE
        ),
        profiles_sample_rate=_sample_rate("SENTRY_PROFILES_SAMPLE_RATE", 0.0),
    )


def init_sentry(service: str) -> bool:
    """Initialize Sentry once for a process and attach the service tag."""
    settings = load_settings(service)
    if not settings.enabled:
        return False

    if not sentry_sdk.is_initialized():
        init_kwargs: dict[str, Any] = {
            "dsn": settings.dsn,
            "environment": settings.environment,
            "send_default_pii": False,
            "traces_sample_rate": settings.traces_sample_rate,
            "profiles_sample_rate": settings.profiles_sample_rate,
            "before_send": scrub_sentry_event,
            "before_breadcrumb": scrub_sentry_breadcrumb,
        }
        if settings.release:
            init_kwargs["release"] = settings.release
        sentry_sdk.init(**init_kwargs)

    sentry_sdk.set_tag("service", settings.service)
    return True


@contextmanager
def task_scope(task_type: str, task_id: str, queue: str):
    """Attach task metadata and timing to one worker execution."""
    if not sentry_sdk.is_initialized():
        yield None
        return

    with sentry_sdk.push_scope() as scope:
        scope.set_tag("task_type", task_type)
        scope.set_tag("queue", queue)
        scope.set_context("task", {"id": str(task_id), "type": task_type})
        with sentry_sdk.start_transaction(op="queue.process", name=task_type) as span:
            span.set_data("task_id", str(task_id))
            span.set_data("queue", queue)
            try:
                yield span
            except BaseException:
                _set_span_status(span, "internal_error")
                raise
            else:
                _set_span_status(span, "ok")


def capture_task_failure(
    task_type: str,
    task_id: str,
    queue: str,
    error: str,
    *,
    retry_count: int = 0,
    max_retries: int = 0,
) -> None:
    """Report a terminal task result without creating one issue per task id."""
    if not sentry_sdk.is_initialized():
        return

    with sentry_sdk.push_scope() as scope:
        scope.fingerprint = ["worker-task-failure", task_type]
        scope.set_tag("task_type", task_type)
        scope.set_tag("queue", queue)
        scope.set_context(
            "task",
            {
                "id": str(task_id),
                "type": task_type,
                "queue": queue,
                "reason": str(error)[:500],
                "retry_count": int(retry_count),
                "max_retries": int(max_retries),
            },
        )
        _mark_current_span_failed()
        sentry_sdk.capture_message(f"Worker task failed: {task_type}", "error")


def capture_task_exception(
    error: BaseException,
    *,
    task_type: str,
    task_id: str,
    queue: str,
    retry_count: int = 0,
    max_retries: int = 0,
) -> None:
    """Capture a raised worker exception with stable task-type grouping."""
    if not sentry_sdk.is_initialized():
        return

    error_type = type(error).__name__
    with sentry_sdk.push_scope() as scope:
        scope.fingerprint = ["worker-task-exception", task_type, error_type]
        scope.set_tag("task_type", task_type)
        scope.set_tag("queue", queue)
        scope.set_tag("error_type", error_type)
        scope.set_context(
            "task",
            {
                "id": str(task_id),
                "type": task_type,
                "queue": queue,
                "retry_count": int(retry_count),
                "max_retries": int(max_retries),
            },
        )
        _mark_current_span_failed()
        sentry_sdk.capture_exception(error)


def capture_handled_http_error(*, method: str, route: str, status_code: int) -> None:
    """Report a returned 5xx response that did not raise an exception."""
    if not sentry_sdk.is_initialized():
        return

    normalized_method = str(method or "UNKNOWN").upper()
    normalized_route = str(route or "<unmatched>")
    normalized_status = int(status_code)
    with sentry_sdk.push_scope() as scope:
        scope.fingerprint = [
            "handled-http-error",
            normalized_method,
            normalized_route,
            str(normalized_status),
        ]
        scope.set_tag("error.source", "handled-http-response")
        scope.set_tag("http.method", normalized_method)
        scope.set_tag("http.route", normalized_route)
        scope.set_tag("http.status_code", str(normalized_status))
        scope.set_context(
            "http_response",
            {
                "method": normalized_method,
                "route": normalized_route,
                "status_code": normalized_status,
            },
        )
        _mark_current_span_failed()
        sentry_sdk.capture_message(
            f"Handled HTTP {normalized_status}: {normalized_method} {normalized_route}",
            "error",
        )


def capture_background_exception(error: BaseException, operation: str) -> None:
    """Capture a handled daemon failure with stable, low-cardinality grouping."""
    if not sentry_sdk.is_initialized():
        return

    error_type = type(error).__name__
    with sentry_sdk.push_scope() as scope:
        scope.fingerprint = [
            "background-operation-failure",
            operation,
            error_type,
        ]
        scope.set_tag("operation", operation)
        scope.set_tag("error_type", error_type)
        _mark_current_span_failed()
        sentry_sdk.capture_exception(error)


def _mark_current_span_failed() -> None:
    get_current_span = getattr(sentry_sdk, "get_current_span", None)
    span = get_current_span() if callable(get_current_span) else None
    if span is not None:
        _set_span_status(span, "internal_error")


def _set_span_status(span: Any, status: str) -> None:
    set_status = getattr(span, "set_status", None)
    if callable(set_status):
        set_status(status)


def scrub_sentry_event(event: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of an event with credentials and PII removed."""
    return _scrub_value(copy.deepcopy(event))


def scrub_sentry_breadcrumb(
    breadcrumb: dict[str, Any], hint: Any = None
) -> dict[str, Any]:
    """Scrub breadcrumb data before it is attached to an event."""
    del hint
    return _scrub_value(copy.deepcopy(breadcrumb))


def _sample_rate(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(1.0, max(0.0, value))


def _scrub_value(value: Any, key: str | None = None) -> Any:
    if key and _is_sensitive_key(key):
        return _FILTERED
    if key == "user" and isinstance(value, dict):
        user_id = value.get("id")
        return {"id": str(user_id)} if user_id is not None else {}
    if key == "request" and isinstance(value, dict):
        return _scrub_request(value)
    if isinstance(value, dict):
        return {
            str(item_key): _scrub_value(item, str(item_key))
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [_scrub_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_scrub_value(item) for item in value)
    if isinstance(value, str):
        if key in {"path", "url", "query_string"}:
            return _scrub_url_or_query(value, is_url=key == "url")
        if "/api/cast/sessions/" in value:
            value = redact_cast_session_lease(value)
        return _scrub_embedded_subsonic_targets(value)
    return value


def _is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return (
        normalized in {"cookies", "set_cookie", "set_cookie_header"}
        or normalized in _SENSITIVE_QUERY_KEYS
        or any(part in normalized for part in _SENSITIVE_KEY_PARTS)
    )


def _scrub_request(request: dict[str, Any]) -> dict[str, Any]:
    headers = request.get("headers")
    content_type = ""
    if isinstance(headers, dict):
        content_type = next(
            (
                str(value)
                for name, value in headers.items()
                if str(name).lower() == "content-type"
            ),
            "",
        )
    normalized_content_type = content_type.split(";", 1)[0].strip().lower()
    is_subsonic_request = _is_subsonic_path(str(request.get("path") or "")) or (
        _is_subsonic_path(str(request.get("url") or ""))
    )
    is_urlencoded_form = normalized_content_type == "application/x-www-form-urlencoded"
    is_multipart_form = normalized_content_type == "multipart/form-data"
    scrubbed: dict[str, Any] = {}
    for name, value in request.items():
        if name == "data" and is_multipart_form:
            scrubbed[name] = _FILTERED
        elif name == "data" and is_urlencoded_form:
            subsonic_form = is_subsonic_request or _contains_opensubsonic_form_key(
                value
            )
            if isinstance(value, str):
                scrubbed[name] = _scrub_query(
                    value.removeprefix("?"), opensubsonic=subsonic_form
                )
            else:
                scrubbed[name] = _scrub_form_payload(value, opensubsonic=subsonic_form)
        elif (
            name == "data"
            and isinstance(value, str)
            and _contains_sensitive_form_key(value)
        ):
            scrubbed[name] = _scrub_query(value, opensubsonic=True)
        elif name == "query_string" and isinstance(value, str):
            scrubbed[name] = _scrub_query(value, opensubsonic=is_subsonic_request)
        else:
            scrubbed[name] = _scrub_value(value, str(name))
    return scrubbed


def _contains_sensitive_form_key(value: str) -> bool:
    return any(
        key.lower() in (_SENSITIVE_QUERY_KEYS | _OPENSUBSONIC_SECRET_KEYS)
        for key, _ in parse_qsl(value.removeprefix("?"), keep_blank_values=True)
    )


def _contains_opensubsonic_form_key(value: Any) -> bool:
    if isinstance(value, str):
        keys = {
            key.lower()
            for key, _ in parse_qsl(value.removeprefix("?"), keep_blank_values=True)
        }
    elif isinstance(value, dict):
        keys = {str(key).lower() for key in value}
    else:
        return False
    return bool(keys.intersection(_OPENSUBSONIC_SECRET_KEYS | {"apikey", "api_key"}))


def _scrub_form_payload(value: Any, *, opensubsonic: bool) -> Any:
    if isinstance(value, dict):
        sensitive_keys = _SENSITIVE_QUERY_KEYS | (
            _OPENSUBSONIC_SECRET_KEYS | {"apikey", "api_key"} if opensubsonic else set()
        )
        return {
            str(key): (
                _FILTERED
                if str(key).lower() in sensitive_keys
                else _scrub_form_payload(item, opensubsonic=opensubsonic)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_scrub_form_payload(item, opensubsonic=opensubsonic) for item in value]
    if isinstance(value, tuple):
        return tuple(
            _scrub_form_payload(item, opensubsonic=opensubsonic) for item in value
        )
    return _scrub_value(value)


def _is_subsonic_path(value: str) -> bool:
    path = urlsplit(value).path if "://" in value else value.split("?", 1)[0]
    return path == "/rest" or path.startswith("/rest/")


def _scrub_url_or_query(value: str, *, is_url: bool) -> str:
    if is_url:
        parsed = urlsplit(value)
        return urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                redact_cast_session_lease(parsed.path),
                _scrub_query(parsed.query, opensubsonic=_is_subsonic_path(parsed.path)),
                parsed.fragment,
            )
        )
    if "/api/cast/sessions/" in value:
        return redact_cast_session_lease(value)
    path, separator, query = value.removeprefix("?").partition("?")
    if separator:
        return f"{path}?{_scrub_query(query, opensubsonic=_is_subsonic_path(path))}"
    return _scrub_query(path)


def _scrub_embedded_subsonic_targets(value: str) -> str:
    def scrub(match: re.Match[str]) -> str:
        target = match.group(0)
        if target.startswith("http://") or target.startswith("https://"):
            return _scrub_url_or_query(target, is_url=True)
        path, separator, query = target.partition("?")
        if not separator:
            return path
        return f"{path}?{_scrub_query(query, opensubsonic=True)}"

    return _SUBSONIC_TARGET.sub(scrub, value)


def _scrub_query(query: str, *, opensubsonic: bool = False) -> str:
    sensitive_keys = _SENSITIVE_QUERY_KEYS | (
        _OPENSUBSONIC_SECRET_KEYS if opensubsonic else set()
    )
    return urlencode(
        [
            (key, _FILTERED if key.lower() in sensitive_keys else value)
            for key, value in parse_qsl(query, keep_blank_values=True)
        ],
        safe="[]",
    )
