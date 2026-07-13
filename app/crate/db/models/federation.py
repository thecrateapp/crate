"""Pydantic output models for federation tables."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FederationLocalNode(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_uid: str
    display_name: str
    public_base_url: str | None = None
    api_base_url: str | None = None
    listen_base_url: str | None = None
    active_key_id: str
    public_keys_json: list[dict] = []
    private_key_ref: str
    capabilities_json: dict = {}
    policy_json: dict = {}
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FederationNode(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_uid: str
    display_name: str
    api_base_url: str
    listen_base_url: str | None = None
    active_key_id: str
    public_keys_json: list[dict] = []
    trust_state: str = "pending"
    direction: str = "outbound"
    scopes_json: list[str] = []
    default_grant_preset: str = "discovery"
    capabilities_json: dict = {}
    policy_json: dict = {}
    health_json: dict = {}
    last_health_at: datetime | None = None
    last_seen_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    disabled_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FederationPairingRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_uid: str
    remote_node_uid: str | None = None
    remote_base_url: str
    remote_public_key: str | None = None
    challenge: str
    status: str = "pending"
    requested_scopes_json: list[str] = []
    granted_scopes_json: list[str] = []
    expires_at: datetime
    completed_at: datetime | None = None
    created_at: datetime | None = None


class FederationPeerGrant(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_uid: str
    principal_selector: str
    preset: str = "discovery"
    capabilities_json: list[str] = []
    constraints_json: dict = {}
    resource_policy_json: dict = {}
    priority: int = 0
    expires_at: datetime | None = None
    disabled_at: datetime | None = None
    created_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FederationRemoteSubject(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_uid: str
    subject_hash: str
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    last_roles_json: list[str] = []
    quota_overrides_json: dict = {}
    stats_json: dict = {}
    blocked_at: datetime | None = None
    blocked_reason: str | None = None


class FederationAuditEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_uid: str | None = None
    event_type: str
    actor_user_id: int | None = None
    request_id: str | None = None
    status: str
    metadata_json: dict = {}
    created_at: datetime | None = None


class FederationStatus(BaseModel):
    enabled: bool
    local_node: FederationLocalNode | None = None
    peer_count: int = 0
    approved_peer_count: int = 0
    pending_pairing_count: int = 0
