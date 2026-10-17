"""Public OAuth discovery responses; tokens are delivered only by the token endpoint."""

from typing import Literal

from pydantic import BaseModel, Field


class MCPProtectedResourceMetadata(BaseModel):
    resource: str
    authorization_servers: list[str]
    scopes_supported: list[str]
    bearer_methods_supported: list[str]


class MCPAuthorizationServerMetadata(BaseModel):
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    revocation_endpoint: str
    response_types_supported: list[str]
    grant_types_supported: list[str]
    token_endpoint_auth_methods_supported: list[str]
    revocation_endpoint_auth_methods_supported: list[str]
    code_challenge_methods_supported: list[str]
    scopes_supported: list[str]
    authorization_response_iss_parameter_supported: bool
    client_id_metadata_document_supported: bool


class MCPOAuthTokenResponse(BaseModel):
    token_type: Literal["Bearer"]
    access_token: str = Field(repr=False)
    refresh_token: str = Field(repr=False)
    expires_in: int
    scope: str


class MCPOAuthErrorResponse(BaseModel):
    error: str
    error_description: str | None = None
