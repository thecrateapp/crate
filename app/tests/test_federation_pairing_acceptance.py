from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException

LOCAL = "11111111-1111-4111-8111-111111111111"
REMOTE = "22222222-2222-4222-8222-222222222222"
PAIRING = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def acceptance_case(monkeypatch):
    from crate.api import federation as api
    from crate.api.schemas.federation import PairingAcceptanceV1
    from crate.federation.identity import build_signed_descriptor
    from crate.federation.pairing import build_acceptance, build_offer, verify_offer

    identities = []
    for uid, host, seed in [(LOCAL, "local", 1), (REMOTE, "remote", 2)]:
        key = Ed25519PrivateKey.from_private_bytes(bytes([seed]) * 32)
        descriptor = build_signed_descriptor(
            node_uid=uid,
            display_name=host,
            api_base_url=f"https://{host}.example.test",
            listen_base_url=None,
            active_key_id=f"key-{host}",
            public_keys=[
                {
                    "key_id": f"key-{host}",
                    "public_key": key.public_key(),
                    "status": "active",
                }
            ],
            capabilities={"catalog.search": True},
            private_key=key,
        )
        identities.append((key, descriptor))
    (local_key, local), (remote_key, remote) = identities
    offer = build_offer(
        pairing_uid=PAIRING,
        source_descriptor=local,
        target_descriptor=remote,
        challenge="offer-challenge",
        private_key=local_key,
        outbound_grant="discovery",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    verified_offer = verify_offer(offer, local_descriptor=remote)

    def accepted(challenge="acceptance-challenge"):
        return PairingAcceptanceV1.model_validate(
            build_acceptance(
                offer=verified_offer,
                source_descriptor=remote,
                challenge=challenge,
                private_key=remote_key,
                outbound_grant="listen",
            )
        )

    body = accepted()
    row = {
        "pairing_uid": PAIRING,
        "remote_node_uid": REMOTE,
        "direction": "outbound",
        "state": "completed",
        "offer_json": offer,
        "acceptance_json": body.model_dump(mode="json"),
    }
    monkeypatch.setattr(api.trust_repo, "get_pairing", lambda uid: deepcopy(row))
    monkeypatch.setattr(api, "_build_local_descriptor", lambda request: local)
    monkeypatch.setattr(
        api.trust_repo, "get_active_local_key", lambda: {"key_id": "key-local"}
    )
    monkeypatch.setattr(api, "load_private_key", lambda key_id: local_key)
    for owner, name in [
        (api.trust_repo, "upsert_peer_key"),
        (api.trust_repo, "update_pairing"),
        (api.repo, "upsert_peer"),
        (api.repo, "upsert_peer_grant"),
    ]:
        monkeypatch.setattr(owner, name, Mock())

    def finalize(uid, *, acceptance, preset, capabilities, constraints):
        if row["state"] == "completed" and row["acceptance_json"] != acceptance:
            raise ValueError(
                "Completed pairing acceptance differs from the stored envelope"
            )
        return deepcopy(row)

    finalized = Mock(side_effect=finalize)
    monkeypatch.setattr(api, "complete_outbound_pairing", finalized, raising=False)
    return api, body, row, finalized, accepted, local


def test_completed_acceptance_replay_only_returns_a_verified_ack(acceptance_case):
    from crate.federation.pairing import verify_ack

    api, body, _, finalized, _, local = acceptance_case
    ack = api.pairing_accept(body, None)
    verify_ack(
        ack,
        pairing_acceptance=body.model_dump(mode="json"),
        local_descriptor=body.source_descriptor.model_dump(mode="json"),
    )
    finalized.assert_called_once()
    api.trust_repo.upsert_peer_key.assert_not_called()
    api.trust_repo.update_pairing.assert_not_called()
    api.repo.upsert_peer.assert_not_called()
    api.repo.upsert_peer_grant.assert_not_called()
    assert ack["source_node_uid"] == local["node_uid"]


def test_completed_acceptance_rejects_a_different_signed_envelope(acceptance_case):
    api, _, _, _, accepted, _ = acceptance_case
    with pytest.raises(HTTPException) as error:
        api.pairing_accept(accepted("different-but-validly-signed"), None)
    assert error.value.status_code == 409
    api.trust_repo.upsert_peer_key.assert_not_called()
    api.repo.upsert_peer_grant.assert_not_called()


def test_unavailable_ack_signing_key_cannot_commit_pairing_trust(
    acceptance_case, monkeypatch
):
    api, body, row, finalized, _, _ = acceptance_case
    row["state"] = "offered"
    row["acceptance_json"] = {}
    monkeypatch.setattr(api.trust_repo, "get_active_local_key", lambda: None)
    with pytest.raises(HTTPException) as error:
        api.pairing_accept(body, None)
    assert error.value.status_code == 503
    finalized.assert_not_called()
    api.repo.upsert_peer.assert_not_called()
