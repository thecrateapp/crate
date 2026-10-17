"""Schema models for settings and administrative configuration endpoints."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel, StrictInt, model_validator

from crate.api.schemas.common import OkResponse


class WorkerSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_workers: StrictInt = Field(ge=1, le=64)
    expected_revision: StrictInt | None = Field(default=None, ge=0)


class CacheClearRequest(BaseModel):
    type: str


class ScheduleIntervalsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedules: dict[str, StrictInt]
    expected_revision: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_intervals(cls, value):
        if isinstance(value, dict) and not (
            {"schedules", "expected_revision"} & value.keys()
        ):
            return {"schedules": value}
        return value


class EnrichmentUpdateRequest(RootModel[dict[str, bool]]):
    pass


class LibrarySettingsUpdateRequest(BaseModel):
    audio_extensions: list[str] | None = None


class ProcessingSettingsUpdateRequest(BaseModel):
    mb_auto_apply_threshold: int | None = None
    enrichment_min_age_hours: int | None = None
    max_track_popularity: int | None = None


class PathsSettingsUpdateRequest(BaseModel):
    llm_refinement_enabled: bool | None = None


class TelegramSettingsUpdateRequest(BaseModel):
    bot_token: str | None = None
    enabled: bool | None = None
    chat_id: str | int | None = None


class SoulseekSettingsUpdateRequest(BaseModel):
    url: str | None = None
    quality: str | None = None
    min_bitrate: int | None = None
    username: str | None = None
    shares_music: bool | None = None


class WorkerSettingsResponse(BaseModel):
    max_workers: int
    configured_revision: int | None = None
    effective_revision: int | None = None
    slot_semantics: str | None = None


class LibrarySettingsResponse(BaseModel):
    path: str
    storage_layout: str
    audio_extensions: list[str]


class ProcessingSettingsResponse(BaseModel):
    mb_auto_apply_threshold: int
    enrichment_min_age_hours: int
    max_track_popularity: int


class PathsSettingsResponse(BaseModel):
    llm_refinement_enabled: bool
    llm_refinement_cache_ttl_hours: int


class ShowsActiveCityResponse(BaseModel):
    city: str
    country: str = ""


class ShowsSettingsResponse(BaseModel):
    active_cities: list[ShowsActiveCityResponse]
    upcoming_shows: int


class SoulseekSettingsResponse(BaseModel):
    url: str
    quality: str
    min_bitrate: int
    username: str
    shares_music: bool


class TelegramSettingsResponse(BaseModel):
    enabled: bool
    bot_token: str
    chat_id: str
    has_token: bool


class AboutInfoResponse(BaseModel):
    version: str
    git_commit: str
    python: str
    uptime_seconds: int
    artists: int
    albums: int
    tracks: int
    total_size_gb: float | int


class SettingsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    schedules: dict[str, int]
    worker: WorkerSettingsResponse
    enrichment: dict[str, bool]
    cache_stats: Any
    db_stats: Any
    library: LibrarySettingsResponse
    processing: ProcessingSettingsResponse
    paths: PathsSettingsResponse
    shows: ShowsSettingsResponse
    soulseek: SoulseekSettingsResponse
    telegram: TelegramSettingsResponse
    about: AboutInfoResponse


class CacheClearResponse(OkResponse):
    type: str


class ScheduleUpdateResponse(OkResponse):
    pass


class SettingsUpdateResponse(OkResponse):
    pass


class RuntimeSettingsUpdateResponse(OkResponse):
    configured_revision: int | str | None = None
    effective_revision: int | None = None


class RemoteScrobblingPreferenceResponse(BaseModel):
    remote_scrobbling_enabled: bool = False


class RemoteScrobblingPreferenceUpdate(BaseModel):
    remote_scrobbling_enabled: bool


class TelegramTestResponse(OkResponse):
    pass
