"""Shared redaction helpers for observability payloads."""

from __future__ import annotations

import re


_CAST_SESSION_LEASE_RE = re.compile(r"(/api/cast/sessions/)[^/?#]+")


def redact_cast_session_lease(value: str) -> str:
    """Remove an opaque Cast lease from a path or URL."""
    return _CAST_SESSION_LEASE_RE.sub(r"\1[Filtered]", value)
