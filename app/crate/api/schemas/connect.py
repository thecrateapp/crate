"""Schemas for Crate Connect transfer and command endpoints."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from crate.api.schemas.common import OkResponse
from crate.api.schemas.playback_state import PlaybackStateResponse

ConnectCommandType = Literal[
    "play",
    "pause",
    "resume",
    "seek",
    "next",
    "previous",
    "set_queue",
    "append_tracks",
    "set_volume",
    "set_repeat",
    "set_shuffle",
    "transfer_in",
    "transfer_out",
]


class ActivePlaybackSessionResponse(BaseModel):
    user_id: int
    playback_session_id: UUID
    active_device_id: str | None = None
    status: str
    command_seq: int = 0
    state_revision: str | None = None
    updated_at: datetime | None = None
    expires_at: datetime | None = None


class ConnectTransferRequest(BaseModel):
    target_device_id: str = Field(..., min_length=3, max_length=160)
    source_device_id: str = Field(..., min_length=3, max_length=160)
    start_playing: bool = True


class ConnectCommandRequest(BaseModel):
    command_id: UUID | None = None
    target_device_id: str | None = Field(default=None, min_length=3, max_length=160)
    source_device_id: str | None = Field(default=None, min_length=3, max_length=160)
    playback_session_id: UUID | None = None
    type: ConnectCommandType
    payload: dict[str, Any] = Field(default_factory=dict)


class ConnectCommandResponse(BaseModel):
    command_id: UUID
    type: ConnectCommandType
    source_device_id: str | None = None
    target_device_id: str
    playback_session_id: UUID | None = None
    command_seq: int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    stream_id: str | None = None
    deduplicated: bool = False


class ConnectTransferResponse(BaseModel):
    session: ActivePlaybackSessionResponse
    target_command: ConnectCommandResponse
    source_command: ConnectCommandResponse | None = None


class ActivePlaybackSessionEnvelope(BaseModel):
    session: ActivePlaybackSessionResponse | None = None
    state: PlaybackStateResponse | None = None


class ConnectPreferencesResponse(BaseModel):
    enabled: bool = False


class ConnectPreferencesUpdateRequest(BaseModel):
    enabled: bool


class ConnectCommandEnvelope(BaseModel):
    command: ConnectCommandResponse


class ConnectCommandListEnvelope(BaseModel):
    commands: list[ConnectCommandResponse] = Field(default_factory=list)


class ConnectCommandAckRequest(BaseModel):
    device_id: str = Field(..., min_length=3, max_length=160)
    status: Literal["success", "error", "ignored"] = "success"
    error: str | None = Field(default=None, max_length=500)


class ConnectCommandAckResponse(OkResponse):
    ack: dict[str, Any]
