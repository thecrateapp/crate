"""Closed phase-five operational inputs."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from crate.mcp.schemas import (
    ClosedInput,
    EntityUID,
    Identifier,
    IdempotencyKey,
    RepairApplyInput,
)
from crate.runtime_policy_contract import _ClosedModel, _Downloads, _Governor, _Window

ScheduleName = Literal[
    "enrich_artists",
    "library_pipeline",
    "compute_analytics",
    "check_new_releases",
    "promote_due_releases",
    "rematch_album_mbids",
    "repair_duplicate_tracks",
    "cleanup_incomplete_downloads",
    "cleanup_artwork_variants",
    "cleanup_stream_variants",
    "sync_shows",
    "federation_health_poll",
    "federation_sync_catalog",
    "federation_directory_refresh",
    "global_catalog_reconcile_incremental",
    "global_catalog_reconcile_full",
]
Revision = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class JobControlPreview(ClosedInput):
    job_id: Identifier
    scope: Literal["own", "instance"] = "own"
    idempotency_key: IdempotencyKey


class JobControlApply(RepairApplyInput):
    pass


class ScheduleUpdatePreview(ClosedInput):
    schedule: ScheduleName
    interval_seconds: Annotated[int, Field(strict=True, ge=0, le=2678400)]
    expected_revision: Revision
    idempotency_key: IdempotencyKey


class ScheduleRun(ClosedInput):
    schedule: ScheduleName | None = None
    plan_id: EntityUID | None = None
    plan_version: Revision | None = None
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def stage(self):
        if self.plan_id:
            if not self.plan_version or self.schedule:
                raise ValueError("Apply requires only the plan and version")
        elif self.plan_version or not self.schedule:
            raise ValueError("Prepare requires an exact schedule")
        return self


class PoolPatch(_ClosedModel):
    fast: Annotated[int, Field(strict=True, ge=1, le=64)] | None = None
    default: Annotated[int, Field(strict=True, ge=1, le=64)] | None = None
    heavy: Annotated[int, Field(strict=True, ge=1, le=64)] | None = None
    maintenance: Annotated[int, Field(strict=True, ge=1, le=64)] | None = None
    playback: Annotated[int, Field(strict=True, ge=1, le=64)] | None = None


class RuntimePatch(_ClosedModel):
    max_running: Annotated[int, Field(strict=True, ge=1, le=64)] | None = None
    pools: PoolPatch | None = None
    governor: _Governor | None = None
    maintenance_window: _Window | None = None
    download_window: _Window | None = None
    downloads: _Downloads | None = None


class RuntimeUpdatePreview(ClosedInput):
    expected_revision: Annotated[int, Field(strict=True, ge=0)]
    patch: RuntimePatch
    idempotency_key: IdempotencyKey


class AuditInput(ClosedInput):
    task_id: Identifier | None = None
    since: str | None = None
    until: str | None = None
    limit: Annotated[int, Field(strict=True, ge=1, le=100)] = 20
    cursor: Annotated[str, Field(max_length=2048)] | None = None
