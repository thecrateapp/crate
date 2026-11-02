from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


PlaybackQoeEventName = Literal[
    "startup",
    "stall_start",
    "stall_end",
    "recovery",
    "intent",
    "result",
    "active",
    "continuation",
]
PlaybackQoeOutcome = Literal["started", "failed", "cancelled"]
PlaybackQoeFailureCause = Literal[
    "network", "decode", "auth", "unavailable", "timeout", "other"
]
_IDENTIFIER = r"^[A-Za-z0-9-]{8,64}$"
PlaybackQoeOrigin = Literal["local", "remote", "imported"]
PlaybackQoePolicy = Literal["original", "balanced", "data_saver"]
PlaybackQoeRuntime = Literal[
    "desktop_web", "mobile_web", "android_native", "ios_native", "tauri"
]
PlaybackQoeEngine = Literal["gapless", "media3"]
PlaybackContinuationOutcome = Literal[
    "recovered", "unavailable", "exhausted", "cancelled", "native", "auth"
]
PlaybackContinuationSurface = Literal["radio", "infinite"]


class PlaybackQoeEventRequest(BaseModel):
    """Privacy-safe client event: no track, URL, token or network identifiers."""

    model_config = ConfigDict(extra="forbid")

    event: PlaybackQoeEventName
    origin: PlaybackQoeOrigin | None = None
    requested_policy: PlaybackQoePolicy | None = None
    effective_policy: PlaybackQoePolicy | None = None
    duration_ms: int | None = Field(default=None, ge=0, le=600_000)
    buffered_ahead_seconds: float | None = Field(default=None, ge=0, le=7_200)
    attempt: int | None = Field(default=None, ge=1, le=3)
    runtime: PlaybackQoeRuntime | None = None
    engine: PlaybackQoeEngine | None = None
    event_id: str | None = Field(default=None, pattern=_IDENTIFIER)
    occurred_at: int | None = Field(default=None, ge=0)
    outcome: PlaybackQoeOutcome | None = None
    cause: PlaybackQoeFailureCause | None = None
    continuation: PlaybackContinuationOutcome | None = None
    surface: PlaybackContinuationSurface | None = None

    @model_validator(mode="after")
    def _result_shape(self):
        is_continuation = self.event == "continuation"
        continuation_fields = (self.continuation, self.surface)
        if (is_continuation and None in continuation_fields) or (
            not is_continuation and any(continuation_fields)
        ):
            raise ValueError("continuation and surface belong to continuation events")
        if not is_continuation and None in (
            self.origin,
            self.requested_policy,
            self.effective_policy,
        ):
            raise ValueError("playback events carry origin and delivery policies")
        if (self.event == "result") != (self.outcome is not None):
            raise ValueError("outcome is required for result events only")
        if self.cause is not None and self.outcome != "failed":
            raise ValueError("cause is only valid for failed results")
        if self.event == "active" and self.duration_ms is None:
            raise ValueError("active events carry the played duration")
        return self


class PlaybackQoeDelivery(BaseModel):
    """Client-side losses since the last accepted batch; counts only."""

    model_config = ConfigDict(extra="forbid")

    dropped: int = Field(default=0, ge=0, le=100_000)
    expired: int = Field(default=0, ge=0, le=100_000)
    send_failed: int = Field(default=0, ge=0, le=100_000)


class PlaybackQoeBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[2] | None = None
    batch_id: str | None = Field(default=None, pattern=_IDENTIFIER)
    delivery: PlaybackQoeDelivery | None = None
    events: list[PlaybackQoeEventRequest] = Field(min_length=1, max_length=12)
