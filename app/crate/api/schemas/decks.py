"""Crate Decks library navigation (S3) and batch mix profile (S4) contracts."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.smart_mix import MixProfileResponse
from crate.db.queries.decks_profiles import DECKS_PROFILES_BATCH_LIMIT

DecksContainerKind = Literal["playlist", "crate", "genre", "mood", "recent", "likes"]
DecksProfileQuality = Literal["full", "partial", "legacy", "unavailable"]


class DecksContainerNodeResponse(BaseModel):
    id: str = Field(
        description=(
            "Container id, unique within its kind: a playlist or genre number, "
            "a crate UUID, a mood key, or 'me' for recent and likes."
        )
    )
    kind: DecksContainerKind = Field(
        description="Clients must ignore kinds they do not know."
    )
    name: str
    parent_id: str | None = Field(
        default=None,
        description="Parent container id. Always null today (no folders).",
    )
    track_count: int | None = Field(
        default=None,
        description=(
            "Present only when the server keeps it precomputed (playlists, "
            "and genres from their albums' counts). It counts every entry, "
            "including ones without a local track that the tracks endpoint "
            "leaves out."
        ),
    )
    etag: str = Field(
        description=(
            "Changes when the container's membership or order changes, as far "
            "as the server tracks it without reading the tracks (mood nodes "
            "never change). Track metadata, profile and mood changes are "
            "signalled by the page ETag."
        )
    )


class DecksLibraryResponse(BaseModel):
    track_count: int = Field(
        ge=0,
        description=(
            "Every track in the library, from the albums' precomputed counts. "
            "It changes the tree ETag, not any node etag."
        ),
    )


class DecksContainersResponse(BaseModel):
    library: DecksLibraryResponse
    containers: list[DecksContainerNodeResponse]


class DecksContainerRefResponse(BaseModel):
    kind: DecksContainerKind
    id: str


class DecksTrackResponse(BaseModel):
    entity_uid: str
    global_track_uid: str | None
    title: str
    artist: str
    album: str | None
    duration_ms: int | None
    bpm: float | None = Field(description="Smart Mix BPM, else the tag BPM.")
    camelot: str | None
    energy: float | None = Field(description="Smart Mix global energy, 0 to 1.")
    genre: str | None
    format: str | None
    bitrate: int | None
    sample_rate: int | None
    bit_depth: int | None
    byte_length: int | None = Field(
        description=(
            "Size of the audio file the stream endpoints serve; the size the "
            "scanner recorded when the file is not playable."
        )
    )
    source_revision: str | None = Field(
        description=(
            "Revision of the audio file on disk (same value as a current "
            "profile's source revision); null when the file is not playable."
        )
    )
    profile_revision: str | None = Field(
        description=(
            "Revision of the Smart Mix profile that "
            "GET /api/tracks/by-entity/{uid}/mix-profile serves; null when none."
        )
    )
    profile_quality: DecksProfileQuality | None = Field(
        description="Quality of that Smart Mix profile; null when none."
    )
    playable: bool = Field(
        description=(
            "True when the audio file exists in the library as a regular file, "
            "so the stream endpoints can serve it (same check as the DJ search)."
        )
    )
    cover_url: str | None


class DecksTracksPageResponse(BaseModel):
    container: DecksContainerRefResponse
    tracks: list[DecksTrackResponse]
    next_cursor: str | None = Field(
        description="Opaque cursor for the next page; null on the last page."
    )


class DecksMixProfilesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_uids: list[UUID] = Field(
        min_length=1,
        max_length=DECKS_PROFILES_BATCH_LIMIT,
        description="Track entity UIDs, 1 to 200. Repeated UIDs are answered once.",
    )
    detail: Literal["full"] = Field(
        default="full",
        description="Only `full`: the profiles carry the beat grid and stems layer.",
    )


class DecksMixProfilesResponse(BaseModel):
    profiles: dict[str, MixProfileResponse] = Field(
        description=(
            "By entity UID (lowercase, hyphenated), in request order: the same "
            "profile GET /api/tracks/by-entity/{uid}/mix-profile?detail=full serves."
        )
    )
    missing: list[UUID] = Field(
        description=(
            "Requested UIDs without a current profile, in request order: not in "
            "the local library, never analysed, or the file changed since. The "
            "single endpoint answers 404 for each."
        )
    )


__all__ = [
    "DecksContainerKind",
    "DecksContainerNodeResponse",
    "DecksContainerRefResponse",
    "DecksContainersResponse",
    "DecksLibraryResponse",
    "DecksMixProfilesRequest",
    "DecksMixProfilesResponse",
    "DecksProfileQuality",
    "DecksTrackResponse",
    "DecksTracksPageResponse",
]
