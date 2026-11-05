"""Error inbox admin API models.

The Sentry token is accepted only on `PUT /api/admin/errors/connection` and is never
part of a response: the connection only reports `has_token`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from crate.error_inbox.sentry_client import SUBSTATUSES

IssueStatus = Literal["unresolved", "resolved", "ignored"]
IssueStatusFilter = Literal["unresolved", "resolved", "ignored", "all"]
IssueLane = Literal["all", "critical"]
IssueLevel = Literal["fatal", "error", "warning", "info", "debug"]
SentryPriority = Literal["high", "medium", "low"]
Classification = Literal[
    "bug", "infrastructure", "external_dependency", "client_environment", "noise"
]
Severity = Literal["critical", "high", "medium", "low"]
SyncStatus = Literal["ok", "partial", "failed"]


class ErrorIssueSummary(BaseModel):
    id: str
    short_id: str
    title: str
    culprit: str | None = None
    service: str
    project_slug: str
    level: IssueLevel
    status: IssueStatus
    substatus: str | None = None
    issue_category: str | None = None
    sentry_priority: SentryPriority | None = None
    events_24h: int
    users_24h: int
    events_total: int
    users_total: int
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    first_release: str | None = None
    last_release: str | None = None
    crate_score: int
    critical: bool
    group_key: str | None = None
    permalink: str | None = None
    fix_requested_at: datetime | None = None
    synced_at: datetime
    classification: Classification | None = None
    severity: Severity | None = None


class ErrorIssueList(BaseModel):
    items: list[ErrorIssueSummary]
    next_cursor: str | None = None


class DigestFrame(BaseModel):
    module: str | None = None
    function: str | None = None
    filename: str | None = None
    lineno: int | None = None
    context: list[tuple[int, str]] = Field(default_factory=list)


class DigestException(BaseModel):
    type: str | None = None
    value: str = ""
    module: str | None = None
    mechanism: str | None = None
    handled: bool | None = None


class DigestBreadcrumb(BaseModel):
    category: str | None = None
    level: str | None = None
    message: str = ""


class Digest(BaseModel):
    v: int
    event_id: str | None = None
    platform: str | None = None
    release: str | None = None
    message: str | None = None
    exceptions: list[DigestException] = Field(default_factory=list)
    frames: list[DigestFrame] = Field(default_factory=list)
    tags: dict[str, str] = Field(default_factory=dict)
    breadcrumbs: list[DigestBreadcrumb] = Field(default_factory=list)
    truncated: bool = False


class ErrorTriage(BaseModel):
    id: str
    kind: Literal["triage", "investigation"]
    digest_hash: str
    invocation_id: str | None = None
    classification: Classification | None = None
    severity: Severity | None = None
    duplicate_of: str | None = None
    summary: str
    hypothesis: str | None = None
    suspected_frames: list[int] = Field(default_factory=list)
    next_step: str | None = None
    confidence: float
    created_at: datetime


class ErrorIssueDetail(ErrorIssueSummary):
    provider: Literal["sentry"]
    external_id: str
    digest: Digest | None = None
    digest_event_id: str | None = None
    digest_hash: str | None = None
    fix_requested_by: int | None = None
    closed_at: datetime | None = None
    created_at: datetime
    triages: list[ErrorTriage] = Field(default_factory=list)
    write_access: bool | None = None


class ErrorSyncTruncation(BaseModel):
    full: bool = False
    recent: bool = False


class ErrorSyncState(BaseModel):
    status: SyncStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    last_success_at: datetime | None = None
    error_code: str | None = None
    counts: dict[str, int] = Field(default_factory=dict)
    truncated: ErrorSyncTruncation = Field(default_factory=ErrorSyncTruncation)


class ErrorServiceCounts(BaseModel):
    service: str
    open: int
    critical: int
    new_24h: int
    regressed_24h: int


class ErrorTopCritical(BaseModel):
    id: str
    short_id: str
    # Event text: left out of the System Health dashboard without `ops.errors.view`.
    title: str | None = None
    service: str
    crate_score: int


class ErrorSummary(BaseModel):
    configured: bool
    open: int
    critical_open: int
    new_24h: int
    regressed_24h: int
    last_synced_at: datetime | None = None
    services: list[ErrorServiceCounts] = Field(default_factory=list)
    top_critical: list[ErrorTopCritical] = Field(default_factory=list)
    sync: ErrorSyncState | None = None


class ErrorTrackingAccess(BaseModel):
    read: bool | None = None
    write: bool | None = None
    checked_at: datetime | None = None
    source: str | None = None
    error_code: str | None = None


class ErrorTrackingConnection(BaseModel):
    configured: bool
    provider: Literal["sentry"] = "sentry"
    base_url: str
    organization: str | None = None
    projects: list[str] = Field(default_factory=list)
    environments: list[str] = Field(default_factory=list)
    has_token: bool
    access: ErrorTrackingAccess | None = None
    sync: ErrorSyncState | None = None


class ErrorTrackingConnectionUpdate(BaseModel):
    """Connection settings. `token` is write-only; omitted, null or blank keeps it."""

    base_url: str | None = Field(default=None, max_length=2048)
    organization: str = Field(max_length=200)
    projects: list[str] | None = Field(default=None, max_length=200)
    environments: list[str] | None = Field(default=None, max_length=50)
    token: SecretStr | None = Field(default=None, json_schema_extra={"writeOnly": True})

    def settings(self) -> dict[str, object]:
        return {
            "base_url": self.base_url,
            "organization": self.organization,
            "projects": self.projects,
            "environments": self.environments,
        }

    def new_token(self) -> str | None:
        if self.token is None:
            return None
        value = self.token.get_secret_value()
        return value if value.strip() else None


class ErrorIssueStatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: IssueStatus
    in_next_release: bool = False
    substatus: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _consistent(self) -> ErrorIssueStatusChange:
        if self.substatus is not None and self.substatus not in SUBSTATUSES:
            raise ValueError("Unsupported substatus")
        if self.in_next_release and self.status != "resolved":
            raise ValueError("in_next_release applies only to resolved")
        return self


__all__ = [
    "Digest",
    "ErrorIssueDetail",
    "ErrorIssueList",
    "ErrorIssueStatusChange",
    "ErrorIssueSummary",
    "ErrorSummary",
    "ErrorSyncState",
    "ErrorTrackingAccess",
    "ErrorTrackingConnection",
    "ErrorTrackingConnectionUpdate",
    "ErrorTriage",
]
