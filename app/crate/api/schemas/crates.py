"""Request and response models for Listen Crates."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import OkResponse


class CreateCrateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    is_collaborative: bool = False


class UpdateCrateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    visibility: Literal["private", "public"] | None = None
    is_collaborative: bool | None = None


class AddCrateAlbumRequest(BaseModel):
    global_album_uid: UUID


class ReorderCrateAlbumsRequest(BaseModel):
    global_album_uids: list[UUID]


class CreateCrateInviteRequest(BaseModel):
    expires_in_hours: int = Field(default=168, ge=0, le=8760)
    max_uses: int | None = Field(default=20, ge=1, le=500)


class CrateAlbumResponse(BaseModel):
    global_album_uid: str
    position: int
    name: str
    artist_name: str
    year: str | None = None
    has_cover: bool = False
    artwork_source_json: dict[str, Any] | None = None


class CrateSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    owner_id: int
    owner_username: str | None = None
    owner_name: str | None = None
    name: str
    description: str = ""
    visibility: Literal["private", "public"]
    is_collaborative: bool
    access: Literal["owner", "collaborator", "public"] | None = None
    album_count: int = 0
    first_album: CrateAlbumResponse | None = None
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class CrateDetailResponse(CrateSummaryResponse):
    owner_avatar: str | None = None
    albums: list[CrateAlbumResponse] = Field(default_factory=list)


class CratePlaybackTrackResponse(BaseModel):
    global_track_uid: str
    global_album_uid: str
    global_artist_uid: str
    local_track_id: int | None = None
    local_track_entity_uid: str | None = None
    title: str
    artist: str
    album: str | None = None
    duration: int | None = None
    disc_number: int | None = None
    track_number: int | None = None


class CrateCreateResponse(BaseModel):
    id: str


class CrateMemberResponse(BaseModel):
    crate_id: str
    user_id: int
    invited_by: int | None = None
    created_at: datetime | str | None = None
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None


class CrateMembersMutationResponse(OkResponse):
    members: list[CrateMemberResponse] = Field(default_factory=list)


class CrateInviteResponse(BaseModel):
    token: str
    crate_id: str
    created_by: int | None = None
    expires_at: datetime | str | None = None
    max_uses: int | None = None
    use_count: int = 0
    created_at: datetime | str | None = None
    join_url: str
    qr_value: str


class CrateInvitePreviewResponse(BaseModel):
    crate_id: str
    crate_name: str
    owner_name: str | None = None
    owner_username: str | None = None
    expires_at: datetime | str | None = None


class CrateInviteAcceptResponse(OkResponse):
    crate_id: str


__all__ = [
    "AddCrateAlbumRequest",
    "CrateAlbumResponse",
    "CrateCreateResponse",
    "CrateDetailResponse",
    "CrateInviteAcceptResponse",
    "CrateInvitePreviewResponse",
    "CrateInviteResponse",
    "CrateMemberResponse",
    "CrateMembersMutationResponse",
    "CratePlaybackTrackResponse",
    "CrateSummaryResponse",
    "CreateCrateInviteRequest",
    "CreateCrateRequest",
    "ReorderCrateAlbumsRequest",
    "UpdateCrateRequest",
]
