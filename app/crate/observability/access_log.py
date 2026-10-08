"""Redact OpenSubsonic credentials from Uvicorn access records."""

from __future__ import annotations

import logging
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_FILTERED = "[Filtered]"
_OPEN_SUBSONIC_SECRET_KEYS = {"p", "t", "s", "apikey"}


class OpenSubsonicAccessLogFilter(logging.Filter):
    """Sanitize the request-target argument used by Uvicorn's access logger."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple) or len(args) < 3:
            return True
        request_target = args[2]
        if not isinstance(request_target, str):
            return True
        parsed = urlsplit(request_target)
        if not parsed.path.startswith("/rest/") and parsed.path != "/rest":
            return True
        sanitized = urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                _redact_query(parsed.query),
                parsed.fragment,
            )
        )
        mutable_args = list(args)
        mutable_args[2] = sanitized
        record.args = tuple(mutable_args)
        return True


def install_open_subsonic_access_log_filter(
    logger: logging.Logger | None = None,
) -> None:
    target = logger or logging.getLogger("uvicorn.access")
    if not any(
        isinstance(item, OpenSubsonicAccessLogFilter) for item in target.filters
    ):
        target.addFilter(OpenSubsonicAccessLogFilter())


def _redact_query(query: str) -> str:
    return urlencode(
        [
            (
                name,
                _FILTERED if name.lower() in _OPEN_SUBSONIC_SECRET_KEYS else value,
            )
            for name, value in parse_qsl(query, keep_blank_values=True)
        ],
        safe="[]",
    )


__all__ = ["OpenSubsonicAccessLogFilter", "install_open_subsonic_access_log_filter"]
