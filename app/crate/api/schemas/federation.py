from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from crate.federation.contracts import NodeDescriptorV1


class PairingEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pairing_uid: str
    source_node_uid: str
    target_node_uid: str
    source_descriptor: NodeDescriptorV1
    expires_at: datetime
    key_id: str
    signature: str


class PairingOfferV1(PairingEnvelope):
    kind: Literal["pairing_offer"] = "pairing_offer"
    target_descriptor: NodeDescriptorV1
    target_descriptor_digest: str
    challenge: str
    outbound_grant: str = "discovery"


class PairingAcceptanceV1(PairingEnvelope):
    kind: Literal["pairing_acceptance"] = "pairing_acceptance"
    challenge_response: str
    challenge: str
    outbound_grant: str = "discovery"


class PairingAckV1(PairingEnvelope):
    kind: Literal["pairing_ack"] = "pairing_ack"
    challenge_response: str


class FederatedPlaybackPrepareBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requesting_node_uid: UUID
    delivery_policy: Literal["balanced", "data_saver"]
    remote_entity_uids: list[UUID] = Field(min_length=1, max_length=2)


class FederatedPlaybackPrepareItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remote_entity_uid: UUID
    status: Literal["ready", "preparing", "unavailable", "rate_limited"]


class FederatedPlaybackPrepareResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[FederatedPlaybackPrepareItem] = Field(default_factory=list)
