"""Federated search fan-out: deadlines, negative cache and grouping (FED1.2)."""

from __future__ import annotations

import asyncio
import threading
import time

import pytest

from crate.federation import search_fanout
from crate.federation.search_fanout import (
    FanoutSettings,
    MemoryFanoutCache,
    PeerAnswer,
    RemoteResultGroups,
    eligible_search_peers,
    stream_peer_outcomes,
)

LOCAL_NODE = {"node_uid": "local", "active_key_id": "k", "private_key_ref": "r"}
FAST = {"node_uid": "fast", "display_name": "Fast", "api_base_url": "https://fast.test"}
SLOW = {"node_uid": "slow", "display_name": "Slow", "api_base_url": "https://slow.test"}

QUICK = FanoutSettings(per_peer_timeout_s=0.3, deadline_s=0.4, max_concurrency=4)


def _track(peer: dict, title: str, uid: str | None = None) -> dict:
    return {
        "origin": "remote",
        "node_uid": peer["node_uid"],
        "node_name": peer["display_name"],
        "remote_entity_uid": uid or f"{peer['node_uid']}-{title}",
        "title": title,
        "artist": "Joy Division",
        "album": "Unknown Pleasures",
    }


def _answer(*tracks: dict) -> PeerAnswer:
    return PeerAnswer(
        status="answered",
        results={"artists": [], "albums": [], "tracks": list(tracks)},
    )


def _collect(peers, *, settings=QUICK, cache=None, query="joy division", user=None):
    async def run():
        outcomes = []
        started = time.monotonic()
        async for outcome in stream_peer_outcomes(
            query,
            peers,
            local_node=LOCAL_NODE,
            user=user,
            limit=20,
            settings=settings,
            cache=cache if cache is not None else MemoryFanoutCache(),
        ):
            outcomes.append((time.monotonic() - started, outcome))
        return outcomes

    return asyncio.run(run())


@pytest.fixture
def peers_answer(monkeypatch):
    """Fake peers: FAST answers at once, SLOW after ``slow_delay`` seconds."""
    calls: list[str] = []
    state = {"slow_delay": 1.0, "fast": _answer(_track(FAST, "Disorder"))}
    finished = threading.Event()

    def fake_query_peer(peer, query, limit, local_node, user, timeout_s):
        del query, limit, local_node, user, timeout_s
        calls.append(peer["node_uid"])
        if peer["node_uid"] == "slow":
            time.sleep(state["slow_delay"])
            finished.set()
            return _answer(_track(SLOW, "Shadowplay"))
        return state["fast"]

    monkeypatch.setattr(search_fanout, "_query_peer", fake_query_peer)
    return calls, state, finished


