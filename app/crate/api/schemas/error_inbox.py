"""Error inbox admin API models.

The Sentry and GitHub tokens are accepted only on `PUT /api/admin/errors/connection`
and are never part of a response: the connection only reports `has_token`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from crate.error_inbox.autofix import MAX_NOTE_LENGTH
from crate.error_inbox.config import MAX_DAILY_TRIAGE
from crate.error_inbox.sentry_client import SUBSTATUSES

IssueStatus = Literal["unresolved", "resolved", "ignored"]
IssueStatusFilter = Literal["unresolved", "resolved", "ignored", "all"]
# `review`: issues whose fix pull request is open and waits for a person.
IssueLane = Literal["all", "critical", "review"]
FixRunStatus = Literal[
    "requested",
    "running",
    "pr_open",
    "merged",
    "closed",
    "failed",
    "cancelled",
    "expired",
]
FixExecutorName = Literal["github_actions", "factory"]
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
    # The status of the issue's latest fix run; `pr_open` means pending review.
    fix_status: FixRunStatus | None = None


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
    # The model that answered, while its invocation record is kept (90 days).
    model: str | None = None
    created_at: datetime


class ErrorIssueFix(BaseModel):
    """Launch fix for one issue; the detail carries it only when E3 is configured."""

    repository: str
    workflow: str
    executor: FixExecutorName = "github_actions"
    actions_url: str
    # The workflow only accepts Crate short ids (`CRATE-API-1F`).
    supported: bool
    # Set while the 24-hour window after the last request is open.
    available_at: datetime | None = None


class ErrorFixRunReview(BaseModel):
    """What a person with `ops.errors.manage` can do with the run now.

    `blockers` are the reasons Approve & merge is unavailable (`PR_NOT_FROM_FIXER`,
    `PR_NOT_LABELLED`, `PR_CONFLICTS`, `CHECKS_PENDING`, `CHECKS_FAILED`, ...).
    """

    can_merge: bool
    blockers: list[str] = Field(default_factory=list)
    can_discard: bool


class ErrorFixRun(BaseModel):
    """One attempt to fix the issue and its pull request, as last seen on GitHub."""

    id: str
    executor: FixExecutorName
    status: FixRunStatus
    repository: str
    base_ref: str | None = None
    external_run_id: str | None = None
    external_run_url: str | None = None
    branch: str | None = None
    pr_number: int | None = None
    pr_url: str | None = None
    pr_state: Literal["open", "closed", "merged"] | None = None
    pr_draft: bool | None = None
    pr_mergeable: bool | None = None
    pr_mergeable_state: str | None = None
    pr_head_sha: str | None = None
    pr_author: str | None = None
    pr_labeled: bool | None = None
    ci_state: Literal["pending", "success", "failure", "none"] | None = None
    requested_by: int | None = None
    requested_by_name: str | None = None
    requested_at: datetime
    started_at: datetime | None = None
    pr_opened_at: datetime | None = None
    merge_requested_by_name: str | None = None
    merge_requested_at: datetime | None = None
    ready_at: datetime | None = None
    finished_at: datetime | None = None
    checked_at: datetime | None = None
    error_code: str | None = None
    summary: str | None = None
    cleanup_state: Literal["none", "pending", "done", "failed"] = "none"
    review: ErrorFixRunReview


class ErrorIssueDetail(ErrorIssueSummary):
    provider: Literal["sentry"]
    external_id: str
    digest: Digest | None = None
    digest_event_id: str | None = None
    digest_hash: str | None = None
    fix_requested_by: int | None = None
    fix_requested_by_name: str | None = None
    closed_at: datetime | None = None
    created_at: datetime
    triages: list[ErrorTriage] = Field(default_factory=list)
    # When automatic triage queued the current digest; null if it never did.
    auto_triage_queued_at: datetime | None = None
    write_access: bool | None = None
    fix: ErrorIssueFix | None = None
    # The latest fix runs, newest first (at most five).
    fix_runs: list[ErrorFixRun] = Field(default_factory=list)


class ErrorSyncTruncation(BaseModel):
    full: bool = False
    recent: bool = False


class ErrorSyncTriage(BaseModel):
    """What the pass queued for automatic triage.

    `status`: `off`, `idle` (nothing to queue), `queued`, `cap_reached` (the daily
    limit is used up), `unavailable` (no usable model; `error_code` says why) or
    `failed`.
    """

    status: Literal["off", "idle", "queued", "cap_reached", "unavailable", "failed"]
    queued: int = 0
    queued_24h: int | None = None
    daily_max: int | None = None
    error_code: str | None = None


class ErrorSyncState(BaseModel):
    status: SyncStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    last_success_at: datetime | None = None
    error_code: str | None = None
    counts: dict[str, int] = Field(default_factory=dict)
    truncated: ErrorSyncTruncation = Field(default_factory=ErrorSyncTruncation)
    triage: ErrorSyncTriage | None = None


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
    # Open issues with an event summary and no triage of it: the triage backlog.
    untriaged: int = 0
    # Issues whose fix pull request is open and waits for a person.
    pending_review: int = 0
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


class ErrorFixConnection(BaseModel):
    """Launch fix settings. The GitHub token itself is never returned."""

    repository: str
    workflow: str
    ref: str
    executor: FixExecutorName = "github_actions"
    has_token: bool
    actions_url: str


class ErrorTriageSettings(BaseModel):
    """Automatic AI triage after each sync; off until the triage quality is approved."""

    automatic: bool = False
    daily_max: int = Field(default=30, ge=0, le=MAX_DAILY_TRIAGE)


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
    fix: ErrorFixConnection | None = None
    triage: ErrorTriageSettings = Field(default_factory=ErrorTriageSettings)


def _new_secret(value: SecretStr | None) -> str | None:
    if value is None:
        return None
    secret = value.get_secret_value()
    return secret if secret.strip() else None


class ErrorFixSettingsUpdate(BaseModel):
    """Launch fix settings. `token` is write-only; omitted, null or blank keeps it."""

    repository: str = Field(max_length=201)
    workflow: str = Field(max_length=105)
    ref: str | None = Field(default=None, max_length=100)
    # Who works on the issue; only `github_actions` is available today.
    executor: FixExecutorName | None = None
    token: SecretStr | None = Field(default=None, json_schema_extra={"writeOnly": True})

    def settings(self) -> dict[str, object]:
        return {
            "repository": self.repository,
            "workflow": self.workflow,
            "ref": self.ref,
            "executor": self.executor,
        }

    def new_token(self) -> str | None:
        return _new_secret(self.token)


class ErrorTrackingConnectionUpdate(BaseModel):
    """Connection settings. `token` is write-only; omitted, null or blank keeps it.

    `fix` omitted keeps the Launch fix settings; `null` turns Launch fix off and
    revokes its GitHub token. `triage` omitted keeps the triage settings.
    """

    base_url: str | None = Field(default=None, max_length=2048)
    organization: str = Field(max_length=200)
    projects: list[str] | None = Field(default=None, max_length=200)
    environments: list[str] | None = Field(default=None, max_length=50)
    token: SecretStr | None = Field(default=None, json_schema_extra={"writeOnly": True})
    fix: ErrorFixSettingsUpdate | None = None
    triage: ErrorTriageSettings | None = None

    def settings(self) -> dict[str, object]:
        return {
            "base_url": self.base_url,
            "organization": self.organization,
            "projects": self.projects,
            "environments": self.environments,
        }

    def new_token(self) -> str | None:
        return _new_secret(self.token)

    @property
    def updates_fix(self) -> bool:
        return "fix" in self.model_fields_set


class ErrorTriageBacklogResponse(BaseModel):
    """`Triage backlog`: one triage task per open issue without one, up to `limit`."""

    queued: int
    # Issues whose triage was already queued or running.
    deduplicated: int
    limit: int
    task_ids: list[str] = Field(default_factory=list)


class ErrorFixRequest(BaseModel):
    """Launch fix. The note goes to a public repository's Actions run as it is."""

    model_config = ConfigDict(extra="forbid")

    note: str = Field(default="", max_length=MAX_NOTE_LENGTH)


class ErrorFixMergeRequest(BaseModel):
    """Approve & merge. `head_sha` is the commit the person reviewed: the merge only
    goes ahead while the pull request still points at it."""

    model_config = ConfigDict(extra="forbid")

    head_sha: str = Field(pattern=r"^[0-9a-f]{40}$")


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
    "ErrorFixConnection",
    "ErrorFixMergeRequest",
    "ErrorFixRequest",
    "ErrorFixRun",
    "ErrorFixRunReview",
    "ErrorFixSettingsUpdate",
    "ErrorIssueDetail",
    "ErrorIssueFix",
    "ErrorIssueList",
    "ErrorIssueStatusChange",
    "ErrorIssueSummary",
    "ErrorSummary",
    "ErrorSyncState",
    "ErrorTrackingAccess",
    "ErrorTrackingConnection",
    "ErrorTrackingConnectionUpdate",
    "ErrorTriage",
    "ErrorTriageBacklogResponse",
    "ErrorTriageSettings",
]
