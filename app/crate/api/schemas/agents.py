"""Human integration management and exact-plan decision contracts."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AgentCollectionResponse(BaseModel):
    items: list[dict[str, Any]]
    next_cursor: str | None = None


class ClosedBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IntegrationCreate(ClosedBody):
    name: str = Field(min_length=1, max_length=120)
    grants: list[str] = Field(min_length=1, max_length=8)
    expires_in_days: int = Field(default=90, strict=True, ge=1, le=365)
    require_approval: bool = False


class IntegrationUpdate(ClosedBody):
    expected_policy_revision: int = Field(strict=True, ge=1)
    enabled: bool | None = None
    grants: list[str] | None = Field(default=None, min_length=1, max_length=8)
    require_approval: bool | None = None


class CredentialExpiry(ClosedBody):
    expires_in_days: int = Field(default=90, strict=True, ge=1, le=365)


class AgentCredentialSecretResponse(BaseModel):
    principal_id: str
    credential_id: str
    token: str
    expires_at: str
    policy_revision: int | None = None


class OAuthClientCreate(ClosedBody):
    client_id: str = Field(min_length=1, max_length=2048)
    name: str = Field(min_length=1, max_length=120)
    redirect_uris: list[str] = Field(min_length=1, max_length=20)
    scopes: list[str] = Field(min_length=1, max_length=8)
    metadata_url: str | None = Field(default=None, max_length=2048)


class OAuthClientUpdate(ClosedBody):
    client_id: str = Field(min_length=1, max_length=2048)
    enabled: bool | None = None
    scopes: list[str] | None = Field(default=None, min_length=1, max_length=8)


class PlanDecision(ClosedBody):
    plan_version: str = Field(pattern=r"^[a-f0-9]{64}$")
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    policy_revision: int = Field(strict=True, ge=1)
    authorization_context_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
