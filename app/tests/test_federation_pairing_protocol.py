from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)
NODE_A = "11111111-1111-4111-8111-111111111111"
NODE_B = "22222222-2222-4222-8222-222222222222"


def _identity(
    node_uid: str,
    host: str,
    seed: int,
    *,
    now: datetime = NOW,
):
    from crate.federation.identity import build_signed_descriptor

    private_key = Ed25519PrivateKey.from_private_bytes(bytes([seed]) * 32)
    descriptor = build_signed_descriptor(
        node_uid=node_uid,
        display_name=host,
        api_base_url=f"https://{host}.example.test",
        listen_base_url=None,
        active_key_id=f"key-{host}",
        public_keys=[
            {
                "key_id": f"key-{host}",
                "public_key": private_key.public_key(),
                "status": "active",
            }
        ],
        capabilities={"catalog.search": True},
        private_key=private_key,
        now=now,
    )
    return private_key, descriptor


def test_bilateral_pairing_challenge_response_happy_path():
    from crate.federation.pairing import (
        build_acceptance,
        build_ack,
        build_offer,
        verify_acceptance,
        verify_ack,
        verify_offer,
    )

    key_a, descriptor_a = _identity(NODE_A, "node-a", 1)
    key_b, descriptor_b = _identity(NODE_B, "node-b", 2)
    offer = build_offer(
        source_descriptor=descriptor_a,
        target_descriptor=descriptor_b,
        challenge="challenge-a",
        private_key=key_a,
        expires_at=NOW + timedelta(minutes=10),
        outbound_grant="trusted",
    )
    verified_offer = verify_offer(
        offer,
        local_descriptor=descriptor_b,
        now=NOW,
    )
    assert verified_offer.challenge == "challenge-a"

    acceptance = build_acceptance(
        offer=verified_offer,
        source_descriptor=descriptor_b,
        challenge="challenge-b",
        private_key=key_b,
        outbound_grant="discovery",
        now=NOW,
    )
    verified_acceptance = verify_acceptance(
        acceptance,
        pairing_offer=offer,
        local_descriptor=descriptor_a,
        now=NOW,
    )
    assert verified_acceptance.challenge_response == "challenge-a"
    assert verified_acceptance.outbound_grant == "discovery"

    ack = build_ack(
        acceptance=verified_acceptance,
        source_descriptor=descriptor_a,
        private_key=key_a,
        now=NOW,
    )
    verified_ack = verify_ack(
        ack,
        pairing_acceptance=acceptance,
        local_descriptor=descriptor_b,
        now=NOW,
    )
    assert verified_ack.challenge_response == "challenge-b"


def test_pairing_rejects_target_tampering_expiry_and_replay():
    from crate.federation.contracts import FederationErrorCode, FederationProtocolError
    from crate.federation.pairing import PairingReplayGuard, build_offer, verify_offer

    key_a, descriptor_a = _identity(NODE_A, "node-a", 1)
    _, descriptor_b = _identity(NODE_B, "node-b", 2)
    offer = build_offer(
        source_descriptor=descriptor_a,
        target_descriptor=descriptor_b,
        challenge="challenge-a",
        private_key=key_a,
        expires_at=NOW + timedelta(minutes=10),
    )

    with pytest.raises(FederationProtocolError) as target_error:
        verify_offer(
            {**offer, "target_node_uid": NODE_A},
            local_descriptor=descriptor_b,
            now=NOW,
        )
    assert target_error.value.code == FederationErrorCode.INVALID_DESCRIPTOR

    with pytest.raises(FederationProtocolError) as expired:
        verify_offer(
            offer,
            local_descriptor=descriptor_b,
            now=NOW + timedelta(minutes=11),
        )
    assert expired.value.code == FederationErrorCode.INVALID_DESCRIPTOR

    guard = PairingReplayGuard()
    guard.consume(offer["pairing_uid"])
    with pytest.raises(FederationProtocolError) as replay:
        guard.consume(offer["pairing_uid"])
    assert replay.value.code == FederationErrorCode.REPLAY


def test_pairing_rejects_incompatible_descriptor_before_acceptance():
    from crate.federation.contracts import FederationErrorCode, FederationProtocolError
    from crate.federation.pairing import build_offer, verify_offer

    key_a, descriptor_a = _identity(NODE_A, "node-a", 1)
    _, descriptor_b = _identity(NODE_B, "node-b", 2)
    descriptor_a = {
        **descriptor_a,
        "protocol_version": "v99",
        "federation_protocol_versions": ["v99"],
    }
    offer = build_offer(
        source_descriptor=descriptor_a,
        target_descriptor=descriptor_b,
        challenge="challenge-a",
        private_key=key_a,
        expires_at=NOW + timedelta(minutes=10),
    )

    with pytest.raises(FederationProtocolError) as error:
        verify_offer(offer, local_descriptor=descriptor_b, now=NOW)
    assert error.value.code == FederationErrorCode.INCOMPATIBLE_VERSION


def test_public_offer_endpoint_never_autoapproves(monkeypatch):
    from starlette.requests import Request

    from crate.api import federation
    from crate.api.schemas.federation import PairingOfferV1
    from crate.federation.pairing import build_offer

    current_time = datetime.now(timezone.utc)
    key_a, descriptor_a = _identity(NODE_A, "node-a", 1, now=current_time)
    _, descriptor_b = _identity(NODE_B, "node-b", 2, now=current_time)
    offer = build_offer(
        source_descriptor=descriptor_a,
        target_descriptor=descriptor_b,
        challenge="challenge-a",
        private_key=key_a,
        expires_at=current_time + timedelta(minutes=10),
    )
    peer_writes: list[dict] = []
    pairing_writes: list[dict] = []
    monkeypatch.setattr(
        federation, "_build_local_descriptor", lambda request: descriptor_b
    )
    monkeypatch.setattr(federation.trust_repo, "get_pairing", lambda uid: None)
    monkeypatch.setattr(
        federation.trust_repo,
        "create_pairing",
        lambda **kwargs: pairing_writes.append(kwargs) or kwargs,
    )
    monkeypatch.setattr(
        federation.trust_repo, "upsert_peer_key", lambda **kwargs: kwargs
    )
    monkeypatch.setattr(
        federation.repo,
        "upsert_peer",
        lambda **kwargs: peer_writes.append(kwargs) or kwargs,
    )
    monkeypatch.setattr(
        federation,
        "FederationURLPolicy",
        lambda: type("Policy", (), {"validate_base_url": lambda self, url: url})(),
    )

    response = federation.pairing_offer(
        PairingOfferV1.model_validate(offer),
        Request({"type": "http", "method": "POST", "path": "/"}),
    )

    assert response["status"] == "remote_pending"
    assert pairing_writes[0]["state"] == "remote_pending"
    assert peer_writes[0]["trust_state"] == "pending"
