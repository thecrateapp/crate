"""Schema models for unified acquisition endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel

from crate.api.schemas.common import SnapshotMetadataResponse
from crate.api.schemas.tidal import TidalQueueItemResponse


class AcquisitionSourceStatusResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    authenticated: bool | None = None
    connected: bool | None = None
    loggedIn: bool | None = None
    state: str | None = None
    version: str | None = None


class AcquisitionStatusResponse(BaseModel):
    tidal: AcquisitionSourceStatusResponse
    soulseek: AcquisitionSourceStatusResponse


class SoulseekSearchRequest(BaseModel):
    query: str = ""
    artist: str = ""
    album: str = ""


class SoulseekSearchStartResponse(BaseModel):
    search_id: str
    query: str


class SoulseekFileResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    filename: str
    size: int = 0
    length: int = 0
    extension: str = ""
    bitDepth: int | None = None
    sampleRate: int | None = None
    bitRate: int | None = None


class SoulseekSearchResultResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    username: str
    speed: int = 0
    freeSlot: bool = False
    album: str = ""
    artist: str = ""
    files: list[SoulseekFileResponse] = Field(default_factory=list)
    quality: str = ""
    totalSize: int = 0


class SoulseekSearchPollResponse(BaseModel):
    state: str = "Unknown"
    isComplete: bool = False
    responseCount: int = 0
    fileCount: int = 0
    results: list[SoulseekSearchResultResponse] = Field(default_factory=list)


class AcquisitionDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str = ""
    artist: str = ""
    album: str = ""
    tidal_id: str = ""
    tidal_type: str = "album"
    username: str = ""
    files: list[Any] = Field(default_factory=list)
    find_alternate: bool = False
    upgrade_album_id: int | None = None


class AcquisitionDownloadResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    task_id: str
    source: str
    finding_alternate: bool | None = None
    enqueued: int | None = None


class AcquisitionUploadResponse(BaseModel):
    task_id: str
    upload_id: str
    file_count: int
    total_bytes: int


class AcquisitionUploadChunkedFileRequest(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    size: int = Field(ge=0)
    type: str | None = None


class AcquisitionUploadChunkedInitRequest(BaseModel):
    files: list[AcquisitionUploadChunkedFileRequest] = Field(min_length=1)


class AcquisitionUploadChunkedInitResponse(BaseModel):
    upload_id: str
    file_count: int
    chunk_size: int


class NewReleaseResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    artist_name: str
    album_title: str
    status: str
    tidal_id: str | None = None
    tidal_url: str | None = None
    cover_url: str | None = None
    year: str | int | None = None
    tracks: int | None = None
    quality: str | None = None
    release_date: str | None = None
    release_type: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album_id: int | None = None
    album_slug: str | None = None


class NewReleasesResponse(BaseModel):
    releases: list[NewReleaseResponse] = Field(default_factory=list)


class NewReleasesSurfaceResponse(BaseModel):
    releases: list[NewReleaseResponse] = Field(default_factory=list)
    snapshot: SnapshotMetadataResponse | None = None


class AcquisitionQueueItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str
    artist: str = ""
    album: str = ""
    status: str = ""
    progress: Any = None
    task_id: str | None = None
    filename: str | None = None
    fullPath: str | None = None
    username: str | None = None
    speed: int | float | None = None


class AcquisitionQueueResponse(RootModel[list[AcquisitionQueueItemResponse]]):
    pass


class AcquisitionSurfaceResponse(BaseModel):
    tidal_authenticated: bool
    tidal_queue: list[TidalQueueItemResponse] = Field(default_factory=list)
    soulseek_queue: list[AcquisitionQueueItemResponse] = Field(default_factory=list)
    snapshot: SnapshotMetadataResponse | None = None


class QueueClearResponse(BaseModel):
    cleared: bool


class ArtistSuggestionCreateRequest(BaseModel):
    artist_name: str = Field(min_length=2, max_length=200)
    artist_url: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)


class ArtistSuggestionStatusRequest(BaseModel):
    status: str
    linked_artist_id: int | None = None
    linked_task_id: str | None = None


class ArtistSuggestionSupporterResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    user_id: int | None = None
    name: str | None = None
    email: str | None = None
    avatar: str | None = None
    note: str | None = None
    artist_url: str | None = None
    created_at: datetime | None = None


class ArtistSuggestionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    artist_name: str
    normalized_artist_name: str | None = None
    artist_url: str | None = None
    note: str | None = None
    status: str
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_by_email: str | None = None
    created_by_avatar: str | None = None
    triaged_by_user_id: int | None = None
    triaged_by_name: str | None = None
    linked_artist_id: int | None = None
    linked_task_id: str | None = None
    supporter_count: int = 0
    supporters: list[ArtistSuggestionSupporterResponse] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    resolved_at: datetime | None = None


class ArtistSuggestionsResponse(BaseModel):
    suggestions: list[ArtistSuggestionResponse] = Field(default_factory=list)
