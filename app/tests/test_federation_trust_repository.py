from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


def test_key_state_transitions_are_explicit():
    from crate.db.repositories.federation_trust import validate_key_transition

    assert validate_key_transition("pending", "active") == "active"
    assert validate_key_transition("active", "retiring") == "retiring"
    assert validate_key_transition("retiring", "retired") == "retired"
    assert validate_key_transition("active", "revoked") == "revoked"

    with pytest.raises(ValueError, match="active -> pending"):
        validate_key_transition("active", "pending")


def test_descriptor_projection_exposes_only_current_verification_keys():
    from crate.db.repositories.federation_trust import project_public_keys

    now = datetime(2026, 7, 14, tzinfo=timezone.utc)
    keys = project_public_keys(
        [
            {
                "key_id": "active",
                "public_key": "pub-a",
                "status": "active",
                "not_before": now - timedelta(days=1),
                "not_after": None,
            },
            {
                "key_id": "overlap",
                "public_key": "pub-b",
                "status": "retiring",
                "not_before": now - timedelta(days=1),
                "not_after": now + timedelta(hours=1),
            },
            {
                "key_id": "expired",
                "public_key": "pub-c",
                "status": "retiring",
                "not_before": now - timedelta(days=2),
                "not_after": now - timedelta(seconds=1),
            },
            {
                "key_id": "pending-overlap",
                "public_key": "pub-pending",
                "status": "pending",
                "not_before": now + timedelta(minutes=5),
                "not_after": None,
            },
            {
                "key_id": "revoked",
                "public_key": "pub-d",
                "status": "revoked",
                "not_before": None,
                "not_after": None,
            },
        ],
        now=now,
    )

    assert [key["key_id"] for key in keys] == [
        "active",
        "overlap",
        "pending-overlap",
    ]
    assert keys[0]["algorithm"] == "ed25519"


