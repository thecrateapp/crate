"""Routing the federated fan-out through peer summaries (FED2)."""

from __future__ import annotations

import asyncio

import pytest

from crate.federation import peer_summaries, search_fanout
from crate.federation.peer_summaries import PeerSummary, load_peer_summaries
from crate.federation.search_fanout import (
    FanoutSettings,
    MemoryFanoutCache,
    PeerAnswer,
    decide_fanout,
)
from crate.federation.search_stream import federated_search_events
from crate.federation.summary_bloom import BloomFilter, artist_key, summary_terms

LOCAL_NODE = {"node_uid": "local", "active_key_id": "k", "private_key_ref": "r"}
PEERS = [{"node_uid": "a", "display_name": "A"}, {"node_uid": "b", "display_name": "B"}]
QUICK = FanoutSettings(per_peer_timeout_s=0.3, deadline_s=0.4)
EMPTY = {"artists": [], "albums": [], "tracks": []}


def _summary(node_uid, names=(), counts=None, etag="e1"):
    bloom = BloomFilter.sized(max(1, len(names) * 8))
    for name in names:
        for term in summary_terms(name):
            bloom.add(term)
    return PeerSummary(
        node_uid=node_uid,
        etag=etag,
        bloom=bloom,
        artist_album_counts=counts or {},
    )


@pytest.fixture
def asked(monkeypatch):
    calls: list[str] = []

    def fake_query_peer(peer, query, limit, local_node, user, timeout_s):
        calls.append(peer["node_uid"])
        return PeerAnswer(status="answered")

    monkeypatch.setattr(search_fanout, "_query_peer", fake_query_peer)
    return calls


def _events(query, summaries, local=EMPTY, peers=PEERS, stale=frozenset()):
    async def run():
        out = []
        async for name, payload in federated_search_events(
            query,
            limit=20,
            user={"id": 7},
            local_search=lambda: local,
            load_context=lambda: (LOCAL_NODE, peers),
            settings=QUICK,
            cache=MemoryFanoutCache(),
            stale_node_uids=lambda uids: {u for u in uids if u in stale},
            summaries=summaries,
        ):
            out.append((name, payload))
        return out

    return asyncio.run(run())


def _coverage_uids(events):
    cov = next(p for n, p in events if n == "coverage")
    return [p["node_uid"] for p in cov["peers"]]


def test_non_matching_peer_is_never_queried(asked):
    sums = {
        "a": _summary("a", ["Joy Division"]),
        "b": _summary("b", ["Radiohead"]),
    }
    events = _events("joy division", lambda uids: sums)

    assert asked == ["a"]
    assert _coverage_uids(events) == ["a"]


def test_peer_without_summary_is_still_asked(asked):
    sums = {"b": _summary("b", ["Radiohead"])}
    events = _events("joy division", lambda uids: sums)

    assert asked == ["a"]
    assert _coverage_uids(events) == ["a"]


def test_unroutable_query_keeps_every_peer(asked):
    sums = {"a": _summary("a", ["Radiohead"]), "b": _summary("b", ["Radiohead"])}
    _events("u2 u2", lambda uids: sums)

    assert sorted(asked) == ["a", "b"]


def test_no_candidate_skips_with_no_summary_match(asked):
    sums = {"a": _summary("a", ["Radiohead"]), "b": _summary("b", ["Radiohead"])}
    events = _events("joy division", lambda uids: sums)

    assert asked == []
    assert events[-1][0] == "done"
    cov = events[-1][1]["coverage"]
    assert cov["state"] == "skipped"
    assert cov["reason"] == "no_summary_match"
    assert cov["peers_total"] == 0


def _local_artist_results(album_count):
    tracks = [{"title": f"t{i}"} for i in range(6)]
    return {
        **EMPTY,
        "artists": [{"name": "Joy Division", "album_count": album_count}],
        "tracks": tracks,
    }


