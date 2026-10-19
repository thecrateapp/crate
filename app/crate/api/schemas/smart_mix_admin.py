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
    exhausted: int = Field(default=0, ge=0)
    completed: int = Field(ge=0)


class SmartMixBackfillTask(SmartMixAdminModel):
    id: str
    status: str
    created_at: datetime | str | None = Field(default=None, alias="createdAt")
    updated_at: datetime | str | None = Field(default=None, alias="updatedAt")


class SmartMixBackfillCampaign(SmartMixAdminModel):
    target: str
    status: Literal["running", "paused", "cancelled", "completed"]
    batch_size: int = Field(alias="batchSize", ge=1, le=100)
    max_attempts: int = Field(alias="maxAttempts", ge=1, le=10)
    batches: int = Field(default=0, ge=0)
    claimed: int = Field(default=0, ge=0)
    updated_at: datetime | str | None = Field(default=None, alias="updatedAt")


class SmartMixVersionCount(SmartMixAdminModel):
    analyzer_version: str = Field(alias="analyzerVersion")
    profiles: int = Field(ge=0)
    current: bool


SmartMixTrackStatus = Literal[
    "current", "outdated", "source_changed", "unavailable", "missing"
]


class SmartMixTrackItem(SmartMixAdminModel):
    track_id: int = Field(alias="trackId")
    track_entity_uid: str | None = Field(default=None, alias="trackEntityUid")
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    status: SmartMixTrackStatus
    analyzer_version: str | None = Field(default=None, alias="analyzerVersion")
    profile_version: int | None = Field(default=None, alias="profileVersion")
    quality: str | None = None
    bpm: float | None = None
    intro_bpm: float | None = Field(default=None, alias="introBpm")
    outro_bpm: float | None = Field(default=None, alias="outroBpm")
    analyzed_at: datetime | None = Field(default=None, alias="analyzedAt")
    source_stale_at: datetime | None = Field(default=None, alias="sourceStaleAt")
    processing_state: str | None = Field(default=None, alias="processingState")
    processing_attempts: int | None = Field(default=None, alias="processingAttempts")
    processing_error: str | None = Field(default=None, alias="processingError")


class SmartMixTrackListResponse(SmartMixAdminModel):
    tracks: list[SmartMixTrackItem]
    next_before: int | None = Field(default=None, alias="nextBefore")


class SmartMixReanalyzeResponse(SmartMixAdminModel):
    task_id: str | None = Field(default=None, alias="taskId")
    status: Literal["queued", "already_queued"]


class SmartMixAdminStatusResponse(SmartMixAdminModel):
    profile_version: int = Field(alias="profileVersion", ge=1)
    analyzer_version: str = Field(alias="analyzerVersion")
    total_tracks: int = Field(alias="totalTracks", ge=0)
    current_profiles: int = Field(alias="currentProfiles", ge=0)
    stale_profiles: int = Field(default=0, alias="staleProfiles", ge=0)
    outdated_profiles: int = Field(default=0, alias="outdatedProfiles", ge=0)
    source_changed_profiles: int = Field(default=0, alias="sourceChangedProfiles", ge=0)
    missing_profiles: int = Field(alias="missingProfiles", ge=0)
    coverage_percent: float = Field(alias="coveragePercent", ge=0.0, le=100.0)
    quality: SmartMixProfileQualityCounts
    processing: SmartMixProcessingCounts
    versions: list[SmartMixVersionCount] = Field(default_factory=list)
    refreshed_at: datetime | str | None = Field(default=None, alias="refreshedAt")
    control_state: Literal["idle", "running", "paused"] = Field(alias="controlState")
    campaign: SmartMixBackfillCampaign | None = None
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
