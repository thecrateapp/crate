from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


PlaybackQoeEventName = Literal["startup", "stall_start", "stall_end", "recovery"]
PlaybackQoeOrigin = Literal["local", "remote", "imported"]
PlaybackQoePolicy = Literal["original", "balanced", "data_saver"]


class PlaybackQoeEventRequest(BaseModel):
    """Privacy-safe client event: no track, URL, token or network identifiers."""

    model_config = ConfigDict(extra="forbid")

    event: PlaybackQoeEventName
    origin: PlaybackQoeOrigin
    requested_policy: PlaybackQoePolicy
    effective_policy: PlaybackQoePolicy
    duration_ms: int | None = Field(default=None, ge=0, le=600_000)
    buffered_ahead_seconds: float | None = Field(default=None, ge=0, le=7_200)
    attempt: int | None = Field(default=None, ge=1, le=3)


class PlaybackQoeBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[PlaybackQoeEventRequest] = Field(min_length=1, max_length=12)
