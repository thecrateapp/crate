from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException


def test_api_capability_uses_persisted_grant_not_legacy_preset(monkeypatch):
    from crate.api import federation

    peer = {
        "node_uid": "11111111-1111-4111-8111-111111111111",
        "trust_state": "approved",
        "disabled_at": None,
        "default_grant_preset": "trusted_library",
    }
    monkeypatch.setattr(
        federation.repo,
        "get_peer_grants",
        lambda uid: [
            {
                "grant_uid": "22222222-2222-4222-8222-222222222222",
                "node_uid": uid,
                "subject_selector": f"peer_users:{uid}",
                "capabilities_json": ["catalog.search"],
                "constraints_json": {"max_results": 3},
                "constraints_version": 1,
                "policy_revision": 4,
                "priority": 0,
                "valid_from": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "valid_until": None,
                "revoked_at": None,
                "disabled_at": None,
            }
        ],
    )

    decision = federation._require_capability(peer, "catalog.search")
    assert decision.constraints.max_results == 3

    with pytest.raises(HTTPException) as denied:
        federation._require_capability(peer, "stream.proxy")
    assert denied.value.detail == "capability_denied"


def test_search_limit_is_clamped_before_serialization():
    from crate.federation.authorization import GrantConstraints
    from crate.federation.policy import apply_result_limit

    constraints = GrantConstraints(max_results=2)
    payload = {
        "artists": [{"name": "A"}, {"name": "B"}],
        "albums": [{"name": "C"}],
        "tracks": [{"title": "D"}],
    }

    limited = apply_result_limit(payload, requested_limit=50, constraints=constraints)

    assert sum(len(items) for items in limited.values()) == 2


def test_entity_allowlist_is_enforced_owner_side():
    from crate.federation.authorization import AuthorizationDecision, GrantConstraints
    from crate.federation.policy import entity_is_allowed

    decision = AuthorizationDecision(
        allowed=True,
        grant_uid=None,
        policy_revision=1,
        constraints=GrantConstraints(
            allowed_entity_types=["album"],
            allowed_entity_uids=["album-a"],
        ),
        denial_code=None,
    )

    assert entity_is_allowed(decision, entity_type="album", entity_uid="album-a")
    assert not entity_is_allowed(decision, entity_type="track", entity_uid="track-a")
    assert not entity_is_allowed(decision, entity_type="album", entity_uid="album-b")
