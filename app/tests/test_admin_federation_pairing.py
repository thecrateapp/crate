from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException

LOCAL = "11111111-1111-4111-8111-111111111111"
REMOTE = "22222222-2222-4222-8222-222222222222"
PAIRING = "33333333-3333-4333-8333-333333333333"


def _identity(node_uid, host, seed):
    from crate.federation.identity import build_signed_descriptor

    key = Ed25519PrivateKey.from_private_bytes(bytes([seed]) * 32)
    return key, build_signed_descriptor(
        node_uid=node_uid,
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


@pytest.fixture
def approval(monkeypatch):
    from crate.api import admin_federation as api
    from crate.api import federation
    from crate.federation.pairing import build_ack, build_offer, verify_acceptance

    local_key, local = _identity(LOCAL, "local", 1)
    remote_key, remote = _identity(REMOTE, "remote", 2)
    now = datetime.now(UTC)
    offer = build_offer(
        pairing_uid=PAIRING,
        source_descriptor=remote,
        target_descriptor=local,
        challenge="original-offer-challenge",
        private_key=remote_key,
        expires_at=now + timedelta(minutes=10),
        outbound_grant="listen",
    )
    row = {
        "pairing_uid": PAIRING,
        "remote_node_uid": REMOTE,
        "remote_base_url": "https://remote.example.test",
        "direction": "inbound",
        "state": "remote_pending",
        "offer_json": offer,
        "acceptance_json": {},
        "expires_at": now + timedelta(minutes=10),
    }
    sent = []
    persisted = []
    finalizations = []
    state = {"grant": None}
    monkeypatch.setattr(api, "_require_nodes_manage", lambda request: None)
    monkeypatch.setattr(api.repo, "get_local_node", lambda: {"node_uid": LOCAL})
    monkeypatch.setattr(
        api.repo,
        "get_peer",
        lambda uid: {"trust_state": "pending", "disabled_at": None},
    )
    monkeypatch.setattr(api.trust_repo, "get_pairing", lambda uid: deepcopy(row))
    monkeypatch.setattr(
        api.trust_repo, "get_active_local_key", lambda: {"key_id": "key-local"}
    )
    monkeypatch.setattr(federation, "_build_local_descriptor", lambda request: local)
    monkeypatch.setattr(api, "load_private_key", lambda key_id: local_key)

    def update(uid, *, expected_states, **fields):
        assert row["state"] in expected_states
        persisted.append(deepcopy(fields))
        row.update(deepcopy(fields))
        return deepcopy(row)

    def finish(uid, *, preset, capabilities, constraints):
        finalizations.append(preset)
        row["state"] = "completed"
        state["grant"] = preset
        return deepcopy(row)

    def remote_response(base_url, path, acceptance):
        assert base_url == "https://remote.example.test"
        assert path == "/api/federation/v1/pairing/acceptances"
        sent.append(deepcopy(acceptance))
        verified = verify_acceptance(
            acceptance, pairing_offer=offer, local_descriptor=remote
        )
        ack = build_ack(
            acceptance=verified, source_descriptor=remote, private_key=remote_key
        )
        return httpx.Response(200, json=ack, request=httpx.Request("POST", base_url))

    monkeypatch.setattr(api.trust_repo, "update_pairing", update)
    monkeypatch.setattr(api, "complete_inbound_pairing", finish, raising=False)
    monkeypatch.setattr(
        api, "check_inbound_pairing_policy", lambda uid: None, raising=False
    )
    monkeypatch.setattr(api, "safe_post_json", remote_response)
    monkeypatch.setattr(api.repo, "update_peer", Mock())
    monkeypatch.setattr(api.repo, "upsert_peer_grant", Mock())
    monkeypatch.setattr(api.repo, "record_audit_event", Mock())
    return api, row, sent, persisted, finalizations, state, remote_response


def test_approval_timeout_can_resume_exact_signed_acceptance_and_original_grant(
    approval, monkeypatch
):
    api, row, sent, persisted, finalized, state, remote_response = approval

    def timeout(base_url, path, acceptance):
        sent.append(deepcopy(acceptance))
        raise httpx.ReadTimeout("peer timed out")

    monkeypatch.setattr(api, "safe_post_json", timeout)
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(
            PAIRING, None, api.PairingApprovalBody(outbound_grant="listen")
        )
    assert error.value.status_code == 502
    assert row["state"] == "accepted"
    assert not finalized
    original_acceptance = deepcopy(row["acceptance_json"])
    monkeypatch.setattr(api, "safe_post_json", remote_response)
    monkeypatch.setattr(
        api, "build_acceptance", Mock(side_effect=AssertionError("resigned"))
    )
    result = api.approve_pairing(PAIRING, None)
    assert result["state"] == "completed"
    assert sent == [original_acceptance, original_acceptance]
    assert len(persisted) == 1
    assert finalized == ["listen"]
    assert state["grant"] == "listen"


def test_outbound_consent_timestamp_precedes_the_remote_probe(monkeypatch):
    from crate.api import admin_federation as api
    from crate.api import federation

    local_key, local = _identity(LOCAL, "local", 1)
    _, remote = _identity(REMOTE, "remote", 2)
    probes = []

    def probe(*args, **kwargs):
        probes.append(datetime.now(UTC))
        return remote

    monkeypatch.setattr(api, "_require_nodes_manage", lambda request: None)
    monkeypatch.setattr(api.repo, "get_local_node", lambda: {"node_uid": LOCAL})
    monkeypatch.setattr(api, "fetch_descriptor", probe)
    monkeypatch.setattr(federation, "_build_local_descriptor", lambda request: local)
    monkeypatch.setattr(
        api.trust_repo, "get_active_local_key", lambda: {"key_id": "key-local"}
    )
    monkeypatch.setattr(api, "load_private_key", lambda key_id: local_key)
    create_pairing = Mock(return_value={"pairing_uid": PAIRING})
    monkeypatch.setattr(api.trust_repo, "create_pairing", create_pairing)
    monkeypatch.setattr(api.trust_repo, "upsert_peer_key", Mock())
    monkeypatch.setattr(
        api.repo, "upsert_peer", Mock(return_value={"node_uid": REMOTE})
    )
    monkeypatch.setattr(api.repo, "record_audit_event", Mock())
    monkeypatch.setattr(
        api,
        "safe_post_json",
        lambda *args: httpx.Response(
            202, request=httpx.Request("POST", "https://remote.example.test")
        ),
    )
    api.start_pairing(
        api.PairingStartBody(
            url="https://remote.example.test", outbound_grant="listen"
        ),
        None,
    )
    assert create_pairing.call_args.kwargs["verified_at"] <= probes[0]


def test_completed_retry_does_not_change_a_later_grant_upgrade(approval, monkeypatch):
    api, _, sent, persisted, finalized, state, _ = approval
    api.approve_pairing(PAIRING, None)
    state["grant"] = "listen"
    counts = len(sent), len(persisted), len(finalized)
    monkeypatch.setattr(
        api, "safe_post_json", Mock(side_effect=AssertionError("callback"))
    )
    assert api.approve_pairing(PAIRING, None)["state"] == "completed"
    assert state["grant"] == "listen"
    assert (len(sent), len(persisted), len(finalized)) == counts


def test_initial_consent_timestamp_precedes_the_owner_policy_read(
    approval, monkeypatch
):
    api, _, _, persisted, _, _, _ = approval
    policy_reads = []

    def get_peer(uid):
        policy_reads.append(datetime.now(UTC))
        return {"trust_state": "pending", "disabled_at": None}

    monkeypatch.setattr(api.repo, "get_peer", get_peer)
    api.approve_pairing(PAIRING, None)
    assert persisted[0]["verified_at"] <= policy_reads[0]


@pytest.mark.parametrize("new_owner_preset", ["off", "catalog"])
def test_new_owner_policy_blocks_accepted_retry_before_callback(
    approval, monkeypatch, new_owner_preset
):
    api, row, sent, persisted, finalized, _, remote_response = approval
    monkeypatch.setattr(
        api,
        "safe_post_json",
        Mock(side_effect=httpx.ReadTimeout("lost acknowledgement")),
    )
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(
            PAIRING, None, api.PairingApprovalBody(outbound_grant="listen")
        )
    assert error.value.status_code == 502
    accepted = deepcopy(row)
    callback_count = len(sent)
    write_count = len(persisted)
    monkeypatch.setattr(api, "safe_post_json", remote_response)
    monkeypatch.setattr(
        api.repo,
        "get_peer",
        lambda uid: {
            "trust_state": "pending",
            "disabled_at": None,
            "default_grant_preset": new_owner_preset,
        },
    )
    monkeypatch.setattr(
        api,
        "check_inbound_pairing_policy",
        Mock(
            side_effect=ValueError(
                "Peer grant changed after acceptance; start a new pairing"
            )
        ),
    )
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(PAIRING, None)
    assert error.value.status_code == 409
    assert "grant changed" in error.value.detail
    assert row == accepted
    assert len(sent) == callback_count and len(persisted) == write_count
    assert not finalized


@pytest.mark.parametrize("pairing_state", ["remote_pending", "accepted"])
def test_expired_approval_rejected_before_writes_or_callback(approval, pairing_state):
    api, row, sent, persisted, finalized, _, _ = approval
    row["state"] = pairing_state
    row["expires_at"] = datetime.now(UTC) - timedelta(seconds=1)
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(PAIRING, None)
    assert error.value.status_code == 410
    assert not sent and not persisted and not finalized


def test_outbound_pairing_cannot_be_approved_locally(approval):
    api, row, sent, persisted, finalized, _, _ = approval
    row["direction"] = "outbound"
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(PAIRING, None)
    assert error.value.status_code == 400
    assert not sent and not persisted and not finalized


def test_disabled_peer_cannot_be_approved_or_contacted(approval, monkeypatch):
    api, _, sent, persisted, finalized, _, _ = approval
    monkeypatch.setattr(
        api.repo,
        "get_peer",
        lambda uid: {
            "trust_state": "pending",
            "disabled_at": datetime.now(UTC),
        },
    )
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(PAIRING, None)
    assert error.value.status_code == 409
    assert not sent and not persisted and not finalized


def test_invalid_ack_never_approves_local_peer(approval, monkeypatch):
    api, row, _, _, finalized, _, response = approval

    def wrong_ack(*args):
        valid = response(*args)
        payload = valid.json()
        payload["challenge_response"] = "another-challenge"
        return httpx.Response(200, json=payload, request=valid.request)

    monkeypatch.setattr(api, "safe_post_json", wrong_ack)
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(PAIRING, None)
    assert error.value.status_code == 502
    assert row["state"] == "accepted"
    assert not finalized
    api.repo.update_peer.assert_not_called()


def test_cloudflare_challenge_has_actionable_error_without_echoing_html(
    approval, monkeypatch
):
    api, row, _, _, finalized, _, _ = approval
    monkeypatch.setattr(
        api,
        "safe_post_json",
        lambda *args: httpx.Response(
            403,
            headers={"cf-mitigated": "challenge", "Content-Type": "text/html"},
            text="<html>private challenge payload</html>",
            request=httpx.Request("POST", "https://remote.example.test"),
        ),
    )
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(PAIRING, None)
    assert error.value.status_code == 502
    assert "Cloudflare" in error.value.detail
    assert "private challenge payload" not in error.value.detail
    assert row["state"] == "accepted" and not finalized


def test_approval_rejects_offer_identity_different_from_stored_peer(approval):
    api, row, sent, persisted, finalized, _, _ = approval
    row["remote_node_uid"] = LOCAL
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(PAIRING, None)
    assert error.value.status_code == 400
    assert not sent and not persisted and not finalized


def test_retry_cannot_replace_an_already_signed_grant(approval, monkeypatch):
    api, row, _, persisted, finalized, _, _ = approval
    monkeypatch.setattr(
        api, "safe_post_json", Mock(side_effect=httpx.ReadTimeout("retry"))
    )
    with pytest.raises(HTTPException):
        api.approve_pairing(
            PAIRING, None, api.PairingApprovalBody(outbound_grant="listen")
        )
    original = deepcopy(row["acceptance_json"])
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(
            PAIRING, None, api.PairingApprovalBody(outbound_grant="discovery")
        )
    assert error.value.status_code == 409
    assert row["acceptance_json"] == original
    assert len(persisted) == 1 and not finalized


def test_status_exposes_safe_pairing_ids_and_counts_only_live_requests(monkeypatch):
    from crate.api import admin_federation as api

    now = datetime.now(UTC)
    pairings = [
        {
            "pairing_uid": PAIRING,
            "remote_node_uid": REMOTE,
            "direction": "inbound",
            "state": "accepted",
            "expires_at": now + timedelta(minutes=1),
            "offer_json": {"secret": "challenge"},
        },
        {
            "pairing_uid": "expired",
            "remote_node_uid": LOCAL,
            "direction": "inbound",
            "state": "remote_pending",
            "expires_at": now - timedelta(seconds=1),
        },
        {
            "pairing_uid": "done",
            "remote_node_uid": LOCAL,
            "direction": "outbound",
            "state": "completed",
            "expires_at": now + timedelta(minutes=1),
        },
    ]
    monkeypatch.setattr(api, "_require_nodes_view", lambda request: None)
    monkeypatch.setattr(api.repo, "get_local_node", lambda: None)
    monkeypatch.setattr(
        api.repo, "list_peers", lambda: [{"trust_state": "pending"}] * 2
    )
    monkeypatch.setattr(api, "get_key_material_health", dict)
    lookup = Mock(return_value=pairings)
    monkeypatch.setattr(api, "list_latest_pairings", lookup, raising=False)
    result = api.get_status(None)
    assert result["pending_pairing_count"] == 1
    assert result["pairings"][0] == {
        k: pairings[0][k]
        for k in ("pairing_uid", "remote_node_uid", "direction", "state", "expires_at")
    }
    assert all(
        set(p) == {"pairing_uid", "remote_node_uid", "direction", "state", "expires_at"}
        for p in result["pairings"]
    )
    lookup.assert_called_once()


def test_latest_terminal_pairing_shadows_an_older_outbound_request(monkeypatch):
    from crate.api import admin_federation as api

    expiry = datetime.now(UTC) + timedelta(minutes=10)
    rows = [
        {
            "pairing_uid": PAIRING,
            "remote_node_uid": REMOTE,
            "direction": "inbound",
            "state": "completed",
            "expires_at": expiry,
        },
        {
            "pairing_uid": "older",
            "remote_node_uid": REMOTE,
            "direction": "outbound",
            "state": "offered",
            "expires_at": expiry,
        },
    ]
    monkeypatch.setattr(api, "_require_nodes_view", lambda request: None)
    monkeypatch.setattr(api.repo, "get_local_node", lambda: None)
    monkeypatch.setattr(api.repo, "list_peers", lambda: [{"trust_state": "pending"}])
    monkeypatch.setattr(api, "get_key_material_health", dict)
    monkeypatch.setattr(api, "list_latest_pairings", lambda: rows)
    assert api.get_status(None)["pending_pairing_count"] == 0


def test_concurrent_initial_approval_returns_conflict_without_sending_new_envelope(
    approval, monkeypatch
):
    api, _, sent, _, finalized, _, _ = approval
    monkeypatch.setattr(
        api.trust_repo, "update_pairing", Mock(side_effect=ValueError("state changed"))
    )
    with pytest.raises(HTTPException) as error:
        api.approve_pairing(PAIRING, None)
    assert error.value.status_code == 409
    assert not sent and not finalized
