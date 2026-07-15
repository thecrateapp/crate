from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


def _peer(**overrides):
    return {
        "node_uid": "11111111-1111-4111-8111-111111111111",
        "trust_state": "approved",
        "disabled_at": None,
        **overrides,
    }


def _grant(**overrides):
    return {
        "grant_uid": "22222222-2222-4222-8222-222222222222",
        "node_uid": "11111111-1111-4111-8111-111111111111",
        "subject_selector": "peer_users:11111111-1111-4111-8111-111111111111",
        "capabilities_json": ["catalog.search"],
        "constraints_json": {"max_results": 10},
        "constraints_version": 1,
        "policy_revision": 3,
        "priority": 0,
        "valid_from": NOW - timedelta(minutes=1),
        "valid_until": None,
        "revoked_at": None,
        "disabled_at": None,
        **overrides,
    }


@pytest.mark.parametrize(
    ("peer", "grants", "capability", "expected_code"),
    [
        (
            _peer(trust_state="pending"),
            [_grant()],
            "catalog.search",
            "peer_not_approved",
        ),
        (_peer(disabled_at=NOW), [_grant()], "catalog.search", "peer_disabled"),
        (_peer(), [], "catalog.search", "no_matching_grant"),
        (_peer(), [_grant()], "stream.proxy", "capability_denied"),
        (
            _peer(),
            [_grant(revoked_at=NOW - timedelta(seconds=1))],
            "catalog.search",
            "no_matching_grant",
        ),
    ],
)
def test_authorization_denials_are_stable(peer, grants, capability, expected_code):
    from crate.federation.authorization import authorize

    decision = authorize(
        peer=peer,
        grants=grants,
        capability=capability,
        subject_hash="subject-a",
        roles={"listener"},
        now=NOW,
    )

    assert decision.allowed is False
    assert decision.denial_code == expected_code


def test_authorizer_selects_highest_priority_subject_grant_and_types_constraints():
    from crate.federation.authorization import authorize

    decision = authorize(
        peer=_peer(),
        grants=[
            _grant(priority=1, constraints_json={"max_results": 20}),
            _grant(
                grant_uid="33333333-3333-4333-8333-333333333333",
                subject_selector="subject:subject-a",
                priority=10,
                policy_revision=7,
                constraints_json={
                    "max_results": 5,
                    "allowed_entity_types": ["artist", "album"],
                    "delivery": ["balanced"],
                },
            ),
        ],
        capability="catalog.search",
        subject_hash="subject-a",
        roles={"listener"},
        now=NOW,
    )

    assert decision.allowed is True
    assert str(decision.grant_uid) == "33333333-3333-4333-8333-333333333333"
    assert decision.policy_revision == 7
    assert decision.constraints is not None
    assert decision.constraints.max_results == 5
    assert decision.constraints.allowed_entity_types == frozenset({"artist", "album"})


def test_custom_constraints_are_not_replaced_by_the_legacy_preset():
    from crate.federation.authorization import authorize

    decision = authorize(
        peer=_peer(default_grant_preset="trusted_library"),
        grants=[_grant(constraints_json={"max_results": 2})],
        capability="catalog.search",
        subject_hash="subject-a",
        roles=set(),
        now=NOW,
    )

    assert decision.allowed
    assert decision.constraints.max_results == 2


def test_unknown_constraint_is_rejected_instead_of_ignored():
    from crate.federation.authorization import authorize

    decision = authorize(
        peer=_peer(),
        grants=[_grant(constraints_json={"unknown_limit": 1})],
        capability="catalog.search",
        subject_hash="subject-a",
        roles=set(),
        now=NOW,
    )

    assert decision.allowed is False
    assert decision.denial_code == "invalid_constraints"


def test_grant_writes_increment_policy_revision(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo

    node_uid = "11111111-1111-4111-8111-111111111111"
    repo.upsert_peer(
        node_uid=node_uid,
        display_name="Peer",
        api_base_url="https://peer.example.test",
        active_key_id="peer-key",
        trust_state="approved",
    )
    first = repo.upsert_peer_grant(
        node_uid=node_uid,
        principal_selector=f"peer_users:{node_uid}",
        capabilities_json=["catalog.search"],
        constraints_json={"max_results": 10},
    )
    second = repo.upsert_peer_grant(
        node_uid=node_uid,
        principal_selector=f"peer_users:{node_uid}",
        capabilities_json=["catalog.search"],
        constraints_json={"max_results": 5},
    )

    assert first["policy_revision"] == 1
    assert second["policy_revision"] == 2
    assert second["subject_selector"] == f"peer_users:{node_uid}"


def test_upsert_peer_applies_pairing_state_transition(pg_db):
    del pg_db
    from crate.db.repositories import federation as repo

    node_uid = "22222222-2222-4222-8222-222222222222"
    repo.upsert_peer(
        node_uid=node_uid,
        display_name="Peer",
        api_base_url="https://peer.example.test",
        active_key_id="peer-key",
        trust_state="pending",
        direction="outbound",
        default_grant_preset="discovery",
    )

    updated = repo.upsert_peer(
        node_uid=node_uid,
        display_name="Peer",
        api_base_url="https://peer.example.test",
        active_key_id="peer-key",
        trust_state="approved",
        direction="outbound",
        default_grant_preset="trusted_library",
    )

    assert updated["trust_state"] == "approved"
    assert updated["direction"] == "outbound"
    assert updated["default_grant_preset"] == "trusted_library"
