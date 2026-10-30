"""Schema models for radio and recommendation endpoints."""

from crate.api.schemas.common import TrackMediaFieldsMixin

from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from uuid import UUID

from crate.api.schemas.common import IdentityFieldsMixin


class RadioTrack(IdentityFieldsMixin, TrackMediaFieldsMixin):
    model_config = ConfigDict(extra="allow")

    track_id: int | None = None
    track_entity_uid: str | None = None
    track_path: str | None = None
    path: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    duration: float | None = None
    score: float | None = None
    bpm: float | None = None
    audio_key: str | None = None
    audio_scale: str | None = None
    energy: float | None = None
    danceability: float | None = None
    valence: float | None = None
    bliss_vector: list[float] | None = None


class RadioSeed(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    artist_id: int | None = None
    artist_name: str | None = None
    track_id: int | None = None
    track_entity_uid: str | None = None
    track_path: str | None = None
    title: str | None = None
    artist: str | None = None
    album_id: int | None = None
    album: str | None = None
    playlist_id: int | str | None = None
    name: str | None = None


class RadioSession(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    name: str
    seed: RadioSeed


class RadioResponse(BaseModel):
    session: RadioSession
    tracks: list[RadioTrack]


class PersonalizedRadioStation(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    seed_type: str
    seed_value: str
    seed_label: str
    seed_subtitle: str | None = None
    title: str
    subtitle: str = ""
    play_count: int = 0
    minutes_listened: int = 0
    artist_id: int | None = None
    artist_entity_uid: str | None = None
    artist_slug: str | None = None
    artist_name: str | None = None
    genre_slug: str | None = None
    genre_name: str | None = None
    album_id: int | None = None
    album_entity_uid: str | None = None
    album_slug: str | None = None
    album_name: str | None = None
    cover_url: str | None = None


class PersonalizedRadioStationsResponse(BaseModel):
    artist_stations: list[PersonalizedRadioStation]
    genre_stations: list[PersonalizedRadioStation]


class RadioStartRequest(BaseModel):
    mode: Literal["seeded", "discovery"] = "seeded"
    seed_type: str | None = None
    seed_value: str | None = None
    session_id: UUID | None = None
    count: int = Field(default=20, ge=1, le=50)
    buffer_refs: list[str] = Field(default_factory=list, max_length=200)


class RadioNextRequest(BaseModel):
    session_id: UUID
    count: int = Field(default=20, ge=1, le=50)
    batch_index: int | None = Field(default=None, ge=1)
    buffer_refs: list[str] = Field(default_factory=list, max_length=200)


class RadioBatchResponse(BaseModel):
    session_id: str
    tracks: list[RadioTrack]
    mode: str | None = None
    seed_label: str | None = None
    batch_index: int | None = None
    status: Literal["ok", "retryable_empty", "exhausted", "auth_required"] = "ok"
    exhausted: bool = False
