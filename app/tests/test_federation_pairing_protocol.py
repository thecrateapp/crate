from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from starlette.requests import Request

NOW = datetime(2026, 7, 14, 12, 0, tzinfo=UTC)
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


def _pairing_with_deadline(deadline):
    from crate.api.schemas.federation import PairingOfferV1
    from crate.federation.pairing import build_acceptance, build_offer

    key_a, descriptor_a = _identity(NODE_A, "node-a", 1)
    key_b, descriptor_b = _identity(NODE_B, "node-b", 2)
    offer = PairingOfferV1.model_validate(
        build_offer(
            source_descriptor=descriptor_a,
            target_descriptor=descriptor_b,
            challenge="challenge-a",
            private_key=key_a,
            expires_at=deadline,
        )
    )
    acceptance = build_acceptance(
        offer=offer,
        source_descriptor=descriptor_b,
        challenge="challenge-b",
        private_key=key_b,
        outbound_grant="discovery",
        now=NOW,
    )
    return key_a, descriptor_a, key_b, descriptor_b, offer, acceptance


@pytest.mark.parametrize(
    "offer_expiry",
    [NOW - timedelta(seconds=1), NOW + timedelta(minutes=5)],
    ids=["expired-offer", "live-offer"],
)
def test_signed_acceptance_cannot_extend_original_offer_deadline(offer_expiry):
    from crate.api.schemas.federation import PairingAcceptanceV1
    from crate.federation.contracts import FederationErrorCode, FederationProtocolError
    from crate.federation.pairing import _sign_envelope, verify_acceptance

    _, descriptor_a, key_b, _, offer, original_acceptance = _pairing_with_deadline(
        offer_expiry
    )
    # The target knows its signing key and can sign a response with a later
    # deadline. The verifier must enforce the original stored offer's deadline.
    acceptance = _sign_envelope(
        {**original_acceptance, "expires_at": NOW + timedelta(minutes=9)},
        model=PairingAcceptanceV1,
        private_key=key_b,
    )

    with pytest.raises(FederationProtocolError) as error:
        verify_acceptance(
            acceptance,
            pairing_offer=offer.model_dump(mode="json"),
            local_descriptor=descriptor_a,
            now=NOW,
        )

    assert error.value.code == FederationErrorCode.INVALID_DESCRIPTOR


@pytest.mark.parametrize(
    "acceptance_expiry",
    [NOW - timedelta(seconds=1), NOW + timedelta(minutes=5)],
    ids=["expired-acceptance", "live-acceptance"],
)
def test_signed_ack_cannot_extend_original_acceptance_deadline(acceptance_expiry):
    from crate.api.schemas.federation import PairingAcceptanceV1, PairingAckV1
    from crate.federation.contracts import FederationErrorCode, FederationProtocolError
    from crate.federation.pairing import _sign_envelope, build_ack, verify_ack

    key_a, descriptor_a, _, descriptor_b, _, acceptance = _pairing_with_deadline(
        acceptance_expiry
    )
    original_ack = build_ack(
        acceptance=PairingAcceptanceV1.model_validate(acceptance),
        source_descriptor=descriptor_a,
        private_key=key_a,
        now=NOW,
    )
    ack = _sign_envelope(
        {**original_ack, "expires_at": NOW + timedelta(minutes=9)},
        model=PairingAckV1,
        private_key=key_a,
    )

    with pytest.raises(FederationProtocolError) as error:
        verify_ack(
            ack,
            pairing_acceptance=acceptance,
            local_descriptor=descriptor_b,
            now=NOW,
        )

    assert error.value.code == FederationErrorCode.INVALID_DESCRIPTOR


@pytest.mark.parametrize(
    "check_time",
    [
        NOW,
        NOW + timedelta(minutes=5) - timedelta(microseconds=1),
        NOW + timedelta(minutes=5),
    ],
    ids=["initial", "before-deadline", "at-deadline"],
)
def test_pairing_retry_preserves_equal_parent_deadlines(check_time):
    from crate.api.schemas.federation import PairingAcceptanceV1
    from crate.federation.pairing import build_ack, verify_acceptance, verify_ack

    deadline = NOW + timedelta(minutes=5)
    key_a, descriptor_a, _, descriptor_b, offer, acceptance = _pairing_with_deadline(
        deadline
    )
    ack = build_ack(
        acceptance=PairingAcceptanceV1.model_validate(acceptance),
        source_descriptor=descriptor_a,
        private_key=key_a,
        now=NOW,
    )

    for _ in range(2):
        verified_acceptance = verify_acceptance(
            acceptance,
            pairing_offer=offer.model_dump(mode="json"),
            local_descriptor=descriptor_a,
            now=check_time,
        )
        verified_ack = verify_ack(
            ack,
            pairing_acceptance=acceptance,
            local_descriptor=descriptor_b,
            now=check_time,
        )
        assert verified_acceptance.expires_at == deadline
        assert verified_ack.expires_at == deadline


