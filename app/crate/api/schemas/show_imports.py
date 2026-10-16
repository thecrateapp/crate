"""Closed draft and exact-selection contracts shared by Admin and MCP."""

from datetime import date as Date
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    field_validator,
    model_validator,
)

Text = Annotated[str, Field(min_length=1, max_length=240)]


class ShowCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    item_id: Annotated[str, Field(min_length=1, max_length=64)]
    artist_name: Text | None = None
    artist_uid: Annotated[str, Field(pattern=r"^[0-9a-fA-F-]{36}$")] | None = None
    date: Date | None = None
    local_time: (
        Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")] | None
    ) = None
    doors_time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = (
        None
    )
    timezone: Annotated[str, Field(max_length=64)] | None = None
    venue: Text | None = None
    city: Text | None = None
    region: Text | None = None
    country: Text | None = None
    country_code: Annotated[str, Field(pattern=r"^[A-Za-z]{2}$")] | None = None
    address_line1: Text | None = None
    postal_code: Annotated[str, Field(max_length=32)] | None = None
    latitude: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)] | None = (
        None
    )
    url: Annotated[str, Field(max_length=2048, pattern=r"^https?://[^\s]+$")] | None = (
        None
    )
    tickets_url: (
        Annotated[str, Field(max_length=2048, pattern=r"^https?://[^\s]+$")] | None
    ) = None
    image_url: (
        Annotated[str, Field(max_length=2048, pattern=r"^https?://[^\s]+$")] | None
    ) = None
    lineup: Annotated[list[Text], Field(max_length=50)] = []
    price_range: Annotated[str, Field(max_length=240)] | None = None
    status: Literal[
        "scheduled", "onsale", "offsale", "cancelled", "postponed", "rescheduled"
    ] = "scheduled"
    source_provider: Literal["manual", "mcp", "ticketmaster", "setlistfm", "lastfm"] = (
        "manual"
    )
    source_event_id: Annotated[str, Field(min_length=1, max_length=240)] | None = None
    evidence: Annotated[str, Field(max_length=1500)] | None = None
    source_ref: Annotated[str, Field(max_length=2048)] | None = None
    existing_show_id: Annotated[int, Field(strict=True, gt=0)] | None = None
    expected_revision: Annotated[int, Field(strict=True, gt=0)] | None = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError:
                raise ValueError("Unknown IANA timezone") from None
        return value

    @field_validator("artist_uid")
    @classmethod
    def validate_artist_uid(cls, value):
        return str(UUID(value)) if value is not None else None

    @field_validator("date", mode="before")
    @classmethod
    def validate_date(cls, value):
        if isinstance(value, str) and (
            len(value) != 10 or value[4] != "-" or value[7] != "-"
        ):
            raise ValueError("An unambiguous ISO date with year is required")
        return value

    @model_validator(mode="after")
    def validate_coordinates(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be supplied together")
        if bool(self.existing_show_id) != bool(self.expected_revision):
            raise ValueError("Existing show selection requires its exact revision")
        return self


class ShowImportSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidates: Annotated[list[ShowCandidate], Field(min_length=1, max_length=50)]
    idempotency_key: Annotated[
        str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    ]

    @model_validator(mode="after")
    def validate_unique_items(self):
        if len({item.item_id for item in self.candidates}) != len(self.candidates):
            raise ValueError("Duplicate candidate item IDs")
        return self


class ShowPlanApplyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_version: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    idempotency_key: Annotated[
        str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    ]


class ShowAcceptedJob(BaseModel):
    job_id: str
    status: str
    replayed: bool = False


class ShowJobState(BaseModel):
    job_id: str
    status: str
    result: dict | None = None


class ShowPlanEvidence(RootModel[dict]):
    """The complete private plan from the shared engine, without response truncation."""


__all__ = [
    "ShowCandidate",
    "ShowImportSelection",
    "ShowPlanApplyInput",
    "ShowAcceptedJob",
    "ShowJobState",
    "ShowPlanEvidence",
]
