"""Runtime state of the error inbox, shared by the worker, the admin API and MCP.

The worker writes two rows in `ops_runtime_state`; everything else only reads them:

- `error_inbox`: the outcome of the last sync pass (`status`, timestamps, typed
  `error_code`, `counts`, `truncated`, ...).
- `error_inbox_access`: the read and write access of the token, keyed by a hash of
  its secret ref (`credential`) so a replaced token never inherits the old one's.

Nothing here calls Sentry.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state

if TYPE_CHECKING:
    from crate.error_inbox.config import ErrorTrackingConfig

SYNC_STATE_KEY = "error_inbox"
ACCESS_STATE_KEY = "error_inbox_access"
STATE_VERSION = 1
SYNC_STATUSES = frozenset({"ok", "partial", "failed"})
_MAX_CODE_LENGTH = 64
_MAX_SOURCE_LENGTH = 32


def credential_fingerprint(config: ErrorTrackingConfig) -> str | None:
    """A short hash of the token's secret ref; never the token."""
    if not config.secret_ref:
        return None
    return hashlib.sha256(config.secret_ref.encode()).hexdigest()[:16]


def _flag(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _text(value: Any, limit: int) -> str | None:
    return value if isinstance(value, str) and 0 < len(value) <= limit else None


def _timestamp(value: Any) -> str | None:
    return value if isinstance(value, str) and len(value) <= 64 else None


def record_access(
    config: ErrorTrackingConfig,
    *,
    source: str,
    access: Mapping[str, bool | None],
    error_code: str | None = None,
) -> None:
    """Record the token's access, keyed by its fingerprint; never the token."""
    set_ops_runtime_state(
        ACCESS_STATE_KEY,
        {
            "version": STATE_VERSION,
            "read": access.get("read"),
            "write": access.get("write"),
            "credential": credential_fingerprint(config),
            "source": source,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "error_code": error_code,
        },
    )


def access_view(state: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """The last recorded access check as the admin shows it; None before any check."""
    if not isinstance(state, Mapping):
        return None
    return {
        "read": _flag(state.get("read")),
        "write": _flag(state.get("write")),
        "checked_at": _timestamp(state.get("checked_at")),
        "source": _text(state.get("source"), _MAX_SOURCE_LENGTH),
        "error_code": _text(state.get("error_code"), _MAX_CODE_LENGTH),
    }


def access_for(
    config: ErrorTrackingConfig | None, state: Mapping[str, Any] | None
) -> dict[str, Any] | None:
    """The recorded access when it belongs to the current token, else None."""
    if config is None or not isinstance(state, Mapping):
        return None
    credential = credential_fingerprint(config)
    if credential is None or state.get("credential") != credential:
        return None
    return access_view(state)


def write_access(
    config: ErrorTrackingConfig | None, state: Mapping[str, Any] | None
) -> bool | None:
    """Write access recorded for the current token in `state`, or None when unknown."""
    access = access_for(config, state)
    return None if access is None else access["write"]


def known_write_access(config: ErrorTrackingConfig) -> bool | None:
    """Recorded write access of the current token, or None when it is not known."""
    return write_access(config, get_ops_runtime_state(ACCESS_STATE_KEY))


def sync_view(state: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """The last sync pass as the admin and MCP show it; None before the first pass."""
    if not isinstance(state, Mapping) or state.get("status") not in SYNC_STATUSES:
        return None
    counts = state.get("counts")
    truncated = state.get("truncated")
    truncated = truncated if isinstance(truncated, Mapping) else {}
    return {
        "status": state["status"],
        "started_at": _timestamp(state.get("started_at")),
        "finished_at": _timestamp(state.get("finished_at")),
        "last_success_at": _timestamp(state.get("last_success_at")),
        "error_code": _text(state.get("error_code"), _MAX_CODE_LENGTH),
        "counts": {
            str(key): value
            for key, value in (counts.items() if isinstance(counts, Mapping) else ())
            if type(value) is int and value >= 0
        },
        "truncated": {
            "full": truncated.get("full") is True,
            "recent": truncated.get("recent") is True,
        },
    }


__all__ = [
    "ACCESS_STATE_KEY",
    "STATE_VERSION",
    "SYNC_STATE_KEY",
    "SYNC_STATUSES",
    "access_for",
    "access_view",
    "credential_fingerprint",
    "known_write_access",
    "record_access",
    "sync_view",
    "write_access",
]
