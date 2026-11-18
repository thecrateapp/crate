from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UserDataExportResponse(BaseModel):
    id: str
    status: Literal["pending", "ready", "failed", "expired"]
    created_at: datetime
    completed_at: datetime | None = None
    expires_at: datetime | None = None
    filename: str | None = None
    bytes: int | None = None
    download_url: str | None = None


class UserDataExportStatusResponse(BaseModel):
    export: UserDataExportResponse | None = None


class AccountDeletionRequirementsResponse(BaseModel):
    requires_password: bool
    recent_sign_in: bool
    recent_sign_in_window_seconds: int


class DeleteAccountRequest(BaseModel):
    password: str | None = Field(default=None, max_length=1024)


__all__ = [
    "AccountDeletionRequirementsResponse",
    "DeleteAccountRequest",
    "UserDataExportResponse",
    "UserDataExportStatusResponse",
]
