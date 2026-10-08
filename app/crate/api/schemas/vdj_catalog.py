from __future__ import annotations

from pydantic import BaseModel


class VdjCatalogFolderResponse(BaseModel):
    id: str
    name: str


class VdjCatalogTrackResponse(BaseModel):
    entity_uid: str
    title: str
    artist: str | None = None
    album: str | None = None
    duration: float | None = None
    year: str | None = None
    genre: str | None = None
    bpm: float | None = None
    audio_key: str | None = None
    audio_scale: str | None = None
    has_cover: bool = False
    cover_url: str | None = None


class VdjCatalogResponse(BaseModel):
    folders: list[VdjCatalogFolderResponse]
    tracks: list[VdjCatalogTrackResponse]
    next_cursor: str | None = None
