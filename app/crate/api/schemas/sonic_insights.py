"""Measured sonic regions and local Bliss neighbors for Collection Insights."""

from typing import Literal

from pydantic import BaseModel, Field, FiniteFloat


class SonicTrack(BaseModel):
    id: int
    entity_uid: str | None = None
    title: str
    album_id: int
    album_entity_uid: str | None = None
    album: str
    album_slug: str | None = None
    artist: str
    artist_slug: str | None = None
    year: str | None = None
    has_cover: bool
    heard: bool
    plays: FiniteFloat = Field(ge=0)
    minutes: FiniteFloat = Field(ge=0)
    bpm: FiniteFloat | None = None
    bpm_confidence: FiniteFloat | None = None
    energy: FiniteFloat | None = None
    integrated_lufs: FiniteFloat | None = None
    true_peak_dbfs: FiniteFloat | None = None
    key_camelot: str | None = None
    key_confidence: FiniteFloat | None = None
    tempo_stability: FiniteFloat | None = None
    quality: str | None = None
    has_bliss: bool
    acousticness: FiniteFloat | None = None
    instrumentalness: FiniteFloat | None = None
    valence: FiniteFloat | None = None


class SonicAxis(BaseModel):
    label: str
    unit: str
    min: FiniteFloat
    max: FiniteFloat
    bins: int = Field(ge=1, le=20)


class SonicCoverage(BaseModel):
    catalogue_tracks: int = Field(ge=0)
    paired_tracks: int = Field(ge=0)
    heard_tracks: int = Field(ge=0)
    paired_heard_tracks: int = Field(ge=0)


class SonicCell(BaseModel):
    id: str
    column: int = Field(ge=0)
    row: int = Field(ge=0)
    x_min: FiniteFloat
    x_max: FiniteFloat
    y_min: FiniteFloat
    y_max: FiniteFloat
    tracks: int = Field(ge=0)
    albums: int = Field(ge=0)
    heard_tracks: int = Field(ge=0)
    heard_albums: int = Field(ge=0)
    plays: FiniteFloat = Field(ge=0)
    minutes: FiniteFloat = Field(ge=0)
    catalogue_share: FiniteFloat = Field(ge=0, le=100)
    listening_share: FiniteFloat = Field(ge=0, le=100)
    examples: list[SonicTrack] = Field(default_factory=list, max_length=6)


class SonicPlane(BaseModel):
    key: Literal["tempo_energy", "tempo_lufs"]
    x: SonicAxis
    y: SonicAxis
    coverage: SonicCoverage
    cells: list[SonicCell] = Field(default_factory=list, max_length=80)


class SonicSource(BaseModel):
    analyzer_version: str
    profile_version: int
    measurement_version: str


class SonicReport(BaseModel):
    version: Literal[1]
    source: SonicSource
    planes: list[SonicPlane] = Field(max_length=2)


class SonicNeighbor(BaseModel):
    track: SonicTrack
    distance: FiniteFloat = Field(ge=0, le=2)


class SonicNeighborsResponse(BaseModel):
    seed_track_id: int
    available: bool
    items: list[SonicNeighbor] = Field(default_factory=list, max_length=12)
