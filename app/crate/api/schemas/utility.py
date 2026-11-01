"""Schema models for utility, infrastructure, metadata, and SSE endpoints."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, field_validator

from crate.api.schemas.common import SnapshotMetadataResponse


class ImportItemRequest(BaseModel):
    source_path: str
    artist: str | None = None
    album: str | None = None


class ImportRemoveRequest(BaseModel):
    source_path: str


class ImportPendingItemResponse(BaseModel):
    source: str
    source_path: str
    artist: str
    album: str
    track_count: int
    formats: list[str] = Field(default_factory=list)
    total_size_mb: int | float
    dest_path: str
    dest_exists: bool
    status: str
    dest_album_id: int | None = None
    task_id: str | None = None
    last_error: str | None = None
    discovered_at: datetime | None = None
    updated_at: datetime | None = None


class ImportPendingResponse(RootModel[list[ImportPendingItemResponse]]):
    pass


class ImportResultResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str | None = None
    dest: str | None = None
    tracks: int | None = None
    copied: int | None = None
    skipped: int | None = None
    source: str | None = None
    source_path: str | None = None
    error: str | None = None


class ImportResultsResponse(RootModel[list[ImportResultResponse]]):
    pass


class ImportRemoveResponse(BaseModel):
    removed: bool


class OrganizeApplyRequest(BaseModel):
    pattern: str | None = None
    rename_folder: str | None = None


class OrganizePresetsResponse(RootModel[dict[str, str]]):
    pass


class OrganizePreviewTrackTagsResponse(BaseModel):
    title: str = ""
    tracknumber: str = ""
    discnumber: str = "1"


class OrganizePreviewItemResponse(BaseModel):
    current: str
    proposed: str
    changed: bool
    tags: OrganizePreviewTrackTagsResponse


class OrganizePreviewResponse(BaseModel):
    tracks: list[OrganizePreviewItemResponse] = Field(default_factory=list)
    folder_current: str
    folder_suggested: str
    changes: int


class OrganizeApplyErrorResponse(BaseModel):
    file: str
    error: str


class OrganizeApplyResponse(BaseModel):
    renamed_tracks: int
    total: int
    errors: list[OrganizeApplyErrorResponse] = Field(default_factory=list)
    folder_renamed: str | None = None
    folder_error: str | None = None


class StackContainerResponse(BaseModel):
    id: str
    name: str
    image: str
    state: str
    status: str | None = None
    ports: list[str] = Field(default_factory=list)


class StackStatusResponse(BaseModel):
    available: bool
    total: int = 0
    running: int = 0
    containers: list[StackContainerResponse] = Field(default_factory=list)


class StackInventoryHostResponse(BaseModel):
    id: str
    name: str


class StackInventoryStackResponse(BaseModel):
    id: str
    kind: Literal["application", "observability"]
    project: str


class StackInventoryServiceResponse(BaseModel):
    id: str
    stack_id: Literal["application", "observability"]
    service: str
    project: str
    container_id: str
    container_name: str
    image: str
    runtime_state: str
    health: Literal["healthy", "unhealthy", "starting", "none"]
    status: str
    actions: list[Literal["restart", "stop", "start"]] = Field(default_factory=list)


class StackInventoryResponse(BaseModel):
    schema_version: int
    availability: Literal["available", "unavailable"]
    reason: str | None = None
    host: StackInventoryHostResponse
    stacks: list[StackInventoryStackResponse] = Field(default_factory=list)
    services: list[StackInventoryServiceResponse] = Field(default_factory=list)


class AdminStackSnapshotResponse(BaseModel):
    snapshot: SnapshotMetadataResponse
    stack: StackStatusResponse
    inventory: StackInventoryResponse | None = None


class StackContainerDetailResponse(StackContainerResponse):
    running: bool | None = None
    started_at: str | None = None
    finished_at: str | None = None
    restart_count: int | None = None
    env: list[str] = Field(default_factory=list)
    mounts: list[str] = Field(default_factory=list)
    memory_limit: int | None = None


class StackContainerLogsResponse(BaseModel):
    name: str
    logs: str


class StackActionResponse(BaseModel):
    status: str
    name: str


class CacheInvalidationRequest(BaseModel):
    scopes: list[str] = Field(default_factory=list)


class CacheInvalidationResponse(BaseModel):
    ok: bool = True
    scopes: list[str] = Field(default_factory=list)


class LyricsResponse(BaseModel):
    syncedLyrics: str | None = None
    plainLyrics: str | None = None


class AlbumTagsUpdate(BaseModel):
    artist: str | None = None
    albumartist: str | None = None
    album: str | None = None
    date: str | None = None
    genre: str | None = None
    tracks: dict[str, dict[str, str]] = Field(default_factory=dict)


class TrackTagsUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")


class ArtistMetadataUpdate(BaseModel):
    bio: str | None = None
    tags: list[str] | None = None
    genres: list[str] | None = None
    urls: dict[str, str] | None = None
    mbid: str | None = None
    country: str | None = None
    area: str | None = None
    formed: str | None = None
    ended: str | None = None
    artist_type: str | None = None
    bandcamp_url: str | None = None

    @field_validator(
        "bio",
        "mbid",
        "country",
        "area",
        "formed",
        "ended",
        "artist_type",
        "bandcamp_url",
        mode="before",
    )
    @classmethod
    def blank_string_to_none(cls, value):
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.split(",")
        if not isinstance(value, list | tuple):
            return []
        seen = set()
        tags = []
        for item in value:
            tag = str(item).strip()
            key = tag.lower()
            if tag and key not in seen:
                seen.add(key)
                tags.append(tag)
        return tags

    @field_validator("urls", mode="before")
    @classmethod
    def normalize_urls(cls, value):
        if value is None:
            return None
        if not isinstance(value, dict):
            return {}
        urls: dict[str, str] = {}
        for raw_key, raw_url in value.items():
            key = str(raw_key).strip()
            url = str(raw_url).strip()
            if key and url:
                urls[key] = url
        return urls


class ArtistSmartMixProfileResponse(BaseModel):
    """Scalar metadata; binary beat grids are excluded from this collection read."""

    profile_version: int | None = None
    profile_revision: str | None = None
    analyzer: str | None = None
    analyzer_version: str | None = None
    source_revision: str | None = None
    quality: str | None = None
    is_current_full_profile: bool = False
    analyzed_at: datetime | None = None
    source_stale_at: datetime | None = None
    duration_ms: int | None = None
    integrated_lufs: float | None = None
    measurement_version: str | None = None
    true_peak_dbfs: float | None = None
    intro_lufs: float | None = None
    outro_lufs: float | None = None
    bpm: float | None = None
    bpm_confidence: float | None = None
    tempo_stability: float | None = None
    beat_anchor_ms: int | None = None
    downbeat_anchor_ms: int | None = None
    time_signature: int | None = None
    beat_grid_format: str | None = None
    key_confidence: float | None = None
    intro_cue_ms: int | None = None
    outro_cue_ms: int | None = None
    active_start_ms: int | None = None
    active_end_ms: int | None = None
    intro_bpm: float | None = None
    outro_bpm: float | None = None
    intro_beat_ms: int | None = None
    outro_beat_ms: int | None = None
    intro_tempo_stability: float | None = None
    outro_tempo_stability: float | None = None
    intro_downbeat_ms: int | None = None
    outro_downbeat_ms: int | None = None
    intro_energy: float | None = None
    outro_energy: float | None = None
    intro_spectral_density: float | None = None
    outro_spectral_density: float | None = None
    global_energy: float | None = None
    danceability: float | None = None
    valence: float | None = None
    bliss_vector_revision: str | None = None
    key: str | None = None
    scale: str | None = None
    camelot: str | None = None
    status: str | None = None


class ArtistBlissReferenceResponse(BaseModel):
    available: bool
    dimensions: int | None = None
    state: str | None = None
    computed_at: datetime | None = None
    revision: str | None = None
    revision_source: str | None = None


class ArtistAnalysisTrackResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    track_id: int | None = None
    track_entity_uid: str | None = None
    album_id: int | None = None
    analysis_state: str | None = None
    analysis_completed_at: datetime | None = None
    smart_mix: ArtistSmartMixProfileResponse | None = None
    bliss: ArtistBlissReferenceResponse | None = None
    mood: dict[str, Any] | None = None


class ArtistAnalysisDataResponse(RootModel[dict[str, ArtistAnalysisTrackResponse]]):
    pass


class ArtistEnrichmentResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    lastfm: dict[str, Any] | None = None
    spotify: dict[str, Any] | None = None
    musicbrainz: dict[str, Any] | None = None
    setlist: dict[str, Any] | None = None
    fanart: dict[str, Any] | None = None


class SetlistPlaylistResponse(BaseModel):
    playlist_id: int
    playlist_name: str
    matched: int
    unmatched: list[str] = Field(default_factory=list)
    total_setlist: int
    created: bool
