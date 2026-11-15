"""The owner's /api/federation/v1/search: contract negotiation and quotas (FED1)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from crate.federation.results_envelope import RESULTS_CONTRACT

OWNER_UID = "00000000-0000-0000-0000-00000000000b"
REQUESTER_UID = "00000000-0000-0000-0000-00000000000a"

LOCAL_ROWS = {
    "artists": [
        {"id": 1, "entity_uid": "artist-uid", "slug": "x", "name": "Joy Division"}
    ],
    "albums": [],
    "tracks": [
        {
            "id": 2,
            "entity_uid": "track-uid",
            "title": "Disorder",
            "artist": "Joy Division",
            "album": "Unknown Pleasures",
            "path": "/music/x.flac",
            "duration": 209.5,
            "format": "flac",
        }
    ],
}


class _Redis:
    """Enough of redis for the sliding-window limiter."""

    def __init__(self) -> None:
        self.sets: dict[str, dict[str, float]] = {}

    def zremrangebyscore(self, key, low, high):
        members = self.sets.setdefault(key, {})
        for member, score in list(members.items()):
            if low <= score <= high:
                del members[member]

    def zcard(self, key):
        return len(self.sets.get(key, {}))

    def zadd(self, key, mapping):
        self.sets.setdefault(key, {}).update(mapping)

    def zrange(self, key, start, end, withscores=False):
        members = sorted(self.sets.get(key, {}).items(), key=lambda item: item[1])
        selected = members[start : end + 1]
        return selected if withscores else [member for member, _ in selected]

    def expire(self, key, seconds):
        return True


def _request(redis=None):
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(redis=redis or _Redis()))
    )


@pytest.fixture
def owner(monkeypatch):
    from crate.api import federation as federation_api

    peer = {"node_uid": REQUESTER_UID, "display_name": "Home"}
    decision = SimpleNamespace(constraints=None)

    async def signed(_request, body_bytes=None):
        del body_bytes
        return peer

    monkeypatch.setattr(federation_api, "_require_signed_node_request", signed)
    monkeypatch.setattr(
        federation_api,
        "_require_user_assertion",
        lambda *args: {"sub": "subject-hash"},
    )
    monkeypatch.setattr(federation_api, "_require_capability", lambda *a, **k: decision)
    monkeypatch.setattr(federation_api, "_catalog_share_policy", lambda: {})
    monkeypatch.setattr(federation_api, "handle_remote_search", lambda **kw: LOCAL_ROWS)
    monkeypatch.setattr(
        federation_api.repo,
        "get_local_node",
        lambda: {"node_uid": OWNER_UID, "display_name": "Les Pedants"},
    )
    return federation_api


def _search(federation_api, request=None, **body):
    payload = federation_api.SearchBody(**{"q": "joy division", "limit": 20, **body})
    return asyncio.run(federation_api.federated_search(payload, request or _request()))


def test_an_old_requester_gets_the_legacy_shape_without_paths(owner):
    result = _search(owner)

    assert set(result) == {"artists", "albums", "tracks"}
    assert result["tracks"][0]["title"] == "Disorder"
    assert "path" not in result["tracks"][0]
    assert "id" not in result["tracks"][0]


def test_a_requester_that_asks_for_the_envelope_gets_it(owner):
    result = _search(owner, contracts=[RESULTS_CONTRACT])

    assert result["contract"] == RESULTS_CONTRACT
    assert result["source"]["node_uid"] == OWNER_UID
    assert [item["remote_entity_uid"] for item in result["items"]] == [
        "artist-uid",
        "track-uid",
    ]
    assert result["coverage"] == {"complete": True, "truncated": False}
    assert "/music/" not in repr(result)


def test_unknown_contracts_fall_back_to_the_legacy_shape(owner):
    result = _search(owner, contracts=["crate.federation.results/9"])

    assert "contract" not in result
    assert result["artists"][0]["name"] == "Joy Division"


def test_a_full_page_is_marked_truncated(owner):
    result = _search(owner, contracts=[RESULTS_CONTRACT], limit=1)

    assert result["coverage"]["truncated"] is True
    assert len(result["items"]) == 1


def test_a_catalog_closed_to_live_search_answers_incomplete_not_empty(
    owner, monkeypatch
):
    monkeypatch.setattr(
        owner,
        "_catalog_share_policy",
        lambda: {"catalog_filter": {"share_scope": "selected"}},
    )

    result = _search(owner, contracts=[RESULTS_CONTRACT])

    assert result["items"] == []
    assert result["coverage"]["complete"] is False


class TestInboundQuota:
    def test_a_peer_over_its_quota_gets_429(self, owner, monkeypatch):
        from crate.federation import search as owner_search

        monkeypatch.setattr(owner_search, "INBOUND_SEARCH_PER_PEER_PER_MINUTE", 2)
        request = _request(_Redis())

        _search(owner, request)
        _search(owner, request)
        with pytest.raises(HTTPException) as denied:
            _search(owner, request)

        assert denied.value.status_code == 429
        retry_after = int(denied.value.headers["Retry-After"])
        assert 1 <= retry_after <= 60

    def test_rejected_searches_do_not_extend_the_block(self, owner, monkeypatch):
        from crate.federation import search as owner_search

        monkeypatch.setattr(owner_search, "INBOUND_SEARCH_PER_PEER_PER_MINUTE", 1)
        redis = _Redis()
        request = _request(redis)

        _search(owner, request)
        for _ in range(3):
            with pytest.raises(HTTPException):
                _search(owner, request)

        [peer_key] = [key for key in redis.sets if ":peer:" in key]
        assert len(redis.sets[peer_key]) == 1

    def test_one_remote_user_cannot_use_the_whole_peer_quota(self, owner, monkeypatch):
        from crate.federation import search as owner_search

        monkeypatch.setattr(owner_search, "INBOUND_SEARCH_PER_SUBJECT_PER_MINUTE", 1)
        request = _request(_Redis())

        _search(owner, request)
        with pytest.raises(HTTPException) as denied:
            _search(owner, request)
        monkeypatch.setattr(
            owner, "_require_user_assertion", lambda *args: {"sub": "someone-else"}
        )
        _search(owner, request)

        assert denied.value.status_code == 429

    def test_quotas_are_per_peer(self, owner, monkeypatch):
        from crate.federation import search as owner_search

        monkeypatch.setattr(owner_search, "INBOUND_SEARCH_PER_PEER_PER_MINUTE", 1)
        redis = _Redis()
        _search(owner, _request(redis))

        other = {"node_uid": "00000000-0000-0000-0000-0000000000cc"}

        async def signed_other(_request, body_bytes=None):
            del body_bytes
            return other

        monkeypatch.setattr(owner, "_require_signed_node_request", signed_other)

        assert _search(owner, _request(redis))["artists"]
