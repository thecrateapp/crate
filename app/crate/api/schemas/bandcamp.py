from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class BandcampConnectionStatusResponse(BaseModel):
    connected: bool
    status: str = "disconnected"
    bridge_enabled: bool = False
    bridge_ready: bool = False
    bridge_backend: str | None = None
    bridge_message: str | None = None
    username: str | None = None
    fan_id: int | None = None
    display_name: str | None = None
    image_url: str | None = None
    connection_method: str | None = None
    last_sync_at: datetime | str | None = None
    last_success_at: datetime | str | None = None
    last_error: str | None = None


class BandcampSessionConnectRequest(BaseModel):
    pairing_id: str | None = None
    connection_method: str = "native_desktop"
    session: dict[str, Any]


class BandcampCookieConnectRequest(BaseModel):
    cookie: str = Field(
        min_length=1,
        description="Bandcamp identity cookie value or a full Cookie header.",
    )
    connection_method: str = "manual_cookie"


class BandcampTaskResponse(BaseModel):
    task_id: str
    pairing_id: str | None = None
    status: str = "queued"
    import_id: int | None = None


class BandcampCollectionResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    total: int


class BandcampImportRequest(BaseModel):
    bandcamp_item_id: int
    format: str = Field(default="flac")
    force: bool = False


class BandcampImportResponse(BaseModel):
    imports: list[dict[str, Any]] = Field(default_factory=list)
    total: int


class BandcampContributionResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    total: int


class BandcampRadarResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    total: int
