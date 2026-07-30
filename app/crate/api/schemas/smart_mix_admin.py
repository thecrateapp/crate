from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SmartMixAdminModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class SmartMixBackfillRequest(SmartMixAdminModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    batch_size: int = Field(default=25, alias="batchSize", ge=1, le=100)
    max_attempts: int = Field(default=3, alias="maxAttempts", ge=1, le=10)


class SmartMixProfileQualityCounts(SmartMixAdminModel):
    full: int = Field(ge=0)
    partial: int = Field(ge=0)
    legacy: int = Field(ge=0)
    unavailable: int = Field(ge=0)


class SmartMixProcessingCounts(SmartMixAdminModel):
    pending: int = Field(ge=0)
    active: int = Field(ge=0)
    failed: int = Field(ge=0)
    completed: int = Field(ge=0)


class SmartMixBackfillTask(SmartMixAdminModel):
    id: str
    status: str
    created_at: datetime | str | None = Field(default=None, alias="createdAt")
    updated_at: datetime | str | None = Field(default=None, alias="updatedAt")


class SmartMixAdminStatusResponse(SmartMixAdminModel):
    profile_version: int = Field(alias="profileVersion", ge=1)
    analyzer_version: str = Field(alias="analyzerVersion")
    total_tracks: int = Field(alias="totalTracks", ge=0)
    current_profiles: int = Field(alias="currentProfiles", ge=0)
    missing_profiles: int = Field(alias="missingProfiles", ge=0)
    coverage_percent: float = Field(alias="coveragePercent", ge=0.0, le=100.0)
    quality: SmartMixProfileQualityCounts
    processing: SmartMixProcessingCounts
    control_state: Literal["idle", "running", "paused"] = Field(alias="controlState")
    active_task: SmartMixBackfillTask | None = Field(
        default=None,
        alias="activeTask",
    )


class SmartMixBackfillResponse(SmartMixAdminModel):
    task_id: str | None = Field(default=None, alias="taskId")
    status: Literal[
        "queued",
        "already_running",
        "paused",
        "cancelled",
        "resumed",
    ]
    deduplicated: bool = False


__all__ = [
    "SmartMixAdminStatusResponse",
    "SmartMixBackfillRequest",
    "SmartMixBackfillResponse",
]
