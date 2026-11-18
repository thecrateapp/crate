from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from crate.federation import catalog_scope

NOW = datetime(2026, 11, 18, tzinfo=UTC)
PEER_UID = "11111111-1111-4111-8111-111111111111"


def _peer(**overrides):
    return {
        "node_uid": PEER_UID,
        "trust_state": "approved",
        "disabled_at": None,
        **overrides,
    }


def _grant(**overrides):
    return {
        "grant_uid": "22222222-2222-4222-8222-222222222222",
        "node_uid": PEER_UID,
        "subject_selector": f"peer_users:{PEER_UID}",
        "capabilities_json": ["catalog.search"],
        "constraints_json": {},
        "constraints_version": 1,
        "policy_revision": 3,
        "priority": 0,
        "valid_from": datetime(2026, 1, 1, tzinfo=UTC),
        "valid_until": None,
        "revoked_at": None,
        "disabled_at": None,
        **overrides,
    }


def _patch_node(monkeypatch, policy):
    monkeypatch.setattr(
        catalog_scope.repo, "get_local_node", lambda: {"policy_json": policy}
    )


def test_scope_digest_matches_delta_cursor(monkeypatch):
    from crate.api import federation
    from crate.federation.catalog import decode_catalog_cursor, encode_catalog_cursor

    async def peer(_request):
        return {"node_uid": "peer-a"}

    policy = {"catalog_filter": {"deny_entity_uids": ["x"]}}
    monkeypatch.setenv(
        "CRATE_FEDERATION_CURSOR_SECRET", "test-secret-at-least-32-bytes-long"
    )
    monkeypatch.setattr(federation, "_require_signed_node_request", peer)
    monkeypatch.setattr(federation, "_require_capability", lambda *_args: None)
    monkeypatch.setattr(federation, "_peer_has_capability", lambda *_args: False)
    monkeypatch.setattr(federation, "catalog_share_policy", lambda: policy)
    monkeypatch.setattr(federation, "catalog_retention_floor", lambda: 0)
    monkeypatch.setattr(federation, "catalog_high_water_mark", lambda: 5)
    monkeypatch.setattr(federation, "list_catalog_changes", lambda **_kwargs: [])
    cursor = encode_catalog_cursor(
        peer_uid="peer-a", mode="delta", position={"sequence": 1}
    )

    response = asyncio.run(federation.catalog_delta(object(), cursor=cursor, limit=10))

    decoded = decode_catalog_cursor(response["next_cursor"], peer_uid="peer-a")
    expected = catalog_scope.catalog_scope_digest(
        catalog_scope.catalog_policy_for_grant(policy, None, include_genres=False)
    )
    assert decoded["position"]["policy_digest"] == expected


def test_peer_search_policy_none_when_denied(monkeypatch):
    _patch_node(monkeypatch, {})
    monkeypatch.setattr(catalog_scope.repo, "get_peer_grants", lambda _uid: [_grant()])

    assert catalog_scope.peer_search_policy(_peer(trust_state="pending")) is None

    _patch_node(monkeypatch, {"catalog_filter": {"share_scope": "favorites"}})
    assert catalog_scope.peer_search_policy(_peer()) is None


def test_peer_search_policy_carries_grant_scope(monkeypatch):
    _patch_node(monkeypatch, {})
    monkeypatch.setattr(
        catalog_scope.repo,
        "get_peer_grants",
        lambda _uid: [_grant(constraints_json={"allowed_entity_types": ["album"]})],
    )

    policy = catalog_scope.peer_search_policy(_peer())

    assert policy is not None
    assert policy["_grant_scope"]["allowed_entity_types"] == ["album"]


# --- background checks never record risk observations (I7) -----------------


def _record_risk(monkeypatch) -> list[dict]:
    from crate.federation import abuse

    seen: list[dict] = []
    monkeypatch.setattr(
        abuse, "observe_risk_signal", lambda *args, **kwargs: seen.append(kwargs)
    )
    return seen


def test_peer_search_policy_records_no_risk_observation(monkeypatch):
    seen = _record_risk(monkeypatch)
    _patch_node(monkeypatch, {})
    monkeypatch.setattr(
        catalog_scope.repo,
        "get_peer_grants",
        lambda _uid: [_grant(capabilities_json=["catalog.sync"])],
    )

    assert catalog_scope.peer_search_policy(_peer()) is None
    assert catalog_scope.peer_search_policy(_peer(trust_state="pending")) is None
    assert seen == []


def test_authorize_still_records_denials_by_default(monkeypatch):
    from crate.federation.authorization import authorize

    seen = _record_risk(monkeypatch)

    decision = authorize(
        peer=_peer(),
        grants=[_grant(capabilities_json=["catalog.sync"])],
        capability="catalog.search",
        subject_hash=None,
        roles=set(),
    )

    assert not decision.allowed and decision.denial_code == "capability_denied"
    assert [s["reason_code"] for s in seen] == ["capability_denied"]


def test_authorize_without_observation_keeps_the_decision(monkeypatch):
    from crate.federation.authorization import authorize

    seen = _record_risk(monkeypatch)
    kwargs = {
        "peer": _peer(),
        "grants": [_grant(capabilities_json=["catalog.sync"])],
        "capability": "catalog.search",
        "subject_hash": None,
        "roles": set(),
    }

    observed = authorize(**kwargs)
    seen.clear()
    quiet = authorize(**kwargs, observe=False)

    assert quiet == observed
    assert seen == []
