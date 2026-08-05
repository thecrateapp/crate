"""Schema models for jam session endpoints."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class _JamModel(BaseModel):
    model_config = ConfigDict(extra="allow")


JamQueueMode = Literal["manual", "auto", "auto_dj"]


class JamRoomCreateRequest(_JamModel):
    name: str
    visibility: Literal["public", "private"] = "private"
    is_permanent: bool = False
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    queue_mode: JamQueueMode = "manual"
    auto_dj_voting: bool = True
    genre_filters: list[str] = Field(default_factory=list)


class JamRoomUpdateRequest(_JamModel):
    name: str | None = None
    visibility: Literal["public", "private"] | None = None
    is_permanent: bool | None = None
    description: str | None = None
    tags: list[str] | None = None
    queue_mode: JamQueueMode | None = None
    auto_dj_voting: bool | None = None
    genre_filters: list[str] | None = None


class JamInviteCreateRequest(_JamModel):
    expires_in_hours: int = 24
    max_uses: int | None = 20


class JamInviteJoinRequest(_JamModel):
    role: str = "collab"


class JamMemberResponse(_JamModel):
    room_id: str | UUID | None = None
    user_id: int
    role: str
    joined_at: str | datetime | None = None
    last_seen_at: str | datetime | None = None
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None


class JamEventResponse(_JamModel):
    id: int | None = None
    room_id: str | UUID | None = None
    user_id: int | None = None
    event_type: str | None = None
    payload_json: Any | None = None
    created_at: str | datetime | None = None
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None


class JamQueueItemResponse(_JamModel):
    id: str
    room_id: str | UUID | None = None
    track: Any
    added_by: int | None = None
    source: str = "owner"
    status: str = "queued"
    position: int = 0
    vote_count: int = 0
    voted_by_me: bool = False
    created_at: str | datetime | None = None


class JamTrackRequestResponse(_JamModel):
    id: str
    room_id: str | UUID | None = None
    track: Any
    requested_by: int | None = None
    status: str = "pending"
    resolved_by: int | None = None
    queue_item_id: str | None = None
    created_at: str | datetime | None = None
    resolved_at: str | datetime | None = None


class JamRoomResponse(_JamModel):
    id: str | UUID
    host_user_id: int | None = None
    name: str
    status: str | None = None
    visibility: Literal["public", "private"] | None = "private"
    is_permanent: bool = False
    queue_mode: JamQueueMode = "manual"
    auto_dj_voting: bool = True
    genre_filters: list[str] = Field(default_factory=list)
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: str | datetime | None = None
    ended_at: str | datetime | None = None
    current_track_payload: Any | None = None
    member_count: int | None = None
    is_member: bool | None = None
    last_event_at: str | datetime | None = None
    members: list[JamMemberResponse] = Field(default_factory=list)
    events: list[JamEventResponse] = Field(default_factory=list)
    queue: list[JamQueueItemResponse] = Field(default_factory=list)
    requests: list[JamTrackRequestResponse] = Field(default_factory=list)
    auto_dj_suggestions: list[Any] = Field(default_factory=list)


class JamRoomListResponse(_JamModel):
    rooms: list[JamRoomResponse] = Field(default_factory=list)


class JamRoomDeleteResponse(_JamModel):
    ok: bool = True
    room_id: str | UUID


class JamInviteResponse(_JamModel):
    token: str
    room_id: str | UUID | None = None
    created_by: int | None = None
    expires_at: str | datetime | None = None
    max_uses: int | None = None
    use_count: int | None = None
    created_at: str | datetime | None = None
    join_url: str | None = None
    qr_value: str | None = None


class JamJoinResponse(_JamModel):
    ok: bool = True
    room: JamRoomResponse
    event: JamEventResponse | None = None
