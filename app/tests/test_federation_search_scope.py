"""The owner's /search honours the grant and the node catalog scope (FED2)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from crate.federation.results_envelope import RESULTS_CONTRACT

OWNER_UID = "00000000-0000-0000-0000-00000000000b"
REQUESTER_UID = "00000000-0000-0000-0000-00000000000a"


def _rows():
    return {
        "artists": [{"entity_uid": "artist-1", "name": "Joy Division"}],
        "albums": [
            {"entity_uid": "album-a", "name": "A", "artist": "Joy Division"},
            {"entity_uid": "album-b", "name": "B", "artist": "Joy Division"},
        ],
        "tracks": [{"entity_uid": "track-1", "title": "Disorder"}],
    }


def _constraints(types=(), uids=()):
    return SimpleNamespace(
        allowed_entity_types=frozenset(types),
        allowed_entity_uids=frozenset(uids),
        max_results=None,
    )


@pytest.fixture
def owner(monkeypatch):
    from crate.api import federation as federation_api

    state = {"constraints": None, "policy": {}}
    peer = {"node_uid": REQUESTER_UID, "display_name": "Home"}

    async def signed(_request, body_bytes=None):
        del body_bytes
        return peer

    monkeypatch.setattr(federation_api, "_require_signed_node_request", signed)
    monkeypatch.setattr(
        federation_api, "_require_user_assertion", lambda *a: {"sub": "subject-hash"}
    )
    monkeypatch.setattr(
        federation_api,
        "_require_capability",
        lambda *a, **k: SimpleNamespace(constraints=state["constraints"]),
    )
    monkeypatch.setattr(federation_api, "_require_search_quota", lambda *a: None)
    monkeypatch.setattr(federation_api, "catalog_share_policy", lambda: state["policy"])
    monkeypatch.setattr(federation_api, "handle_remote_search", lambda **kw: _rows())
    monkeypatch.setattr(
        federation_api.repo,
        "get_local_node",
        lambda: {"node_uid": OWNER_UID, "display_name": "Les Pedants"},
    )
    federation_api.state = state
    return federation_api


def _search(federation_api, **body):
    payload = federation_api.SearchBody(**{"q": "joy", "limit": 20, **body})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(redis=None)))
    return asyncio.run(federation_api.federated_search(payload, request))


def test_search_drops_entities_outside_grant_uids(owner):
    owner.state["constraints"] = _constraints(uids=["album-a"])

    result = _search(owner)

    assert [a["entity_uid"] for a in result["albums"]] == ["album-a"]


def test_search_drops_denied_entities(owner):
    owner.state["policy"] = {"catalog_filter": {"deny_entity_uids": ["album-b"]}}

    plain = _search(owner)
    envelope = _search(owner, contracts=[RESULTS_CONTRACT])

    assert [a["entity_uid"] for a in plain["albums"]] == ["album-a"]
    uids = [item["remote_entity_uid"] for item in envelope["items"]]
    assert "album-b" not in uids
    assert "album-a" in uids


def test_search_drops_disallowed_entity_types(owner):
    owner.state["constraints"] = _constraints(types=["track"])

    result = _search(owner)

    assert result["artists"] == []
    assert result["albums"] == []
    assert [t["entity_uid"] for t in result["tracks"]] == ["track-1"]


def test_truncated_stays_true_when_scope_drops_rows_of_a_capped_search(owner):
    owner.state["policy"] = {"catalog_filter": {"deny_entity_uids": ["album-b"]}}

    result = _search(owner, contracts=[RESULTS_CONTRACT], limit=2)

    assert "album-b" not in [i["remote_entity_uid"] for i in result["items"]]
    assert result["coverage"]["truncated"] is True


def test_truncated_is_false_when_nothing_was_capped_or_dropped(owner):
    result = _search(owner, contracts=[RESULTS_CONTRACT], limit=20)

    assert result["coverage"]["truncated"] is False
