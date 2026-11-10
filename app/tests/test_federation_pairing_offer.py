from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


@pytest.mark.parametrize("earliest_deadline", ["offer", "source", "target"])
def test_received_offer_stores_effective_deadline_without_changing_signed_payload(
    monkeypatch, earliest_deadline
):
    from crate.api import federation as api
    from crate.api.schemas.federation import PairingOfferV1
    from crate.federation.identity import build_signed_descriptor
    from crate.federation.pairing import _sign_envelope, build_offer

    now = datetime.now(UTC)
    identities = []
    for name, seed, uid in [
        ("source", 1, "11111111-1111-4111-8111-111111111111"),
        ("target", 2, "22222222-2222-4222-8222-222222222222"),
    ]:
        key = Ed25519PrivateKey.from_private_bytes(bytes([seed]) * 32)
        descriptor = build_signed_descriptor(
            node_uid=uid,
            display_name=name,
            api_base_url=f"https://{name}.example.test",
            listen_base_url=None,
            active_key_id=f"key-{name}",
            public_keys=[
                {
                    "key_id": f"key-{name}",
                    "public_key": key.public_key(),
                    "status": "active",
                }
            ],
            capabilities={"catalog.search": True},
            private_key=key,
            now=now - timedelta(minutes=1) if earliest_deadline == name else now,
        )
        identities.append((key, descriptor))
    (source_key, source), (_, target) = identities
    offer = build_offer(
        source_descriptor=source,
        target_descriptor=target,
        challenge="offer-challenge",
        private_key=source_key,
        expires_at=now + timedelta(minutes=10),
    )
    # Reproduce an old signed envelope whose 10-minute TTL exceeded descriptor TTLs.
    signed_offer = _sign_envelope(
        {
            **offer,
            "expires_at": now
            + timedelta(minutes=3 if earliest_deadline == "offer" else 10),
        },
        model=PairingOfferV1,
        private_key=source_key,
    )
    body = PairingOfferV1.model_validate(signed_offer)
    monkeypatch.setattr(api, "_build_local_descriptor", lambda request: target)
    monkeypatch.setattr(
        api, "FederationURLPolicy", lambda: SimpleNamespace(validate_base_url=Mock())
    )
    monkeypatch.setattr(api.trust_repo, "get_pairing", lambda uid: None)
    persist = Mock()
    monkeypatch.setattr(api.trust_repo, "create_pairing", persist)
    monkeypatch.setattr(api.trust_repo, "upsert_peer_key", Mock())
    monkeypatch.setattr(api.repo, "upsert_peer", Mock())

    assert api.pairing_offer(body, None)["status"] == "remote_pending"
    assert persist.call_args.kwargs["expires_at"] == min(
        body.expires_at,
        body.source_descriptor.expires_at,
        body.target_descriptor.expires_at,
    )
    assert persist.call_args.kwargs["offer_json"] == signed_offer