def test_peer_has_more_albums_triggers_fanout():
    key = artist_key("Joy Division")
    sums = {
        "a": _summary("a", ["Joy Division"], {key: 5}),
        "b": _summary("b", ["Joy Division"], {key: 2}),
    }
    decision = decide_fanout(
        "joy division",
        local_total=6,
        peers=PEERS,
        local_artists=[{"name": "Joy Division", "album_count": 2}],
        summaries=lambda uids: sums,
        stale_node_uids=lambda uids: set(),
    )

    assert decision.reason == "peer_has_more"
    assert [p["node_uid"] for p in decision.peers] == ["a"]


def test_equal_counts_do_not_trigger():
    key = artist_key("Joy Division")
    sums = {"a": _summary("a", ["Joy Division"], {key: 2})}
    decision = decide_fanout(
        "joy division",
        local_total=6,
        peers=PEERS,
        local_artists=[{"name": "Joy Division", "album_count": 2}],
        summaries=lambda uids: sums,
        stale_node_uids=lambda uids: set(),
    )

    assert decision.reason == "enough_local_results"
    assert decision.peers == []


def test_peer_has_more_through_the_stream(asked):
    key = artist_key("Joy Division")
    sums = {
        "a": _summary("a", ["Joy Division"], {key: 5}),
        "b": _summary("b", ["Joy Division"], {key: 2}),
    }
    events = _events("joy division", lambda uids: sums, local=_local_artist_results(2))

    assert asked == ["a"]
    cov = next(p for n, p in events if n == "coverage")
    assert cov["reason"] == "peer_has_more"


def test_stale_replica_is_filtered_by_summary():
    sums = {"a": _summary("a", ["Radiohead"])}
    decision = decide_fanout(
        "joy division",
        local_total=12,
        peers=PEERS,
        summaries=lambda uids: sums,
        stale_node_uids=lambda uids: {"a"},
    )

    assert decision.reason == "enough_local_results"
    assert decision.peers == []


def test_without_summaries_every_peer_is_a_candidate():
    decision = decide_fanout(
        "joy division", local_total=0, peers=PEERS, stale_node_uids=lambda u: set()
    )

    assert decision.reason == "few_local_results"
    assert len(decision.peers) == 2


def test_summary_cache_reloads_on_new_etag(monkeypatch):
    peer_summaries._SUMMARY_CACHE.clear()
    etags = {"a": "e1"}
    body_calls: list[list[str]] = []
    bloom = BloomFilter.sized(10)
    bloom.add("joy")

    def fake_etags(uids):
        return {u: etags[u] for u in uids if u in etags}

    def fake_bodies(uids):
        body_calls.append(list(uids))
        return [
            {
                "node_uid": u,
                "etag": etags[u],
                "params": {"m": bloom.params["m"], "k": bloom.params["k"]},
                "bloom": bloom.to_bytes(),
                "artist_album_counts": {},
            }
            for u in uids
        ]

    monkeypatch.setattr(
        peer_summaries.summaries_repo, "list_peer_summary_etags", fake_etags
    )
    monkeypatch.setattr(
        peer_summaries.summaries_repo, "get_peer_summaries", fake_bodies
    )

    assert load_peer_summaries(["a"])["a"].etag == "e1"
    assert load_peer_summaries(["a"])["a"].etag == "e1"
    assert body_calls == [["a"]]
    etags["a"] = "e2"
    assert load_peer_summaries(["a"])["a"].etag == "e2"
    assert body_calls == [["a"], ["a"]]
    peer_summaries._SUMMARY_CACHE.clear()


def test_summary_store_failure_asks_every_peer(monkeypatch, asked):
    from crate.federation import search_stream

    def boom(_uids):
        raise RuntimeError("db down")

    monkeypatch.setattr(peer_summaries, "load_peer_summaries", boom)
    assert search_stream._load_summaries(["a"]) == {}
