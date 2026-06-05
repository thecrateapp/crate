from __future__ import annotations

from datetime import datetime
from typing import Any
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
