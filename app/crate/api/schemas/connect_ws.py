"""Schemas for Crate Connect v2 WebSocket transport."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.playback_state import DeviceCapabilities


class ConnectWsTicketRequest(BaseModel):
    device_id: str = Field(..., min_length=3, max_length=160)


class ConnectWsTicketResponse(BaseModel):
    ticket: str
    expires_at: datetime
    ws_url: str


class ConnectHelloPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    device_id: str = Field(..., min_length=3, max_length=160)
    playback_instance_id: str = Field(..., min_length=3, max_length=160)
    device_label: str | None = Field(default=None, max_length=160)
    device_type: str | None = Field(default=None, max_length=64)
    app_platform: str | None = Field(default=None, max_length=64)
    app_version: str | None = Field(default=None, max_length=64)
    capabilities: DeviceCapabilities = Field(default_factory=DeviceCapabilities)


class ConnectHelloMessage(BaseModel):
    type: Literal["hello"]
    payload: ConnectHelloPayload
    version: int | None = None


class ConnectClientMessage(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str = Field(..., min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    version: int | None = None


class ConnectErrorPayload(BaseModel):
    code: str
    message: str


class ConnectServerMessage(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    payload: dict[str, Any] | None = None
    version: int | None = None
    timestamp: datetime | None = None
