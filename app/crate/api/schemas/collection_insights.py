"""Explicit contract for collection versus registered listening."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from crate.api.schemas.common import SnapshotMetadataResponse
from crate.api.schemas.sonic_insights import SonicReport


class CollectionInsightAlbum(BaseModel):
    id: int
    entity_uid: str | None = None
    slug: str | None = None
    title: str
    artist: str
    artist_slug: str | None = None
    year: str | None = None
    has_cover: bool = False
    tracks: int = 0
    played_tracks: int = 0
    minutes: float = 0
    last_day: date | None = None


class CollectionInsightComparison(BaseModel):
    key: str
    label: str
    genre_slug: str | None = None
    tracks: int
    albums: int
    played_tracks: int
    plays: float
    minutes: float
    catalogue_share: float
    listening_share: float
    previous_listening_share: float
    examples: list[CollectionInsightAlbum] = Field(default_factory=list)


class CollectionInsightArtistChange(BaseModel):
    id: int
    entity_uid: str | None = None
    slug: str | None = None
    name: str
    has_photo: bool = False
    current_minutes: float
    previous_minutes: float
    delta_minutes: float


class CollectionInsightReading(BaseModel):
    plays: int
    minutes: float
    tracks: int
    albums: int
    concentration_pct: float | None = None


class CollectionInsightPeriod(BaseModel):
    start: date
    end: date
    previous_start: date
    previous_end: date
    history_start: date | None = None
    calendar: Literal["listener_local_days"]
    previous_complete: bool
    history_complete: bool


class CollectionInsightCatalogue(BaseModel):
    tracks: int
    albums: int


class CollectionInsightExcluded(BaseModel):
    plays: int
    minutes: float


class CollectionInsightDay(BaseModel):
    day: date
    minutes: float
    previous_minutes: float


class CollectionInsightAlbums(BaseModel):
    total: int
    items: list[CollectionInsightAlbum] = Field(default_factory=list)


class CollectionInsightImprovement(BaseModel):
    key: Literal["full", "bliss"]
    tracks: int
    minutes: float
    albums: list[CollectionInsightAlbum] = Field(default_factory=list)


class CollectionInsightSnapshot(SnapshotMetadataResponse):
    missing: bool = False
    pending: bool = False
    refresh_error: bool = False
    source_seq: int = 0
    task_id: str | None = None


class CollectionInsightsResponse(BaseModel):
    ready: bool
    window: Literal["30d", "90d", "365d"]
    period: CollectionInsightPeriod | None = None
    catalogue: CollectionInsightCatalogue | None = None
    current: CollectionInsightReading | None = None
    previous: CollectionInsightReading | None = None
    excluded: CollectionInsightExcluded | None = None
    timeline: list[CollectionInsightDay] = Field(default_factory=list)
    genres: list[CollectionInsightComparison] = Field(default_factory=list)
    decades: list[CollectionInsightComparison] = Field(default_factory=list)
    rising: list[CollectionInsightArtistChange] = Field(default_factory=list)
    falling: list[CollectionInsightArtistChange] = Field(default_factory=list)
    unheard: CollectionInsightAlbums
    rediscover: CollectionInsightAlbums
    improvements: list[CollectionInsightImprovement] = Field(default_factory=list)
    sonic: SonicReport | None = None
    snapshot: CollectionInsightSnapshot
