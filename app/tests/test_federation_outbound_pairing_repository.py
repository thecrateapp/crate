from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest

LOCAL = "11111111-1111-4111-8111-111111111111"
REMOTE = "22222222-2222-4222-8222-222222222222"
PAIRING = "33333333-3333-4333-8333-333333333333"


def _offered_pairing(*, consent_at=None):
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust

    repo.upsert_peer(REMOTE, "Remote", "https://remote.example.test", "initial-key")
    consent = {"verified_at": consent_at} if consent_at is not None else {}
    trust.create_pairing(
        pairing_uid=PAIRING,
        remote_base_url="https://remote.example.test",
        remote_node_uid=REMOTE,
        direction="outbound",
        state="offered",
        local_challenge="offer-challenge",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
        offer_json={
            "pairing_uid": PAIRING,
            "source_node_uid": LOCAL,
            "target_node_uid": REMOTE,
            "outbound_grant": "discovery",
        },
        **consent,
    )
    return {
        "pairing_uid": PAIRING,
        "source_node_uid": REMOTE,
        "target_node_uid": LOCAL,
        "challenge": "accepted-challenge",
        "signature": "already-verified-signature",
        "source_descriptor": {
            "node_uid": REMOTE,
            "name": "Verified remote",
            "api_base_url": "https://remote.example.test",
            "listen_base_url": None,
            "active_key_id": "remote-key",
            "public_keys": [
                {
                    "key_id": "remote-key",
                    "public_key": "verified-public-key",
                    "status": "active",
                    "not_before": None,
                    "not_after": None,
                }
            ],
            "capabilities": ["catalog.search"],
        },
    }


def _finish(acceptance, **kwargs):
    from crate.db.repositories.federation_pairing_approval import (
        complete_outbound_pairing,
    )

    return complete_outbound_pairing(
        PAIRING,
        acceptance=acceptance,
        preset="discovery",
        capabilities=["catalog.search"],
        constraints={"max_results": 10},
        **kwargs,
    )


def test_exact_completed_replay_preserves_disabled_peer_off_grant_and_revoked_key(
    pg_db,
):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust

    acceptance = _offered_pairing()
    _finish(acceptance)
    repo.update_peer(REMOTE, default_grant_preset="off", disabled_at=datetime.now(UTC))
    grant = repo.upsert_peer_grant(
        REMOTE,
        f"peer_users:{REMOTE}",
        preset="off",
        capabilities_json=[],
        constraints_json={},
    )
    trust.upsert_peer_key(
        node_uid=REMOTE,
        key_id="remote-key",
        public_key="verified-public-key",
        status="revoked",
    )
    _finish(acceptance)
    assert repo.get_peer(REMOTE)["default_grant_preset"] == "off"
    assert repo.get_peer(REMOTE)["disabled_at"] is not None
    assert (
        repo.get_peer_grants(REMOTE)[0]["policy_revision"] == grant["policy_revision"]
    )
    assert repo.get_peer_grants(REMOTE)[0]["preset"] == "off"
    assert trust.list_peer_public_keys(REMOTE) == []


def test_completed_pairing_rejects_different_acceptance_without_policy_writes(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo

    acceptance = _offered_pairing()
    _finish(acceptance)
    changed = deepcopy(acceptance)
    changed["challenge"] = "different-challenge"
    with pytest.raises(ValueError, match="differs"):
        _finish(changed)
    assert repo.get_peer_grants(REMOTE)[0]["policy_revision"] == 1


def test_concurrent_identical_acceptances_apply_grant_only_once(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust

    acceptance = _offered_pairing()
    gate = Barrier(2)

    def submit(_):
        gate.wait(timeout=10)
        return _finish(acceptance)["state"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(submit, range(2))) == ["completed", "completed"]
    assert repo.get_peer_grants(REMOTE)[0]["policy_revision"] == 1
    assert len(trust.list_peer_public_keys(REMOTE)) == 1


def test_first_acceptance_rolls_back_keys_peer_grant_and_pairing_on_failure(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust
    from crate.db.tx import transaction_scope

    acceptance = _offered_pairing()
    with (
        pytest.raises(RuntimeError, match="audit unavailable"),
        transaction_scope() as session,
    ):

        class RejectAudit:
            def execute(self, statement, *args, **kwargs):
                if "INSERT INTO federation_audit_events" in str(statement):
                    raise RuntimeError("audit unavailable")
                return session.execute(statement, *args, **kwargs)

        _finish(acceptance, session=RejectAudit())
    assert trust.get_pairing(PAIRING)["state"] == "offered"
    assert repo.get_peer(REMOTE)["trust_state"] == "pending"
    assert repo.get_peer(REMOTE)["active_key_id"] == "initial-key"
    assert repo.get_peer_grants(REMOTE) == []
    assert trust.list_peer_public_keys(REMOTE) == []


@pytest.mark.parametrize("disabled", [True, False])
def test_first_acceptance_cannot_override_owner_policy_changes(pg_db, disabled):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust

    acceptance = _offered_pairing()
    if disabled:
        repo.update_peer(REMOTE, disabled_at=datetime.now(UTC))
    else:
        repo.update_peer(REMOTE, default_grant_preset="off")
    with pytest.raises(ValueError, match="disabled|grant changed"):
        _finish(acceptance)
    assert trust.get_pairing(PAIRING)["state"] == "offered"
    assert repo.get_peer_grants(REMOTE) == []
    assert trust.list_peer_public_keys(REMOTE) == []


def test_first_acceptance_preserves_newer_same_preset_constraints(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust

    acceptance = _offered_pairing()
    newer_grant = repo.upsert_peer_grant(
        REMOTE,
        f"peer_users:{REMOTE}",
        preset="discovery",
        capabilities_json=["catalog.search"],
        constraints_json={"max_results": 3},
    )
    with pytest.raises(ValueError, match="grant changed"):
        _finish(acceptance)
    assert repo.get_peer_grants(REMOTE) == [newer_grant]
    assert trust.get_pairing(PAIRING)["state"] == "offered"
    assert repo.get_peer(REMOTE)["trust_state"] == "pending"
    assert trust.list_peer_public_keys(REMOTE) == []


def test_offer_consent_precedes_persistence_and_preserves_policy_edits_during_probe(
    pg_db,
):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust

    consent_at = datetime.now(UTC)
    newer_grant = repo.upsert_peer_grant(
        REMOTE,
        f"peer_users:{REMOTE}",
        preset="discovery",
        capabilities_json=["catalog.search"],
        constraints_json={"max_results": 3},
    )
    acceptance = _offered_pairing(consent_at=consent_at)
    pairing = trust.get_pairing(PAIRING)
    assert pairing["verified_at"] == consent_at
    assert consent_at < newer_grant["created_at"] < pairing["created_at"]
    with pytest.raises(ValueError, match="grant changed"):
        _finish(acceptance)
    assert repo.get_peer_grants(REMOTE) == [newer_grant]


def test_initial_outbound_consent_can_replace_older_policy_after_health_refresh(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo

    repo.upsert_peer_grant(
        REMOTE,
        f"peer_users:{REMOTE}",
        preset="discovery",
        capabilities_json=["catalog.search"],
        constraints_json={"max_results": 3},
    )
    acceptance = _offered_pairing(consent_at=datetime.now(UTC))
    repo.update_peer(REMOTE, health_json={"ok": True}, last_seen_at=datetime.now(UTC))
    assert _finish(acceptance)["state"] == "completed"
    assert repo.get_peer_grants(REMOTE)[0]["constraints_json"] == {"max_results": 10}
