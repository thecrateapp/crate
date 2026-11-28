"""Device browse, search and queue API (AA3): `/api/me/device/*`."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from crate.api.schemas.smart_mix import ContinuationDescriptor

DeviceItemKind = Literal[
    "folder", "album", "artist", "playlist", "track", "mix", "station"
]
DeviceDelivery = Literal["auto", "original", "balanced", "data_saver"]

DEVICE_QUEUE_LIMIT = 500


class DeviceBrowseItemResponse(BaseModel):
    id: str = Field(
        description=(
            "Encodes the kind and its id: `album:<uid>`, `artist:<uid>`, "
            "`playlist:<id>`, `track:<uid>`, `mix:<id>`, `station:<artist|album>:<id>`, "
            "or a node name for folders. Browsable ids are nodes; playable ids "
            "start a queue through POST /api/me/device/queue."
        )
    )
    kind: DeviceItemKind
    title: str
    subtitle: str | None = None
    artwork_url: str | None = Field(
        default=None,
        description="Canonical API artwork path, authorized with the device token.",
    )
    playable: bool
    browsable: bool
    duration_ms: int | None = Field(default=None, description="Tracks only.")
    group: str | None = Field(
        default=None,
        description="Section of a mixed node (home, search), for group titles.",
    )


class DeviceBrowsePageResponse(BaseModel):
    node: str
    title: str
    items: list[DeviceBrowseItemResponse]
    next_cursor: str | None = Field(
        description="Opaque cursor for the next page; null on the last page."
    )


class DeviceQueueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node: str | None = Field(
        default=None,
        min_length=1,
        max_length=160,
        description=(
            "A playable container: `album:<uid>`, `playlist:<id>`, `liked`, "
            "`mix:<id>`, `artist:<uid>` (top tracks) or "
            "`station:<artist|album>:<id>`."
        ),
    )
    item_ids: list[str] | None = Field(
        default=None,
        min_length=1,
        max_length=DEVICE_QUEUE_LIMIT,
        description="Explicit `track:<uid>` ids, played in this order.",
    )
    start_item_id: str | None = Field(default=None, max_length=160)
    shuffle: bool = False
    delivery: DeviceDelivery = Field(
        default="auto",
        description=(
            "`balanced` and `data_saver` are added to each stream URL; `auto` and "
            "`original` leave it out (the device resolves `auto` itself)."
        ),
    )

    @model_validator(mode="after")
    def _one_source(self) -> "DeviceQueueRequest":
        if (self.node is None) == (self.item_ids is None):
            raise ValueError("send either node or item_ids")
        return self


class DeviceQueueTrackResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    entity_uid: str = Field(alias="entityUid")
    url: str
    title: str
    artist: str
    album: str | None = None
    artwork: str | None = None
    duration_ms: int | None = Field(default=None, alias="durationMs")


class DeviceQueueResponse(BaseModel):
    tracks: list[DeviceQueueTrackResponse]
    start_index: int
    continuation: ContinuationDescriptor | None = Field(
        default=None,
        description=(
            "For radios and mixes: the descriptor to refill the queue through "
            "the playback continuation. Null for finite containers."
        ),
    )


__all__ = [
    "DEVICE_QUEUE_LIMIT",
    "DeviceBrowseItemResponse",
    "DeviceBrowsePageResponse",
    "DeviceDelivery",
    "DeviceItemKind",
    "DeviceQueueRequest",
    "DeviceQueueResponse",
    "DeviceQueueTrackResponse",
]
