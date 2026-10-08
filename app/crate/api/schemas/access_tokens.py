from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AccessTokenCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(min_length=1, max_length=10)
    expires_in_days: int | None = Field(default=None, ge=1, le=365)


class AccessTokenResponse(BaseModel):
    id: int
    name: str
    token_type: str
    token_prefix: str
    scopes: list[str]
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime
    last_used_at: datetime | None = None
    token: str | None = None


class AccessTokenListResponse(BaseModel):
    id: int
    name: str
    token_type: str
    token_prefix: str
    scopes: list[str]
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime
    last_used_at: datetime | None = None
