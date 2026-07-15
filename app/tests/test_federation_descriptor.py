from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


def _descriptor(*, node_uid: str = "11111111-1111-4111-8111-111111111111"):
    from crate.federation.identity import build_signed_descriptor

    private_key = Ed25519PrivateKey.from_private_bytes(b"\x01" * 32)
    return build_signed_descriptor(
        node_uid=node_uid,
        display_name="Peer",
        api_base_url="https://peer.example.test",
        listen_base_url="https://listen.example.test",
        active_key_id="key-a",
        public_keys=[
            {
                "key_id": "key-a",
                "algorithm": "ed25519",
                "public_key": private_key.public_key(),
                "status": "active",
            }
        ],
        capabilities={"catalog.search": True, "stream.proxy": True},
        private_key=private_key,
        now=NOW,
    )


def test_signed_descriptor_is_canonical_and_deterministic():
    from crate.federation.identity import canonical_descriptor_bytes

    first = _descriptor()
    second = _descriptor()

    assert first == second
    assert first["audience"] == "public"
    assert first["protocol_version"] == "v1"
    assert first["signature_profile"] == "crate-ed25519-v1"
    assert first["capabilities"] == ["catalog.search", "stream.proxy"]
    assert canonical_descriptor_bytes(first) == canonical_descriptor_bytes(second)


def test_descriptor_publishes_only_verified_taxonomy_metadata():
    from crate.federation.identity import build_signed_descriptor

    private_key = Ed25519PrivateKey.from_private_bytes(b"\x01" * 32)
    descriptor = build_signed_descriptor(
        node_uid="11111111-1111-4111-8111-111111111111",
        display_name="Peer",
        api_base_url="https://peer.example.test",
        listen_base_url=None,
        active_key_id="key-a",
        public_keys=[
            {
                "key_id": "key-a",
                "public_key": private_key.public_key(),
                "status": "active",
            }
        ],
        capabilities=[],
        private_key=private_key,
        now=NOW,
        taxonomy_release={
            "taxonomy_id": "crate-core",
            "version": "1.0.0",
            "digest": "sha256:abc",
            "key_id": "root-1",
            "signature": "signature",
        },
    )

    assert descriptor["taxonomy_release"]["key_id"] == "root-1"


def test_descriptor_verification_rejects_tampering_self_and_incompatible_version():
    from crate.federation.contracts import FederationErrorCode, FederationProtocolError
    from crate.federation.identity import verify_signed_descriptor

    descriptor = _descriptor()
    verified = verify_signed_descriptor(
        descriptor,
        local_node_uid="22222222-2222-4222-8222-222222222222",
        now=NOW,
    )
    assert verified.node_uid == descriptor["node_uid"]

    tampered = {**descriptor, "name": "Mallory"}
    with pytest.raises(FederationProtocolError) as invalid:
        verify_signed_descriptor(
            tampered,
            local_node_uid="22222222-2222-4222-8222-222222222222",
            now=NOW,
        )
    assert invalid.value.code == FederationErrorCode.INVALID_DESCRIPTOR

    with pytest.raises(FederationProtocolError) as self_peer:
        verify_signed_descriptor(
            descriptor,
            local_node_uid=descriptor["node_uid"],
            now=NOW,
        )
    assert self_peer.value.code == FederationErrorCode.SELF_PEER

    incompatible = {
        **descriptor,
        "federation_protocol_versions": ["v99"],
        "protocol_version": "v99",
    }
    with pytest.raises(FederationProtocolError) as version_error:
        verify_signed_descriptor(
            incompatible,
            local_node_uid="22222222-2222-4222-8222-222222222222",
            now=NOW,
        )
    assert version_error.value.code == FederationErrorCode.INCOMPATIBLE_VERSION


def test_descriptor_rejects_unknown_fields_and_expiration():
    from pydantic import ValidationError

    from crate.federation.contracts import FederationErrorCode, FederationProtocolError
    from crate.federation.identity import verify_signed_descriptor

    with pytest.raises(ValidationError):
        verify_signed_descriptor(
            {**_descriptor(), "unexpected": True},
            local_node_uid="22222222-2222-4222-8222-222222222222",
            now=NOW,
        )

    with pytest.raises(FederationProtocolError) as expired:
        verify_signed_descriptor(
            _descriptor(),
            local_node_uid="22222222-2222-4222-8222-222222222222",
            now=NOW + timedelta(minutes=6),
        )
    assert expired.value.code == FederationErrorCode.INVALID_DESCRIPTOR