class TestDeadlines:
    def test_a_slow_peer_never_delays_the_first_results(self, peers_answer):
        outcomes = _collect([SLOW, FAST])

        first_at, first = outcomes[0]
        assert first.node_uid == "fast"
        assert first.status == "answered"
        assert first_at < 0.2

    def test_the_total_deadline_closes_the_window(self, peers_answer):
        outcomes = _collect([SLOW, FAST])

        last_at, _ = outcomes[-1]
        statuses = {outcome.node_uid: outcome.status for _, outcome in outcomes}
        assert statuses == {"fast": "answered", "slow": "timed_out"}
        assert last_at < QUICK.deadline_s + 0.2

    def test_the_per_peer_timeout_is_shorter_than_the_window(self, peers_answer):
        settings = FanoutSettings(per_peer_timeout_s=0.1, deadline_s=1.0)

        outcomes = _collect([SLOW, FAST], settings=settings)

        slow_at, slow = next((at, o) for at, o in outcomes if o.node_uid == "slow")
        assert slow.status == "timed_out"
        assert slow_at < 0.4

    def test_concurrency_is_bounded(self, monkeypatch):
        running = 0
        peak = 0
        lock = threading.Lock()

        def fake_query_peer(peer, query, limit, local_node, user, timeout_s):
            nonlocal running, peak
            with lock:
                running += 1
                peak = max(peak, running)
            time.sleep(0.05)
            with lock:
                running -= 1
            return _answer()

        monkeypatch.setattr(search_fanout, "_query_peer", fake_query_peer)
        peers = [
            {"node_uid": f"p{index}", "display_name": f"P{index}"} for index in range(6)
        ]

        outcomes = _collect(
            peers, settings=FanoutSettings(max_concurrency=2, deadline_s=2.0)
        )

        assert peak == 2
        assert all(outcome.status == "answered" for _, outcome in outcomes)

    def test_a_failing_peer_is_reported_not_raised(self, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("connection refused")

        monkeypatch.setattr(search_fanout, "_query_peer", boom)

        [(_, outcome)] = _collect([FAST])

        assert outcome.status == "failed"


class TestNegativeCache:
    def test_a_late_answer_is_cached_and_served_next_time(self, peers_answer):
        calls, state, finished = peers_answer
        state["slow_delay"] = 0.5
        cache = MemoryFanoutCache()

        first = _collect([SLOW], cache=cache)
        assert [outcome.status for _, outcome in first] == ["timed_out"]
        assert finished.wait(2.0)
        time.sleep(0.05)

        second = _collect([SLOW], cache=cache)

        [(at, outcome)] = second
        assert outcome.status == "cached"
        assert outcome.results["tracks"][0]["title"] == "Shadowplay"
        assert at < 0.1
        assert calls == ["slow"]

    def test_an_empty_answer_is_remembered_per_query_and_peer(self, peers_answer):
        calls, state, _ = peers_answer
        state["fast"] = _answer()
        cache = MemoryFanoutCache()

        _collect([FAST], cache=cache, query="nothing here")
        [(_, again)] = _collect([FAST], cache=cache, query="Nothing  Here")
        _collect([FAST], cache=cache, query="something else")

        assert again.status == "cached"
        assert again.results == {"artists": [], "albums": [], "tracks": []}
        assert calls == ["fast", "fast"]

    def test_the_cache_is_per_viewer(self, peers_answer):
        calls, _, _ = peers_answer
        cache = MemoryFanoutCache()

        _collect([FAST], cache=cache, user={"id": 1})
        _collect([FAST], cache=cache, user={"id": 2})

        assert calls == ["fast", "fast"]

    def test_a_429_backs_off_that_peer_for_the_query(self, monkeypatch):
        calls: list[str] = []

        def limited(peer, query, limit, local_node, user, timeout_s):
            calls.append(peer["node_uid"])
            return PeerAnswer(status="rate_limited", retry_after_s=10)

        monkeypatch.setattr(search_fanout, "_query_peer", limited)
        cache = MemoryFanoutCache()

        [(_, first)] = _collect([FAST], cache=cache)
        [(_, second)] = _collect([FAST], cache=cache)

        assert first.status == second.status == "rate_limited"
        assert calls == ["fast"]

    def test_failures_are_not_cached(self, monkeypatch):
        calls: list[str] = []

        def failed(peer, query, limit, local_node, user, timeout_s):
            calls.append(peer["node_uid"])
            return PeerAnswer(status="failed")

        monkeypatch.setattr(search_fanout, "_query_peer", failed)
        cache = MemoryFanoutCache()

        _collect([FAST], cache=cache)
        _collect([FAST], cache=cache)

        assert calls == ["fast", "fast"]

    def test_cache_keys_do_not_contain_the_query_text(self):
        key = search_fanout.peer_cache_key("fast", "joy division", limit=20, user=None)

        assert "joy" not in key
        assert key.startswith("federation:search:v1:fast:")


class TestGrouping:
    def test_the_same_entity_from_two_peers_is_one_result_with_two_sources(self):
        groups = RemoteResultGroups(local={"artists": [], "albums": [], "tracks": []})
        groups.add(_answer(_track(FAST, "Disorder", "f1")).results)
        groups.add(_answer(_track(SLOW, "disorder ", "s1")).results)

        [track] = groups.snapshot()["tracks"]

        assert track["remote_entity_uid"] == "f1"
        assert [source["node_uid"] for source in track["sources"]] == ["fast", "slow"]
        assert [source["remote_entity_uid"] for source in track["sources"]] == [
            "f1",
            "s1",
        ]

    def test_artists_and_albums_already_in_the_local_library_are_dropped(self):
        groups = RemoteResultGroups(
            local={
                "artists": [{"name": "Joy Division"}],
                "albums": [
                    {"artist": "Joy Division", "name": "Closer", "year": "1980"}
                ],
                "tracks": [],
            }
        )
        groups.add(
            {
                "artists": [
                    {
                        "name": "joy division",
                        "node_uid": "fast",
                        "remote_entity_uid": "a",
                    },
                    {"name": "New Order", "node_uid": "fast", "remote_entity_uid": "b"},
                ],
                "albums": [
                    {
                        "artist": "Joy Division",
                        "name": "Closer",
                        "year": "1980",
                        "node_uid": "fast",
                        "remote_entity_uid": "c",
                    }
                ],
                "tracks": [],
            }
        )

        snapshot = groups.snapshot()

        assert [artist["name"] for artist in snapshot["artists"]] == ["New Order"]
        assert snapshot["albums"] == []

    def test_results_are_grouped_by_entity_type(self):
        groups = RemoteResultGroups(local={})
        groups.add(_answer(_track(FAST, "Disorder")).results)

        assert set(groups.snapshot()) == {"artists", "albums", "tracks"}


class TestPeerSelection:
    def test_only_direct_approved_enabled_searchable_peers(self):
        peers = [
            {"node_uid": "ok", "trust_state": "approved", "capabilities_json": {}},
            {"node_uid": "disabled", "trust_state": "approved", "disabled_at": "x"},
            {"node_uid": "pending", "trust_state": "pending"},
            {
                "node_uid": "no-search",
                "trust_state": "approved",
                "capabilities_json": {"catalog.sync": True},
            },
            {
                "node_uid": "list-caps",
                "trust_state": "approved",
                "capabilities_json": ["catalog.search"],
            },
            {
                "node_uid": "backoff",
                "trust_state": "approved",
                "health_json": {
                    "healthy": False,
                    "backoff_until": "2999-01-01T00:00:00Z",
                },
            },
        ]

        selected = eligible_search_peers(peers)

        assert [peer["node_uid"] for peer in selected] == ["ok", "list-caps"]
