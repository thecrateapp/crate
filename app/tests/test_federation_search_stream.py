"""Streaming federated search: local results at once, remote within the window (FED1.4)."""

from __future__ import annotations

import asyncio
import json
import time

import pytest

from crate.federation import search_fanout, search_stream
from crate.federation.search_fanout import FanoutSettings, MemoryFanoutCache, PeerAnswer
from crate.federation.search_stream import federated_search_events, sse_frame

LOCAL_NODE = {"node_uid": "local", "active_key_id": "k", "private_key_ref": "r"}
PEERS = [
    {"node_uid": "fast", "display_name": "Fast"},
    {"node_uid": "slow", "display_name": "Slow"},
    {"node_uid": "empty", "display_name": "Empty"},
]
QUICK = FanoutSettings(per_peer_timeout_s=0.3, deadline_s=0.4)
EMPTY = {"artists": [], "albums": [], "tracks": []}


def _remote_track(node_uid: str, title: str) -> dict:
    return {
        "origin": "remote",
        "node_uid": node_uid,
        "node_name": node_uid.title(),
        "remote_entity_uid": f"{node_uid}-{title}",
        "title": title,
        "artist": "Joy Division",
        "album": "Closer",
    }


@pytest.fixture
def peers(monkeypatch):
    def fake_query_peer(peer, query, limit, local_node, user, timeout_s):
        del query, limit, local_node, user, timeout_s
        if peer["node_uid"] == "slow":
            time.sleep(1.0)
        if peer["node_uid"] == "empty":
            return PeerAnswer(status="answered")
        return PeerAnswer(
            status="answered",
            results={**EMPTY, "tracks": [_remote_track(peer["node_uid"], "Isolation")]},
        )

    monkeypatch.setattr(search_fanout, "_query_peer", fake_query_peer)


def _events(
    local=EMPTY, *, query="joy division", user=None, peers=PEERS, node=LOCAL_NODE
):
    async def run():
        collected = []
        started = time.monotonic()
        async for name, payload in federated_search_events(
            query,
            limit=20,
            user=user if user is not None else {"id": 7},
            local_search=lambda: local,
            load_context=lambda: (node, peers),
            settings=QUICK,
            cache=MemoryFanoutCache(),
            stale_node_uids=lambda _uids: set(),
        ):
            collected.append((time.monotonic() - started, name, payload))
        return collected

    return asyncio.run(run())


def test_local_results_come_first_and_at_once(peers):
    local = {**EMPTY, "artists": [{"name": "Joy Division"}]}

    events = _events(local)

    at, name, payload = events[0]
    assert name == "local"
    assert payload == {"query": "joy division", "results": local}
    assert at < 0.1


def test_coverage_starts_searching_with_the_peer_count(peers):
    events = _events()

    _, name, payload = events[1]
    assert name == "coverage"
    assert payload["state"] == "searching"
    assert payload["reason"] == "few_local_results"
    assert payload["peers_total"] == 3
    assert payload["peers_answered"] == 0


def test_remote_results_stream_before_the_window_closes(peers):
    events = _events()

    remote = [(at, payload) for at, name, payload in events if name == "remote"]
    assert remote
    first_at, first = remote[0]
    assert first_at < 0.2
    assert [t["remote_entity_uid"] for t in first["results"]["tracks"]] == [
        "fast-Isolation"
    ]


def test_the_final_coverage_counts_every_peer(peers):
    events = _events()

    at, name, payload = events[-1]
    assert name == "done"
    coverage = payload["coverage"]
    assert coverage["state"] == "partial"
    assert coverage["peers_total"] == 3
    assert coverage["peers_answered"] == 2
    assert coverage["peers_timed_out"] == 1
    assert coverage["peers_failed"] == 0
    assert {peer["node_uid"]: peer["status"] for peer in coverage["peers"]} == {
        "fast": "answered",
        "slow": "timed_out",
        "empty": "answered",
    }
    assert at < QUICK.deadline_s + 0.2


def test_every_peer_answering_is_complete(peers):
    events = _events(peers=[PEERS[0], PEERS[2]])

    assert events[-1][2]["coverage"]["state"] == "complete"


def test_an_empty_network_answer_is_still_only_the_peers_that_answered(peers):
    events = _events(peers=[PEERS[2]])

    coverage = events[-1][2]["coverage"]
    assert coverage["state"] == "complete"
    assert coverage["peers_answered"] == 1
    assert not [name for _, name, _ in events if name == "remote"]


def test_enough_local_results_skip_the_network(peers):
    local = {**EMPTY, "tracks": [{"title": str(index)} for index in range(6)]}

    events = _events(local)

    assert [name for _, name, _ in events] == ["local", "done"]
    coverage = events[-1][2]["coverage"]
    assert coverage["state"] == "skipped"
    assert coverage["reason"] == "enough_local_results"
    assert coverage["peers_total"] == 0


def test_short_queries_stay_local(peers):
    events = _events(query="jo")

    assert events[-1][2]["coverage"]["reason"] == "query_too_short"


def test_without_a_local_node_the_network_is_unavailable(peers):
    events = _events(node=None)

    assert events[-1][2]["coverage"]["reason"] == "federation_unavailable"


def test_access_tokens_only_search_the_local_library(peers):
    events = _events(user={"id": 7, "auth_type": "access_token"})

    assert events[-1][2]["coverage"]["reason"] == "local_only"


def test_sse_frames_are_named_events_with_json_data():
    frame = sse_frame("remote", {"a": 1})

    assert frame == 'event: remote\ndata: {"a":1}\n\n'
    assert json.loads(frame.split("data: ", 1)[1]) == {"a": 1}


def test_the_endpoint_streams_server_sent_events(monkeypatch, peers):
    from crate.api import catalog

    monkeypatch.setattr(catalog, "_require_auth", lambda _request: {"id": 7})
    monkeypatch.setattr(catalog, "_catalog_mode", lambda _response: "global")
    monkeypatch.setattr(catalog, "search_global_catalog", lambda q, **kw: EMPTY)
    monkeypatch.setattr(search_stream, "_load_context", lambda: (LOCAL_NODE, PEERS[:1]))
    monkeypatch.setattr(search_stream, "_stale_replica_node_uids", lambda _uids: set())
    monkeypatch.setattr(search_stream, "StoreFanoutCache", MemoryFanoutCache)

    response = catalog.catalog_search_stream(object(), q="joy division", limit=20)

    assert response.media_type == "text/event-stream"
    assert response.headers["X-Accel-Buffering"] == "no"

    async def body():
        return "".join([chunk async for chunk in response.body_iterator])

    text = asyncio.run(body())
    names = [
        line.removeprefix("event: ")
        for line in text.splitlines()
        if line.startswith("event: ")
    ]
    assert names[0] == "local"
    assert names[-1] == "done"
    assert "remote" in names
