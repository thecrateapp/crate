"""Schemas for Crate Connect playback state endpoints."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from crate.api.schemas.common import OkResponse


class DeviceCapabilities(BaseModel):
    model_config = ConfigDict(extra="allow")

    can_play: bool = True
    can_receive_commands: bool = False
    can_background_play: bool = False
    can_set_volume: bool = False
    supports_native_audio: bool = False
    supports_cast_sender: bool = False


class CurrentDeviceRequest(BaseModel):
    device_id: str = Field(..., min_length=3, max_length=160)
    device_label: str | None = Field(default=None, max_length=160)
    device_type: str | None = Field(default=None, max_length=64)
    app_platform: str | None = Field(default=None, max_length=64)
    app_version: str | None = Field(default=None, max_length=64)
    capabilities: DeviceCapabilities = Field(default_factory=DeviceCapabilities)


class DeviceResponse(BaseModel):
    device_id: str
    device_label: str | None = None
    device_type: str | None = None
    app_platform: str | None = None
    app_version: str | None = None
    capabilities: dict[str, Any] = Field(default_factory=dict)
    last_session_id: str | None = None
    last_seen_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    revoked_at: datetime | None = None
    active: bool = False


class CurrentDeviceResponse(OkResponse):
    device: DeviceResponse


class DeviceListResponse(BaseModel):
    devices: list[DeviceResponse] = Field(default_factory=list)


class QueueTrackReference(BaseModel):
    model_config = ConfigDict(extra="allow")

    track_id: int | None = None
    track_entity_uid: UUID | str | None = None
    path: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""
    duration: float | int | None = None
    album_cover: str | None = None


class PlaybackStateRequest(BaseModel):
    device_id: str = Field(..., min_length=3, max_length=160)
    snapshot_kind: str = Field(default="light", pattern="^(light|structural)$")
    status: str = Field(
        default="paused", pattern="^(playing|paused|stopped|buffering)$"
    )
    claim_active: bool = False
    playback_session_id: UUID | None = None
    track_id: int | None = None
    track_entity_uid: UUID | None = None
    track_path: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""
    album_cover: str | None = None
    position_ms: int = 0
    duration_ms: int | None = None
    current_index: int = 0
    queue_revision: str | None = None
    queue: list[QueueTrackReference] = Field(default_factory=list)
    play_source: dict[str, Any] | None = None
    repeat_mode: str = Field(default="off", pattern="^(off|one|all)$")
    shuffle: bool = False
    unshuffled_queue: list[QueueTrackReference] | None = None
    playback_rate: float = 1
    app_platform: str | None = Field(default=None, max_length=64)
    device_type: str | None = Field(default=None, max_length=64)
    expires_at: datetime | None = None

    @field_validator("position_ms", "current_index")
    @classmethod
    def _non_negative_int(cls, value: int) -> int:
        return max(0, value)

    @field_validator("duration_ms")
    @classmethod
    def _positive_duration(cls, value: int | None) -> int | None:
        if value is None:
            return None
        return max(0, value)

    @field_validator("playback_rate")
    @classmethod
    def _valid_playback_rate(cls, value: float) -> float:
        if value <= 0 or value > 4:
            raise ValueError("playback_rate must be > 0 and <= 4")
        return value


class PlaybackStateResponse(BaseModel):
    device_id: str
    device_label: str | None = None
    status: str
    playback_session_id: UUID | None = None
    track_id: int | None = None
    track_entity_uid: UUID | None = None
    track_path: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""
    album_cover: str | None = None
    position_ms: int = 0
    duration_ms: int | None = None
    current_index: int = 0
    queue_revision: str | None = None
    queue: list[dict[str, Any]] = Field(default_factory=list)
    play_source: dict[str, Any] | None = None
    repeat_mode: str = "off"
    shuffle: bool = False
    unshuffled_queue: list[dict[str, Any]] | None = None
    playback_rate: float = 1
    app_platform: str | None = None
    device_type: str | None = None
    updated_at: datetime | None = None
    expires_at: datetime | None = None


class PlaybackStateUpdateResponse(OkResponse):
    state: PlaybackStateResponse


class ResumeCandidateResponse(BaseModel):
    candidate: PlaybackStateResponse | None = None
