"""Signed bilateral pairing envelopes and challenge-response validation."""

from __future__ import annotations

import base64
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import TypeVar

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from pydantic import BaseModel

from crate.api.schemas.federation import (
    PairingAcceptanceV1,
    PairingAckV1,
    PairingEnvelope,
    PairingOfferV1,
)
from crate.federation.contracts import (
    FederationErrorCode,
    FederationProtocolError,
    NodeDescriptorV1,
)
from crate.federation.identity import verify_signed_descriptor


EnvelopeT = TypeVar("EnvelopeT", bound=PairingEnvelope)
PAIRING_TTL = timedelta(minutes=10)


def _canonical_envelope(payload: dict | BaseModel, model: type[EnvelopeT]) -> bytes:
    envelope = payload if isinstance(payload, model) else model.model_validate(payload)
    data = envelope.model_dump(mode="json", exclude={"signature"})
    return json.dumps(
        data,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def _sign_envelope(
    data: dict,
    *,
    model: type[EnvelopeT],
    private_key: Ed25519PrivateKey,
) -> dict:
    envelope = model.model_validate({**data, "signature": ""})
    signature = base64.b64encode(
        private_key.sign(_canonical_envelope(envelope, model))
    ).decode("ascii")
    return model.model_validate(
        {**envelope.model_dump(mode="json"), "signature": signature}
    ).model_dump(mode="json")


def _verification_key(descriptor: NodeDescriptorV1, key_id: str) -> Ed25519PublicKey:
    key = next(
        (
            candidate
            for candidate in descriptor.public_keys
            if candidate.key_id == key_id and candidate.status in {"active", "retiring"}
        ),
        None,
    )
    if key is None:
        raise FederationProtocolError(
            FederationErrorCode.UNKNOWN_KEY,
            "Pairing signing key is not published",
        )
    try:
        return Ed25519PublicKey.from_public_bytes(
            base64.b64decode(key.public_key, validate=True)
        )
    except ValueError as exc:
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Pairing public key is invalid",
        ) from exc


def _verify_envelope_signature(
    envelope: EnvelopeT,
    *,
    model: type[EnvelopeT],
    descriptor: NodeDescriptorV1,
) -> None:
    try:
        _verification_key(descriptor, envelope.key_id).verify(
            base64.b64decode(envelope.signature, validate=True),
            _canonical_envelope(envelope, model),
        )
    except (InvalidSignature, ValueError) as exc:
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Pairing envelope signature is invalid",
        ) from exc


def _verify_common(
    envelope: EnvelopeT,
    *,
    model: type[EnvelopeT],
    local_descriptor: dict,
    now: datetime,
) -> tuple[NodeDescriptorV1, NodeDescriptorV1]:
    local = NodeDescriptorV1.model_validate(local_descriptor)
    if envelope.target_node_uid != local.node_uid:
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Pairing envelope targets another node",
        )
    if envelope.expires_at < now:
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Pairing envelope expired",
        )
    source = verify_signed_descriptor(
        envelope.source_descriptor.model_dump(mode="json"),
        local_node_uid=local.node_uid,
        now=now,
    )
    if source.node_uid != envelope.source_node_uid:
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Pairing source identity does not match its descriptor",
        )
    _verify_envelope_signature(envelope, model=model, descriptor=source)
    return local, source


def build_offer(
    *,
    source_descriptor: dict,
    target_descriptor: dict,
    challenge: str,
    private_key: Ed25519PrivateKey,
    expires_at: datetime | None = None,
    outbound_grant: str = "discovery",
    pairing_uid: str | None = None,
) -> dict:
    source = NodeDescriptorV1.model_validate(source_descriptor)
    target = NodeDescriptorV1.model_validate(target_descriptor)
    return _sign_envelope(
        {
            "kind": "pairing_offer",
            "pairing_uid": pairing_uid or str(uuid.uuid4()),
            "source_node_uid": source.node_uid,
            "target_node_uid": target.node_uid,
            "source_descriptor": source,
            "target_descriptor": target,
            "target_descriptor_digest": target.descriptor_digest,
            "challenge": challenge,
            "outbound_grant": outbound_grant,
            "expires_at": expires_at or datetime.now(timezone.utc) + PAIRING_TTL,
            "key_id": source.active_key_id,
        },
        model=PairingOfferV1,
        private_key=private_key,
    )


