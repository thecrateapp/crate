from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

REMOTE = "22222222-2222-4222-8222-222222222222"
PAIRING = "33333333-3333-4333-8333-333333333333"


def _accepted_pairing(preset="discovery"):
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust

    repo.upsert_peer(REMOTE, "Remote", "https://remote.example.test", "remote-key")
    trust.create_pairing(
        pairing_uid=PAIRING,
        remote_base_url="https://remote.example.test",
        remote_node_uid=REMOTE,
        direction="inbound",
        state="accepted",
        local_challenge="offer-challenge",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    trust.update_pairing(
        PAIRING,
        expected_states={"accepted"},
        acceptance_json={"outbound_grant": preset},
        verified_at=datetime.now(UTC),
    )


def test_finalize_is_atomic_and_completed_retry_preserves_later_grants(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories.federation_pairing_approval import (
        complete_inbound_pairing,
    )

    _accepted_pairing()
    completed = complete_inbound_pairing(
        PAIRING,
        preset="discovery",
        capabilities=["catalog.search"],
        constraints={"max_results": 10},
    )
    assert completed["state"] == "completed"
    assert repo.get_peer(REMOTE)["trust_state"] == "approved"
    assert repo.get_peer_grants(REMOTE)[0]["preset"] == "discovery"

    repo.update_peer(REMOTE, default_grant_preset="listen")
    repo.upsert_peer_grant(
        REMOTE,
        f"peer_users:{REMOTE}",
        preset="listen",
        capabilities_json=["stream.proxy"],
    )
    complete_inbound_pairing(
        PAIRING, preset="discovery", capabilities=["catalog.search"], constraints={}
    )
    assert repo.get_peer(REMOTE)["default_grant_preset"] == "listen"
    assert repo.get_peer_grants(REMOTE)[0]["preset"] == "listen"


def test_audit_failure_rolls_back_peer_grant_and_pairing_together(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust
    from crate.db.repositories.federation_pairing_approval import (
        complete_inbound_pairing,
    )
    from crate.db.tx import transaction_scope

    _accepted_pairing()
    with (
        pytest.raises(RuntimeError, match="audit unavailable"),
        transaction_scope() as session,
    ):

        class RejectAudit:
            def execute(self, statement, *args, **kwargs):
                if "INSERT INTO federation_audit_events" in str(statement):
                    raise RuntimeError("audit unavailable")
                return session.execute(statement, *args, **kwargs)

        complete_inbound_pairing(
            PAIRING,
            preset="discovery",
            capabilities=["catalog.search"],
            constraints={},
            session=RejectAudit(),
        )
    assert trust.get_pairing(PAIRING)["state"] == "accepted"
    assert repo.get_peer(REMOTE)["trust_state"] == "pending"
    assert repo.get_peer_grants(REMOTE) == []


def test_finalize_cannot_activate_a_disabled_peer(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust
    from crate.db.repositories.federation_pairing_approval import (
        complete_inbound_pairing,
    )

    _accepted_pairing()
    repo.update_peer(REMOTE, disabled_at=datetime.now(UTC))
    with pytest.raises(ValueError, match="disabled"):
        complete_inbound_pairing(
            PAIRING, preset="discovery", capabilities=["catalog.search"], constraints={}
        )
    assert trust.get_pairing(PAIRING)["state"] == "accepted"
    assert repo.get_peer_grants(REMOTE) == []


@pytest.mark.parametrize("owner_change", ["off", "catalog", "constraints"])
def test_new_owner_policy_blocks_accepted_retry_without_overwriting_it(
    pg_db, owner_change
):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust
    from crate.db.repositories.federation_pairing_approval import (
        check_inbound_pairing_policy,
        complete_inbound_pairing,
    )

    _accepted_pairing()
    check_inbound_pairing_policy(PAIRING)
    if owner_change == "off":
        # The preset endpoint writes the peer before its separate grant write.
        repo.update_peer(REMOTE, default_grant_preset="off")
    else:
        preset = "catalog" if owner_change == "catalog" else "discovery"
        repo.update_peer(REMOTE, default_grant_preset=preset)
        repo.upsert_peer_grant(
            REMOTE,
            f"peer_users:{REMOTE}",
            preset=preset,
            capabilities_json=["catalog.search"],
            constraints_json={"max_results": 3},
        )
    peer_before = repo.get_peer(REMOTE)
    grants_before = repo.get_peer_grants(REMOTE)
    with pytest.raises(ValueError, match="grant changed"):
        check_inbound_pairing_policy(PAIRING)
    with pytest.raises(ValueError, match="grant changed"):
        complete_inbound_pairing(
            PAIRING, preset="discovery", capabilities=["catalog.search"], constraints={}
        )
    assert repo.get_peer(REMOTE) == peer_before
    assert repo.get_peer_grants(REMOTE) == grants_before
    assert trust.get_pairing(PAIRING)["state"] == "accepted"


@pytest.mark.parametrize("preset", ["listen", "off"])
def test_initial_consent_and_peer_health_refresh_do_not_look_like_policy_changes(
    pg_db, preset
):
    del pg_db
    from crate.db.repositories import federation as repo
    from crate.db.repositories import federation_trust as trust
    from crate.db.repositories.federation_pairing_approval import (
        complete_inbound_pairing,
    )

    _accepted_pairing(preset=preset)
    repo.upsert_peer_grant(
        REMOTE,
        f"peer_users:{REMOTE}",
        preset="discovery",
        capabilities_json=["catalog.search"],
    )
    trust.update_pairing(
        PAIRING, expected_states={"accepted"}, verified_at=datetime.now(UTC)
    )
    # Discovery is the initial default, even when the operator approves Listen.
    assert repo.get_peer(REMOTE)["default_grant_preset"] == "discovery"
    if preset == "off":
        repo.update_peer(REMOTE, default_grant_preset="off")
    repo.update_peer(REMOTE, health_json={"ok": True}, last_seen_at=datetime.now(UTC))
    completed = complete_inbound_pairing(
        PAIRING, preset=preset, capabilities=[], constraints={}
    )
    assert completed["state"] == "completed"
    assert repo.get_peer_grants(REMOTE)[0]["preset"] == preset


def test_latest_pairings_are_safe_batched_ordered_and_never_fall_back(pg_db):
    del pg_db
    from crate.db.queries.federation_pairings import list_latest_pairings
    from crate.db.repositories import federation_trust as trust

    expiry = datetime.now(UTC) + timedelta(minutes=10)
    for uid, direction, state in [
        (PAIRING, "inbound", "remote_pending"),
        ("44444444-4444-4444-8444-444444444444", "inbound", "completed"),
        ("55555555-5555-4555-8555-555555555555", "outbound", "offered"),
    ]:
        trust.create_pairing(
            pairing_uid=uid,
            remote_base_url="https://remote.example.test",
            remote_node_uid=REMOTE,
            direction=direction,
            state=state,
            local_challenge="not-public",
            expires_at=expiry,
            offer_json={"not-public": "signed-envelope"},
        )
    rows = list_latest_pairings()
    assert [str(row["pairing_uid"]) for row in rows] == [
        "55555555-5555-4555-8555-555555555555",
        "44444444-4444-4444-8444-444444444444",
    ]
    assert all(
        set(row)
        == {"pairing_uid", "remote_node_uid", "direction", "state", "expires_at"}
        for row in rows
    )
    assert len(list_latest_pairings(limit=1)) == 1
