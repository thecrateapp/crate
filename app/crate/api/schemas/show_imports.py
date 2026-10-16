"""Closed draft and exact-selection contracts shared by Admin and MCP."""

from datetime import date as Date
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from uuid import UUID
from urllib.parse import urlsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    field_validator,
    model_validator,
)

Text = Annotated[str, Field(min_length=1, max_length=240)]


def _http_url(value):
    if value is None:
        return None
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Invalid public link")
        _ = parsed.port
    except ValueError:
        raise ValueError(
            "Use an HTTP(S) URL with a host and no embedded credentials"
        ) from None
    return value


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
    extractor: Annotated[str, Field(max_length=100)] | None = None
    extractor_model: Annotated[str, Field(max_length=240)] | None = None
    evidence: Annotated[str, Field(max_length=1500)] | None = None
    source_ref: Annotated[str, Field(max_length=2048)] | None = None
    source_draft_id: Annotated[str, Field(pattern=r"^[0-9a-fA-F-]{36}$")] | None = None
    existing_show_id: Annotated[int, Field(strict=True, gt=0)] | None = None
    expected_revision: Annotated[int, Field(strict=True, gt=0)] | None = None

    @field_validator("url", "tickets_url", "image_url")
    @classmethod
    def validate_links(cls, value):
        return _http_url(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError:
                raise ValueError("Unknown IANA timezone") from None
        return value

    @field_validator("artist_uid", "source_draft_id")
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


class ShowConsolidationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    canonical_show_id: Annotated[int, Field(strict=True, gt=0)]
    duplicate_show_ids: Annotated[
        list[Annotated[int, Field(strict=True, gt=0)]],
        Field(min_length=1, max_length=9),
    ]
    revisions: dict[str, Annotated[int, Field(strict=True, gt=0)]]

    @model_validator(mode="after")
    def validate_exact_selection(self):
        ids = [self.canonical_show_id, *self.duplicate_show_ids]
        if len(set(ids)) != len(ids) or set(self.revisions) != {
            str(value) for value in ids
        }:
            raise ValueError(
                "Choose distinct canonical/duplicate IDs and every exact revision"
            )
        return self


class ShowImportSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidates: Annotated[list[ShowCandidate], Field(max_length=50)] = []
    consolidation: ShowConsolidationInput | None = None
    idempotency_key: Annotated[
        str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    ]

    @model_validator(mode="after")
    def validate_unique_items(self):
        if bool(self.candidates) == bool(self.consolidation):
            raise ValueError("Choose candidates or one explicit consolidation")
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


class ShowExtractionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["probe", "parse", "ocr", "vision", "text_llm", "ocr_text_llm"]
    upload_ids: Annotated[list[UUID], Field(max_length=3)] = []
    source_url: (
        Annotated[str, Field(max_length=2048, pattern=r"^https?://[^\s]+$")] | None
    ) = None
    raw_text: Annotated[str, Field(max_length=60000)] = ""
    expected_model: Annotated[str, Field(max_length=240)] | None = None
    expected_configuration: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")] | None = (
        None
    )

    @field_validator("source_url")
    @classmethod
    def validate_source_link(cls, value):
        return _http_url(value)

    @model_validator(mode="after")
    def validate_sources(self):
        if self.mode in {"vision", "text_llm", "ocr_text_llm"} and not (
            self.expected_model and self.expected_configuration
        ):
            raise ValueError(
                "Review the current configured model before sending a source"
            )
        if self.mode == "probe":
            if self.upload_ids or self.source_url or self.raw_text:
                raise ValueError("Readiness probe accepts no source")
        elif not (self.upload_ids or self.source_url or self.raw_text.strip()):
            raise ValueError("Supply an image, source URL or text")
        if self.mode in {"parse", "text_llm"} and self.upload_ids:
            raise ValueError(
                "Text mode accepts only text or URL; choose OCR or vision for images"
            )
        if len(set(self.upload_ids)) != len(self.upload_ids):
            raise ValueError("Duplicate image references")
        return self


class ShowExtractionRequest(ShowExtractionInput):
    idempotency_key: Annotated[
        str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    ]


__all__ = [
    "ShowCandidate",
    "ShowConsolidationInput",
    "ShowImportSelection",
    "ShowPlanApplyInput",
    "ShowAcceptedJob",
    "ShowJobState",
    "ShowPlanEvidence",
    "ShowExtractionInput",
    "ShowExtractionRequest",
]
