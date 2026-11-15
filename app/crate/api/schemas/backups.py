"""Schemas of the Admin backups API (admin backups, BK4).

Secret fields are write-only: requests carry them in ``secrets``; responses only
name the secrets that are set (``secrets_set``) and never their values.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Tier = Literal["daily", "weekly", "monthly"]
Health = Literal["healthy", "late", "failing", "untested", "disabled"]


class BackupProviderField(BaseModel):
    name: str
    label: str
    required: bool = False
    secret: bool = False
    system: bool = False
    default: Any = None


class BackupProvider(BaseModel):
    kind: str
    label: str
    oauth: bool
    config_fields: list[BackupProviderField]
    secret_fields: list[BackupProviderField]


class BackupDestination(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    kind: str
    provider: str
    name: str
    config: dict[str, Any]
    location: str
    secrets_set: list[str]
    missing_secrets: list[str]
    oauth: bool
    enabled: bool
    status: str
    last_checked_at: datetime | None = None
    last_error: str | None = None
    repository_initialized_at: datetime | None = None
    snapshot_count: int | None = None
    repository_bytes: int | None = None
    recovery_kit_downloaded_at: datetime | None = None
    recovery_kit_confirmed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class BackupDestinationCreate(BaseModel):
    kind: str
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)


class BackupDestinationUpdate(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    # A secret sent as null is removed when the provider allows it (OAuth token).
    secrets: dict[str, str | None] | None = None
    enabled: bool | None = None


class BackupDestinationProbe(BaseModel):
    kind: str
    config: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)


class BackupSnapshot(BaseModel):
    id: str
    time: str | None = None
    host: str | None = None
    tags: list[str] = Field(default_factory=list)
    paths: list[str] = Field(default_factory=list)


class BackupSnapshotList(BaseModel):
    destination_id: str
    listed_at: datetime | None = None
    snapshot_count: int | None = None
    snapshots: list[BackupSnapshot]


class BackupOAuthStart(BaseModel):
    authorize_url: str


class BackupPolicy(BaseModel):
    id: str
    name: str
    enabled: bool
    schedule_kind: Literal["daily", "hours", "manual"]
    daily_at: str | None = None
    interval_hours: int | None = None
    window_start: str | None = None
    window_end: str | None = None
    keep_daily: int
    keep_weekly: int
    keep_monthly: int
    compression: Literal["auto", "max", "off"]
    verify_every_days: int
    verify_read_percent: int
    drill_every_days: int
    drill_destination_id: str | None = None
    run_before_upgrade: bool
    last_scheduled_at: datetime | None = None
    next_run: datetime | None = None
    destinations: dict[str, list[Tier]]
    created_at: datetime | None = None
    updated_at: datetime | None = None


class BackupPolicyCreate(BaseModel):
    name: str
    enabled: bool = True
    schedule_kind: Literal["daily", "hours", "manual"]
    daily_at: str | None = None
    interval_hours: int | None = None
    window_start: str | None = None
    window_end: str | None = None
    keep_daily: int = 7
    keep_weekly: int = 4
    keep_monthly: int = 3
    compression: Literal["auto", "max", "off"] = "auto"
    verify_every_days: int = 7
    verify_read_percent: int = 5
    drill_every_days: int = 30
    drill_destination_id: str | None = None
    run_before_upgrade: bool = False
    destinations: dict[str, list[Tier]] = Field(default_factory=dict)


class BackupPolicyUpdate(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    schedule_kind: Literal["daily", "hours", "manual"] | None = None
    daily_at: str | None = None
    interval_hours: int | None = None
    window_start: str | None = None
    window_end: str | None = None
    keep_daily: int | None = None
    keep_weekly: int | None = None
    keep_monthly: int | None = None
    compression: Literal["auto", "max", "off"] | None = None
    verify_every_days: int | None = None
    verify_read_percent: int | None = None
    drill_every_days: int | None = None
    drill_destination_id: str | None = None
    run_before_upgrade: bool | None = None
    destinations: dict[str, list[Tier]] | None = None


class BackupRun(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    kind: str
    status: Literal["running", "succeeded", "failed"]
    task_id: str | None = None
    policy_id: str | None = None
    policy_name: str | None = None
    destination_id: str | None = None
    destination_name: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    duration_seconds: float | None = None
    path: str | None = None
    bytes: int | None = None
    checksum: str | None = None
    snapshot_id: str | None = None
    error: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class BackupRunList(BaseModel):
    items: list[BackupRun]
    total: int
    limit: int
    offset: int
    has_more: bool


class BackupRunRequest(BaseModel):
    kind: Literal["backup", "verify", "restore_drill"]
    policy_id: str | None = None
    destination_id: str | None = None


class BackupLocalRetention(BaseModel):
    keep_daily: int
    keep_weekly: int
    keep_monthly: int


class BackupRecoveryKitRequest(BaseModel):
    password: str = Field(max_length=1024)
    passphrase: str = Field(max_length=1024)


class BackupRecoveryKitConfirmation(BaseModel):
    confirmed: int


class BackupDeleted(BaseModel):
    id: str
    deleted: bool = True


class BackupDestinationHealth(BackupDestination):
    health: Health
    last_copy_at: datetime | None = None
    last_copy_snapshot: str | None = None
    late_after_hours: float | None = None
    tiers: list[Tier] = Field(default_factory=list)
    policy_ids: list[str] = Field(default_factory=list)
    last_verify: dict[str, Any] | None = None
    last_drill: dict[str, Any] | None = None
    kit_covered: bool


class BackupAlert(BaseModel):
    level: Literal["danger", "warning"]
    kind: str
    destination_id: str | None = None
    title: str
    text: str
    at: datetime | None = None
    action: str | None = None


class BackupKitState(BaseModel):
    saved: bool
    uncovered: int
    total: int
    downloaded_at: datetime | None = None


class BackupSizePoint(BaseModel):
    day: str
    bytes: int


class BackupSizeSeries(BaseModel):
    destination_id: str
    name: str
    points: list[BackupSizePoint]


class BackupPolicySummary(BaseModel):
    id: str
    name: str
    enabled: bool
    schedule_kind: str
    next_run: datetime | None = None
    destination_count: int


class BackupOverview(BaseModel):
    generated_at: datetime
    destinations: list[BackupDestinationHealth]
    failing_count: int
    late_count: int
    kit: BackupKitState
    stats: dict[str, Any]
    alerts: list[BackupAlert]
    size_series: list[BackupSizeSeries]
    policies: list[BackupPolicySummary]
    local_retention: BackupLocalRetention
    local_backups_enabled: bool
