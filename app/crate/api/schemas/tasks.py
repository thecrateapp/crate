"""Schema models for task and worker endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel, StrictInt

from crate.api.schemas.common import (
    OkResponse,
    SnapshotMetadataResponse,
    TaskEnqueueResponse,
)
from crate.api.schemas.analytics import ActivityLiveResponse
from crate.api.schemas.settings import ScheduleIntervalsRequest


class TaskResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    status: str
    progress: Any = None
    error: str | None = None
    result: Any = None
    params: Any = None
    priority: int | None = None
    pool: str | None = None
    created_at: datetime | str | None = None
    started_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class WorkerTaskRefResponse(BaseModel):
    id: str
    type: str
    pool: str | None = None


class WorkerStatusResponse(BaseModel):
    engine: str
    running: int
    pending: int
    running_tasks: list[WorkerTaskRefResponse]
    pending_tasks: list[WorkerTaskRefResponse]


class WorkerSlotsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slots: StrictInt | None = Field(default=None, ge=1, le=64)
    min_slots: StrictInt | None = Field(default=None, ge=1, le=64)
    expected_revision: StrictInt | None = Field(default=None, ge=0)


class WorkerSlotsResponse(BaseModel):
    max_slots: int
    min_slots: int
    configured_revision: int | None = None
    effective_revision: int | None = None
    slot_semantics: str | None = None
    process_resize: bool = False


class WorkerRestartResponse(BaseModel):
    status: str


class CancelAllTasksResponse(BaseModel):
    cancelled: int


class WorkerScheduleEntryResponse(BaseModel):
    label: str | None = None
    interval_seconds: int
    interval_human: str
    last_run: datetime | str | None = None
    enabled: bool
    revision: str | None = None
    last_enqueued_at: datetime | str | None = None
    last_succeeded_at: datetime | str | None = None


class WorkerSchedulesResponse(RootModel[dict[str, WorkerScheduleEntryResponse]]):
    pass


class WorkerSchedulesUpdateRequest(ScheduleIntervalsRequest):
    pass


class WorkerSchedulesUpdateResponse(BaseModel):
    schedules: dict[str, int]
    revision: str | None = None


class TaskCleanByStatusResponse(BaseModel):
    deleted: int
    status: str


class TaskCleanupRequest(BaseModel):
    older_than_days: int = 7


class TaskCleanupResponse(BaseModel):
    deleted: int


class TaskRetryRequest(BaseModel):
    task_id: str


class TaskRetryResponse(BaseModel):
    task_id: str
    original_id: str


class TaskCancelResponse(BaseModel):
    status: str
    id: str
    cancellation_requested: bool = False
    request_state: str | None = None


class TaskConflictResponse(BaseModel):
    error: str


class WorkerCancelAllResponse(BaseModel):
    cancelled: int


class WorkerActionOkResponse(OkResponse):
    pass


class TaskActionEnqueueResponse(TaskEnqueueResponse):
    pass


class AdminTasksSnapshotResponse(BaseModel):
    snapshot: SnapshotMetadataResponse
    live: ActivityLiveResponse
    history: list[TaskResponse]


class ScheduleRunResponse(BaseModel):
    task_type: str
    task_id: str | None = None
    status: str
    reason: str | None = None
    retry_after: int | None = None


class TaskTypeCatalogEntry(BaseModel):
    type: str
    label: str
    category: str


class TaskActionCatalogEntry(BaseModel):
    id: str
    label: str
    task_type: str
    task_label: str
    category: str
    path: str
    capability: str
    icon: str
    body: dict | None = None


class TaskCatalogResponse(BaseModel):
    categories: dict[str, str]
    types: list[TaskTypeCatalogEntry]
    actions: list[TaskActionCatalogEntry]