def verify_offer(
    payload: dict,
    *,
    local_descriptor: dict,
    now: datetime | None = None,
) -> PairingOfferV1:
    current_time = now or datetime.now(timezone.utc)
    offer = PairingOfferV1.model_validate(payload)
    local, _ = _verify_common(
        offer,
        model=PairingOfferV1,
        local_descriptor=local_descriptor,
        now=current_time,
    )
    offered_target = verify_signed_descriptor(
        offer.target_descriptor.model_dump(mode="json"),
        local_node_uid="",
        now=current_time,
    )
    if offered_target.node_uid != local.node_uid or not secrets.compare_digest(
        offer.target_descriptor_digest,
        offered_target.descriptor_digest,
    ):
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Pairing target descriptor changed",
        )
    return offer


def build_acceptance(
    *,
    offer: PairingOfferV1,
    source_descriptor: dict,
    challenge: str,
    private_key: Ed25519PrivateKey,
    outbound_grant: str,
    now: datetime | None = None,
) -> dict:
    source = NodeDescriptorV1.model_validate(source_descriptor)
    return _sign_envelope(
        {
            "kind": "pairing_acceptance",
            "pairing_uid": offer.pairing_uid,
            "source_node_uid": source.node_uid,
            "target_node_uid": offer.source_node_uid,
            "source_descriptor": source,
            "challenge_response": offer.challenge,
            "challenge": challenge,
            "outbound_grant": outbound_grant,
            "expires_at": min(
                offer.expires_at,
                (now or datetime.now(timezone.utc)) + PAIRING_TTL,
            ),
            "key_id": source.active_key_id,
        },
        model=PairingAcceptanceV1,
        private_key=private_key,
    )


def verify_acceptance(
    payload: dict,
    *,
    pairing_offer: dict,
    local_descriptor: dict,
    now: datetime | None = None,
) -> PairingAcceptanceV1:
    current_time = now or datetime.now(timezone.utc)
    offer = PairingOfferV1.model_validate(pairing_offer)
    acceptance = PairingAcceptanceV1.model_validate(payload)
    _verify_common(
        acceptance,
        model=PairingAcceptanceV1,
        local_descriptor=local_descriptor,
        now=current_time,
    )
    if (
        acceptance.pairing_uid != offer.pairing_uid
        or acceptance.source_node_uid != offer.target_node_uid
        or acceptance.challenge_response != offer.challenge
    ):
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Pairing acceptance does not prove the original challenge",
        )
    return acceptance


def build_ack(
    *,
    acceptance: PairingAcceptanceV1,
    source_descriptor: dict,
    private_key: Ed25519PrivateKey,
    now: datetime | None = None,
) -> dict:
    source = NodeDescriptorV1.model_validate(source_descriptor)
    return _sign_envelope(
        {
            "kind": "pairing_ack",
            "pairing_uid": acceptance.pairing_uid,
            "source_node_uid": source.node_uid,
            "target_node_uid": acceptance.source_node_uid,
            "source_descriptor": source,
            "challenge_response": acceptance.challenge,
            "expires_at": min(
                acceptance.expires_at,
                (now or datetime.now(timezone.utc)) + PAIRING_TTL,
            ),
            "key_id": source.active_key_id,
        },
        model=PairingAckV1,
        private_key=private_key,
    )


def verify_ack(
    payload: dict,
    *,
    pairing_acceptance: dict,
    local_descriptor: dict,
    now: datetime | None = None,
) -> PairingAckV1:
    current_time = now or datetime.now(timezone.utc)
    acceptance = PairingAcceptanceV1.model_validate(pairing_acceptance)
    ack = PairingAckV1.model_validate(payload)
    _verify_common(
        ack,
        model=PairingAckV1,
        local_descriptor=local_descriptor,
        now=current_time,
    )
    if (
        ack.pairing_uid != acceptance.pairing_uid
        or ack.source_node_uid != acceptance.target_node_uid
        or ack.challenge_response != acceptance.challenge
    ):
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Pairing acknowledgement does not prove the remote challenge",
        )
    return ack


class PairingReplayGuard:
    def __init__(self) -> None:
        self._consumed: set[str] = set()

    def consume(self, pairing_uid: str) -> None:
        if pairing_uid in self._consumed:
            raise FederationProtocolError(
                FederationErrorCode.REPLAY,
                "Pairing envelope was already consumed",
            )
        self._consumed.add(pairing_uid)
