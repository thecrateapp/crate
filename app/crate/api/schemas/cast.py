from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CastTicketRequest(BaseModel):
    track_id: int | None = Field(default=None, ge=1)
    track_entity_uid: UUID | None = None
    track_path: str | None = Field(default=None, max_length=2048)
    purpose: str = Field(
        default="google_cast", pattern="^(google_cast|airplay|external_receiver)$"
    )
    target_device_id: str | None = Field(default=None, max_length=160)
    expires_in_seconds: int = Field(default=900, ge=60, le=3600)
    delivery: str = Field(
        default="auto", pattern="^(auto|receiver_safe|original|balanced|data_saver)$"
    )
    receiver_capabilities: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _requires_track_reference(self):
        if (
            self.track_id is None
            and self.track_entity_uid is None
            and not self.track_path
        ):
            raise ValueError("track_id, track_entity_uid, or track_path is required")
        return self


class CastTicketResponse(BaseModel):
    stream_url: str
    metadata_url: str
    expires_at: datetime
    delivery_policy: str


class CastMediaResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    stream_url: str
    track_id: int | None = None
    track_entity_uid: UUID | str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""
    duration_ms: int | None = None
    content_type: str
    expires_at: datetime
    purpose: str
    requested_policy: str
    effective_policy: str
    preparing: bool = False
    transcoded: bool = False
    delivery: dict[str, Any] = Field(default_factory=dict)
    source: dict[str, Any] = Field(default_factory=dict)


class CastAppearanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal[1] = 1
    skin_id: str = Field(default="default", min_length=1, max_length=160)
    preferred_mode: Literal["dark", "light", "system"] = "system"
    resolved_mode: Literal["dark", "light"] = "dark"
    reduced_motion: bool = False
    artwork_palette: list[str] = Field(default_factory=list, max_length=8)


class CastSessionQueueItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(min_length=1, max_length=160)
    track_id: int | None = Field(default=None, ge=1)
    track_entity_uid: UUID | None = None
    track_path: str | None = Field(default=None, max_length=2048)
    artwork_url: str | None = Field(default=None, max_length=4096)

    @model_validator(mode="after")
    def _requires_track_reference(self):
        if (
            self.track_id is None
            and self.track_entity_uid is None
            and not self.track_path
        ):
            raise ValueError("A stable track reference is required")
        return self


class _CastQueueRequestBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[CastSessionQueueItemRequest] = Field(max_length=1000)
    repeat_mode: Literal["all", "off", "one"] = "off"
    shuffle: bool = False

    @model_validator(mode="after")
    def _requires_unique_item_ids(self):
        item_ids = [item.item_id for item in self.items]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("Cast queue item ids must be unique")
        return self


class CastSessionCreateRequest(_CastQueueRequestBase):
    target_device_id: str | None = Field(default=None, max_length=160)
    protocol_version: Literal[1] = 1
    receiver_capabilities: dict[str, Any] = Field(default_factory=dict)
    appearance: CastAppearanceRequest = Field(default_factory=CastAppearanceRequest)
    items: list[CastSessionQueueItemRequest] = Field(min_length=1, max_length=1000)
    current_index: int = Field(default=0, ge=0)
    current_time: float = Field(default=0, ge=0)
    revision: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _cursor_must_be_inside_queue(self):
        if self.current_index >= len(self.items):
            raise ValueError("Cast current_index is outside the queue")
        return self


class CastSessionQueueUpdateRequest(_CastQueueRequestBase):
    repeat_mode: Literal["all", "off", "one"] | None = None
    shuffle: bool | None = None
    expected_revision: int = Field(ge=0)
    mutation_id: str = Field(min_length=1, max_length=160)


class CastReceiverStateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state_seq: int = Field(ge=0)
    current_index: int = Field(ge=0)
    current_time: float = Field(ge=0)


class CastPlayCheckpointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_event_id: str = Field(min_length=1, max_length=160)
    item_id: str = Field(min_length=1, max_length=160)
    started_at: datetime
    ended_at: datetime
    played_seconds: float = Field(ge=0)
    track_duration_seconds: float | None = Field(default=None, gt=0)
    completion_ratio: float | None = Field(default=None, ge=0, le=1)
    was_skipped: bool = False
    was_completed: bool = False

    @model_validator(mode="after")
    def _validate_checkpoint(self):
        if self.started_at > self.ended_at:
            raise ValueError("started_at must be <= ended_at")
        if self.was_skipped and self.was_completed:
            raise ValueError("A checkpoint cannot be skipped and completed")
        if self.track_duration_seconds and self.completion_ratio is not None:
            derived = min(1.0, self.played_seconds / self.track_duration_seconds)
            if abs(derived - self.completion_ratio) > 0.15:
                raise ValueError("completion_ratio does not match played_seconds")
        return self
