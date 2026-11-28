from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class DeviceTokenCreateRequest(BaseModel):
    device_id: str = Field(
        min_length=8,
        max_length=128,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="Stable identifier the phone generates for itself.",
    )
    label: str = Field(
        min_length=1,
        max_length=80,
        description='Name shown in Settings, for example "Android: Pixel 8".',
    )

    @field_validator("label")
    @classmethod
    def _collapse_label_whitespace(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("label must not be blank")
        return normalized


class DeviceTokenCreatedResponse(BaseModel):
    id: int
    token: str = Field(description="The device credential, returned only once.")
    device_id: str
    label: str
    created_at: datetime
    expires_at: datetime


class DeviceTokenResponse(BaseModel):
    id: int
    device_id: str
    label: str
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime
    current_session: bool = Field(
        description="Whether the token belongs to the session making this request."
    )