def test_trust_repository_round_trip_and_pairing_expiry(pg_db):
    del pg_db
    from crate.db.repositories import federation as legacy_repo
    from crate.db.repositories import federation_trust as trust_repo

    node_uid = "11111111-1111-4111-8111-111111111111"
    legacy_repo.ensure_local_node(
        display_name="Local",
        api_base_url="https://local.example.test",
        active_key_id="active",
        private_key_ref="federation/keys/active.pem",
    )
    local = legacy_repo.get_local_node()
    assert local is not None

    trust_repo.upsert_local_key(
        node_uid=str(local["node_uid"]),
        key_id="active",
        public_key="pub-a",
        private_key_ref="federation/keys/active.pem",
        status="active",
    )
    trust_repo.upsert_peer_key(
        node_uid=node_uid,
        key_id="peer-a",
        public_key="pub-peer",
        status="active",
    )

    assert trust_repo.get_active_local_key()["key_id"] == "active"
    assert trust_repo.list_peer_public_keys(node_uid)[0]["key_id"] == "peer-a"

    pairing = trust_repo.create_pairing(
        remote_base_url="https://peer.example.test",
        direction="outbound",
        local_challenge="challenge",
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    assert pairing["state"] == "created"
    assert trust_repo.expire_pairings() == 1
    assert trust_repo.get_pairing(str(pairing["pairing_uid"]))["state"] == "expired"


def test_pairing_state_updates_are_compare_and_swap_and_idempotent(pg_db):
    del pg_db
    from crate.db.repositories import federation_trust as trust_repo

    pairing_uid = "33333333-3333-4333-8333-333333333333"
    created = trust_repo.create_pairing(
        pairing_uid=pairing_uid,
        remote_base_url="https://peer.example.test",
        remote_node_uid="11111111-1111-4111-8111-111111111111",
        direction="inbound",
        state="remote_pending",
        local_challenge="challenge-a",
        offer_json={"pairing_uid": pairing_uid},
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    replay = trust_repo.create_pairing(
        pairing_uid=pairing_uid,
        remote_base_url="https://attacker.example.test",
        direction="inbound",
        state="remote_pending",
        local_challenge="different",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    assert replay["remote_base_url"] == created["remote_base_url"]

    accepted = trust_repo.update_pairing(
        pairing_uid,
        expected_states={"remote_pending"},
        state="accepted",
        remote_challenge="challenge-b",
        acceptance_json={"status": "accepted"},
    )
    assert accepted["state"] == "accepted"

    with pytest.raises(ValueError, match="state changed"):
        trust_repo.update_pairing(
            pairing_uid,
            expected_states={"remote_pending"},
            state="rejected",
        )


def test_bootstrap_registers_the_generated_key_in_normalized_storage(monkeypatch):
    from crate.federation import bootstrap

    calls: list[dict] = []
    node = {
        "node_uid": "11111111-1111-4111-8111-111111111111",
        "active_key_id": "key-a",
    }
    monkeypatch.setattr(bootstrap.repo, "get_local_node", lambda: None)
    monkeypatch.setattr(bootstrap.repo, "ensure_local_node", lambda **kwargs: node)
    monkeypatch.setattr(
        bootstrap.repo, "update_local_node", lambda *args, **kwargs: node
    )
    monkeypatch.setattr(bootstrap, "ensure_keys_dir", lambda: None)
    monkeypatch.setattr(bootstrap, "generate_key_id", lambda: "key-a")
    monkeypatch.setattr(
        bootstrap,
        "generate_ed25519_key_pair",
        lambda: (object(), object()),
    )
    monkeypatch.setattr(bootstrap, "store_private_key", lambda *args: None)
    monkeypatch.setattr(bootstrap, "public_key_to_base64", lambda key: "pub-a")

    def capture_key(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(
        bootstrap,
        "trust_repo",
        type("TrustRepo", (), {"upsert_local_key": staticmethod(capture_key)})(),
        raising=False,
    )

    bootstrap.bootstrap_federation_identity(
        display_name="Local",
        api_base_url="https://local.example.test",
    )

    assert calls == [
        {
            "node_uid": node["node_uid"],
            "key_id": "key-a",
            "public_key": "pub-a",
            "private_key_ref": "federation/keys/key-a.pem",
            "status": "active",
        }
    ]


def test_public_descriptor_reads_normalized_key_projection(monkeypatch):
    from starlette.requests import Request

    from crate.api import federation

    monkeypatch.setattr(
        federation.repo,
        "get_local_node",
        lambda: {
            "node_uid": "11111111-1111-4111-8111-111111111111",
            "display_name": "Local",
            "api_base_url": "https://local.example.test",
            "listen_base_url": None,
            "active_key_id": "key-a",
            "public_keys_json": [],
            "capabilities_json": {},
            "policy_json": {},
        },
    )
    monkeypatch.setattr(
        federation,
        "trust_repo",
        type(
            "TrustRepo",
            (),
            {
                "get_active_local_key": lambda self: {
                    "key_id": "key-a",
                    "private_key_ref": "federation/keys/key-a.pem",
                },
                "list_local_public_keys": lambda self: [
                    {
                        "key_id": "key-a",
                        "public_key": "pub-a",
                        "status": "active",
                    }
                ],
            },
        )(),
        raising=False,
    )
    monkeypatch.setattr(federation, "load_private_key", lambda key_id: object())
    monkeypatch.setattr(
        federation,
        "build_signed_descriptor",
        lambda **kwargs: {"public_keys": kwargs["public_keys"]},
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/.well-known/crate-node",
            "headers": [],
            "scheme": "https",
            "server": ("local.example.test", 443),
        }
    )

    descriptor = federation.get_descriptor(request)

    assert descriptor["public_keys"] == [
        {"key_id": "key-a", "public_key": "pub-a", "status": "active"}
    ]


def test_missing_normalized_signing_key_marks_health_degraded(monkeypatch):
    from crate.federation import key_verify

    monkeypatch.setattr(
        key_verify.repo,
        "get_local_node",
        lambda: {"node_uid": "11111111-1111-4111-8111-111111111111"},
    )
    monkeypatch.setattr(
        key_verify.trust_repo,
        "get_active_local_key",
        lambda: None,
    )

    assert key_verify.get_key_material_health() == {
        "status": "degraded",
        "reason": "active_key_record_missing",
    }
