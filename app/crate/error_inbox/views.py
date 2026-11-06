"""Read models of the error inbox for the admin API, System Health and MCP.

Everything comes from PostgreSQL (`error_issues`, `settings`, `ops_runtime_state`):
no function here calls Sentry, GitHub or a model (EI-D3). The Sentry and GitHub
tokens never leave `credential_secrets`; these views only say whether one is stored.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from crate.db.queries import error_issues
from crate.error_inbox.autofix import next_request_at, supports_short_id
from crate.error_inbox.config import (
    DEFAULT_BASE_URL,
    ErrorTrackingConfig,
    ErrorTrackingConfigError,
    FixSettings,
    parse_config,
)
from crate.error_inbox.state import access_view, sync_view, write_access


@dataclass(frozen=True, slots=True)
class StoredConnection:
    """The stored connection: parsed settings, token presence and runtime states."""

    config: ErrorTrackingConfig | None
    has_token: bool
    access_state: Mapping[str, Any] | None
    sync_state: Mapping[str, Any] | None

    @property
    def configured(self) -> bool:
        return self.config is not None and self.has_token


def _stored_settings(raw: Any) -> tuple[ErrorTrackingConfig | None, bool]:
    """Parsed settings and whether a token is stored; unset or corrupt is (None, ...)."""
    if not raw:
        return None, False
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return None, False
    if not isinstance(value, Mapping):
        return None, False
    has_token = bool(value.get("secret_ref"))
    try:
        return parse_config(value), has_token
    except ErrorTrackingConfigError:
        return None, has_token


def stored_connection() -> StoredConnection:
    state = error_issues.inbox_state()
    config, has_token = _stored_settings(state["settings"])
    return StoredConnection(
        config=config,
        has_token=has_token,
        access_state=_mapping(state["access_state"]),
        sync_state=_mapping(state["sync_state"]),
    )


def _mapping(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return value if isinstance(value, str) else None


def _fix_connection(fix: FixSettings | None) -> dict[str, Any] | None:
    if fix is None:
        return None
    return {
        "repository": fix.repository,
        "workflow": fix.workflow,
        "ref": fix.ref,
        "has_token": fix.has_token,
        "actions_url": fix.actions_url,
    }


def connection_view(stored: StoredConnection | None = None) -> dict[str, Any]:
    """`ErrorTrackingConnection`: settings, token presence, access and last sync."""
    stored = stored or stored_connection()
    config = stored.config
    return {
        "configured": stored.configured,
        "provider": "sentry",
        "base_url": config.base_url if config else DEFAULT_BASE_URL,
        "organization": config.organization if config else None,
        "projects": list(config.projects) if config else [],
        "environments": list(config.environments) if config else [],
        "has_token": stored.has_token,
        # The last check as recorded, so a failed test's error code reaches the
        # panel; saving a new token resets it (see `record_access`).
        "access": access_view(stored.access_state),
        "sync": sync_view(stored.sync_state),
        "fix": _fix_connection(config.fix if config else None),
        "triage": {
            "automatic": config.triage.automatic if config else False,
            "daily_max": config.triage.daily_max if config else 30,
        },
    }


def inbox_summary(*, now: datetime | None = None, top: int = 3) -> dict[str, Any]:
    """`ErrorSummary` for System Health, the admin and MCP, in one query.

    Values are JSON-safe so the System Health cache can store them as they are.
    """
    overview = error_issues.inbox_overview(now=now, top=top)
    config, has_token = _stored_settings(overview["settings"])
    return {
        "configured": config is not None and has_token,
        "open": overview["open"],
        "critical_open": overview["critical_open"],
        "new_24h": overview["new_24h"],
        "regressed_24h": overview["regressed_24h"],
        "untriaged": overview["untriaged"],
        "last_synced_at": _iso(overview["last_synced_at"]),
        "services": overview["services"],
        "top_critical": overview["top_critical"],
        "sync": sync_view(_mapping(overview["sync_state"])),
    }


def fix_view(
    config: ErrorTrackingConfig | None,
    issue: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """`ErrorIssueFix`: Launch fix for this issue, or None when it is not configured."""
    if config is None or config.fix is None or not config.fix_ready:
        return None
    return {
        "repository": config.fix.repository,
        "workflow": config.fix.workflow,
        "actions_url": config.fix.actions_url,
        "supported": supports_short_id(issue.get("short_id")),
        "available_at": next_request_at(
            issue.get("fix_requested_at"), now or datetime.now(timezone.utc)
        ),
    }


def issue_detail(issue_id: str) -> dict[str, Any] | None:
    """`ErrorIssueDetail` with the current token's known write access and Launch fix."""
    issue = error_issues.get_issue(issue_id)
    if issue is None:
        return None
    stored = stored_connection()
    return {
        **issue,
        "write_access": write_access(stored.config, stored.access_state)
        if stored.configured
        else None,
        "fix": fix_view(stored.config, issue),
    }


__all__ = [
    "StoredConnection",
    "connection_view",
    "fix_view",
    "inbox_summary",
    "issue_detail",
    "stored_connection",
]
