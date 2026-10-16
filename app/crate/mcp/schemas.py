"""Closed, bounded public inputs for the diagnostic catalog."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from crate.repair_catalog import REPAIR_CATALOG_BY_CHECK
from crate.task_registry import TASK_TYPES

Limit = Annotated[int, Field(strict=True, ge=1, le=100)]
Cursor = Annotated[str, Field(max_length=2048)]
Identifier = Annotated[str, Field(min_length=1, max_length=128)]
JobState = Literal[
    "pending", "running", "delegated", "completing", "completed", "failed", "cancelled"
]


class ClosedInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InstanceInput(ClosedInput):
    pass


class IssuesInput(ClosedInput):
    check_type: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    severity: Literal["low", "medium", "high", "critical"] | None = None
    artist_uid: Identifier | None = None
    limit: Limit = 20
    cursor: Cursor | None = None

    @model_validator(mode="after")
    def require_known_check(self):
        if (
            self.check_type is not None
            and self.check_type not in REPAIR_CATALOG_BY_CHECK
        ):
            raise ValueError("Unknown check type")
        return self


class ArtistInput(ClosedInput):
    artist_uid: Identifier | None = None
    name: Annotated[str, Field(min_length=2, max_length=200)] | None = None
    limit: Limit = 20

    @model_validator(mode="after")
    def require_one_identity(self):
        if (self.artist_uid is None) == (self.name is None):
            raise ValueError("Supply exactly one of artist_uid or name")
        return self


class JobsInput(ClosedInput):
    states: Annotated[list[JobState], Field(max_length=7)] | None = None
    types: Annotated[list[Identifier], Field(max_length=10)] | None = None
    limit: Limit = 20
    cursor: Cursor | None = None

    @model_validator(mode="after")
    def require_known_types(self):
        if self.types and any(item not in TASK_TYPES for item in self.types):
            raise ValueError("Unknown job type")
        return self


class JobInput(ClosedInput):
    job_id: Identifier


class DiagnosticsInput(ClosedInput):
    source: Literal["worker_logs", "worker_status", "analysis_status"]
    task_id: Identifier | None = None
    since: datetime | None = None
    until: datetime | None = None
    limit: Limit = 20

    @model_validator(mode="after")
    def validate_source_filters(self):
        if self.source != "worker_logs" and any((self.task_id, self.since, self.until)):
            raise ValueError("Time and task filters apply only to worker_logs")
        for value in (self.since, self.until):
            if value is not None and value.tzinfo is None:
                raise ValueError("Timestamps require a timezone")
        return self


class DiagnosticOutput(ClosedInput):
    schema_version: Literal["1"]
    availability: Literal["available", "stale", "unavailable"]
    source: str | None = None
    observed_at: str | None = None
    reason: str | None = None
    data: Any = None
    returned_count: int = 0
    truncated: bool = False
    next_cursor: str | None = None
    snapshot: dict[str, Any] | None = None
    checks: dict[str, Any] | None = None
    total: int | None = None
    coverage: str | None = None
    sample_truncated: bool | None = None
    window: dict[str, str] | None = None
    interpretation: str | None = None
    error: dict[str, Any] | None = None