@pytest.mark.parametrize(
    ("source_age", "target_age", "requested_lifetime", "expected_lifetime"),
    [
        (120, 60, None, 180),
        (120, 60, 600, 180),
        (60, 120, 600, 180),
        (120, 60, 60, 60),
    ],
    ids=["default", "source-descriptor", "target-descriptor", "explicit-shorter"],
)
def test_offer_deadline_is_bounded_by_signed_descriptors(
    source_age, target_age, requested_lifetime, expected_lifetime
):
    from crate.federation.pairing import build_offer, verify_offer

    key_a, descriptor_a = _identity(
        NODE_A, "node-a", 1, now=NOW - timedelta(seconds=source_age)
    )
    _, descriptor_b = _identity(
        NODE_B, "node-b", 2, now=NOW - timedelta(seconds=target_age)
    )
    offer = build_offer(
        source_descriptor=descriptor_a,
        target_descriptor=descriptor_b,
        challenge="challenge-a",
        private_key=key_a,
        expires_at=(
            NOW + timedelta(seconds=requested_lifetime)
            if requested_lifetime is not None
            else None
        ),
    )
    deadline = NOW + timedelta(seconds=expected_lifetime)

    assert datetime.fromisoformat(offer["expires_at"]) == deadline
    assert (
        verify_offer(
            offer,
            local_descriptor=descriptor_b,
            now=deadline - timedelta(microseconds=1),
        ).expires_at
        == deadline
    )


@pytest.mark.parametrize("shortest", ["offer", "source", "target", "fresh"])
def test_acceptance_deadline_preserves_legacy_offer_descriptor_bounds(shortest):
    from crate.api.schemas.federation import PairingOfferV1
    from crate.federation.pairing import (
        _sign_envelope,
        build_acceptance,
        build_offer,
        verify_acceptance,
    )

    source_age = timedelta(minutes=3) if shortest == "source" else timedelta()
    target_age = timedelta(minutes=3) if shortest == "target" else timedelta()
    fresh_age = timedelta(minutes=3) if shortest == "fresh" else timedelta()
    key_a, descriptor_a = _identity(NODE_A, "node-a", 1, now=NOW - source_age)
    key_b, descriptor_b = _identity(NODE_B, "node-b", 2, now=NOW - target_age)
    _, fresh_descriptor_b = _identity(NODE_B, "node-b", 2, now=NOW - fresh_age)
    legacy_offer = build_offer(
        source_descriptor=descriptor_a,
        target_descriptor=descriptor_b,
        challenge="challenge-a",
        private_key=key_a,
    )
    # Older peers could sign ten-minute offers around five-minute descriptors.
    # The builder must honor those descriptor deadlines without editing the offer.
    legacy_offer = _sign_envelope(
        {
            **legacy_offer,
            "expires_at": NOW + timedelta(minutes=2 if shortest == "offer" else 10),
        },
        model=PairingOfferV1,
        private_key=key_a,
    )
    offer = PairingOfferV1.model_validate(legacy_offer)
    acceptance = build_acceptance(
        offer=offer,
        source_descriptor=fresh_descriptor_b,
        challenge="challenge-b",
        private_key=key_b,
        outbound_grant="discovery",
        now=NOW,
    )

    assert offer.model_dump(mode="json") == legacy_offer
    assert verify_acceptance(
        acceptance,
        pairing_offer=legacy_offer,
        local_descriptor=descriptor_a,
        now=NOW,
    ).expires_at == NOW + timedelta(minutes=2)


@pytest.mark.parametrize(
    "shortest", ["acceptance", "accepted-descriptor", "ack-descriptor"]
)
def test_ack_deadline_is_bounded_by_both_signed_descriptors(shortest):
    from crate.api.schemas.federation import PairingAcceptanceV1
    from crate.federation.pairing import _sign_envelope, build_ack, verify_ack

    key_a, descriptor_a, key_b, descriptor_b, _, acceptance = _pairing_with_deadline(
        NOW + timedelta(minutes=5)
    )
    if shortest == "accepted-descriptor":
        _, descriptor_b = _identity(NODE_B, "node-b", 2, now=NOW - timedelta(minutes=3))
    if shortest == "ack-descriptor":
        _, descriptor_a = _identity(NODE_A, "node-a", 1, now=NOW - timedelta(minutes=3))
    acceptance = _sign_envelope(
        {
            **acceptance,
            "source_descriptor": descriptor_b,
            "expires_at": NOW
            + timedelta(minutes=2 if shortest == "acceptance" else 10),
        },
        model=PairingAcceptanceV1,
        private_key=key_b,
    )
    ack = build_ack(
        acceptance=PairingAcceptanceV1.model_validate(acceptance),
        source_descriptor=descriptor_a,
        private_key=key_a,
        now=NOW,
    )

    assert verify_ack(
        ack,
        pairing_acceptance=acceptance,
        local_descriptor=descriptor_b,
        now=NOW,
    ).expires_at == NOW + timedelta(minutes=2)


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
    from crate.api import federation
    from crate.api.schemas.federation import PairingOfferV1
    from crate.federation.pairing import build_offer

    current_time = datetime.now(UTC)
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
