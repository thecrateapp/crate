"""Streaming federated search for Listen (FED1.4, design §4 "Search").

One request, several server-sent events:

- ``local``: A's own results, at once.
- ``coverage``: whether the network is asked, why, and how many peers.
- ``remote``: every time a peer adds results, the remote results so far,
  grouped by entity, with the coverage at that moment.
- ``done``: the final coverage when the window closes.

Coverage counts peers, never content: an empty answer says how many peers
answered, so Listen can never claim something is missing from the network.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from crate.federation.search_fanout import (
    DEFAULT_SETTINGS,
    SEARCH_GROUPS,
    FanoutCache,
    FanoutSettings,
    PeerOutcome,
    RemoteResultGroups,
    _stale_replica_node_uids,
    decide_fanout,
    stream_peer_outcomes,
)

log = logging.getLogger(__name__)

CoverageState = Literal["searching", "complete", "partial", "skipped"]
SkipReason = Literal["local_only", "federation_unavailable"]


@dataclass(slots=True)
class SearchCoverage:
    state: CoverageState
    reason: str
    window_ms: int
    peers: list[dict[str, str]] = field(default_factory=list)

    def record(self, outcome: PeerOutcome) -> None:
        status = "answered" if outcome.answered else outcome.status
        for peer in self.peers:
            if peer["node_uid"] == outcome.node_uid:
                peer["status"] = status

    def _count(self, *statuses: str) -> int:
        return sum(1 for peer in self.peers if peer["status"] in statuses)

    def finish(self) -> None:
        if self.state != "searching":
            return
        for peer in self.peers:
            if peer["status"] == "pending":
                peer["status"] = "timed_out"
        answered = self._count("answered")
        self.state = "complete" if answered == len(self.peers) else "partial"

    def payload(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "reason": self.reason,
            "window_ms": self.window_ms,
            "peers_total": len(self.peers),
            "peers_answered": self._count("answered"),
            "peers_failed": self._count("failed", "rate_limited"),
            "peers_timed_out": self._count("timed_out"),
            "peers_pending": self._count("pending"),
            "peers": [dict(peer) for peer in self.peers],
        }


def sse_frame(event: str, payload: Any) -> str:
    data = json.dumps(payload, separators=(",", ":"), default=str)
    return f"event: {event}\ndata: {data}\n\n"


def _load_context() -> tuple[dict | None, list[dict]]:
    from crate.db.repositories import federation as fed_repo
    from crate.federation.search_fanout import _get_approved_peers_for_search

    local_node = fed_repo.get_local_node()
    if not local_node:
        return None, []
    return local_node, _get_approved_peers_for_search()


def _load_summaries(node_uids: list[str]) -> dict[str, Any]:
    from crate.federation.peer_summaries import load_peer_summaries

    try:
        return load_peer_summaries(node_uids)
    except Exception:
        # Routing is an optimisation: without summaries every peer is asked.
        log.warning("Peer summaries unavailable; asking every peer", exc_info=True)
        return {}


def _load_album_counts(names: list[str]) -> dict[str, int]:
    from crate.db.queries.federation_search import local_artist_album_counts

    return local_artist_album_counts(names)


def _has_album_count(artist: dict) -> bool:
    count = artist.get("album_count")
    return isinstance(count, int) and not isinstance(count, bool)


def _artists_with_album_counts(
    artists: list[dict],
    album_counts: Callable[[list[str]], dict[str, int]],
) -> list[dict]:
    """The top local artists, with the local album count where it is missing.

    The global-catalog search rows carry no ``album_count``; ``peer_has_more``
    needs it for the first three artists. One batched read, never in a loop.
    """
    top = list(artists[:3])
    names = [
        str(artist["name"])
        for artist in top
        if artist.get("name") and not _has_album_count(artist)
    ]
    if not names:
        return top
    try:
        counts = album_counts(names)
    except Exception:
        # Routing is an optimisation: without counts peer_has_more stays off.
        log.warning("Local album counts unavailable", exc_info=True)
        return top
    enriched = []
    for artist in top:
        count = None
        if artist.get("name") and not _has_album_count(artist):
            count = counts.get(str(artist["name"]).lower())
        enriched.append(artist if count is None else {**artist, "album_count": count})
    return enriched


def _routing_decision(
    query: str,
    local: dict[str, list[dict]],
    peers: list[dict],
    *,
    summaries: Callable[[list[str]], dict[str, Any]],
    stale_node_uids: Callable[[list[str]], set[str]],
    album_counts: Callable[[list[str]], dict[str, int]],
    settings: FanoutSettings,
):
    local_total = _local_total(local)
    artists = local.get("artists") or []
    if peers and local_total >= settings.min_local_results:
        # Only this branch of decide_fanout reads the artists' album counts.
        artists = _artists_with_album_counts(artists, album_counts)
    return decide_fanout(
        query,
        local_total=local_total,
        peers=peers,
        local_artists=artists,
        summaries=summaries,
        stale_node_uids=stale_node_uids,
        settings=settings,
    )


def _local_total(results: dict[str, list[dict]]) -> int:
    return sum(len(results.get(group) or []) for group in SEARCH_GROUPS)


async def federated_search_events(
    query: str,
    *,
    limit: int,
    user: dict,
    local_search: Callable[[], dict[str, list[dict]]],
    load_context: Callable[[], tuple[dict | None, list[dict]]] | None = None,
    settings: FanoutSettings = DEFAULT_SETTINGS,
    cache: FanoutCache | None = None,
    stale_node_uids: Callable[[list[str]], set[str]] | None = None,
    summaries: Callable[[list[str]], dict[str, Any]] | None = None,
    local_album_counts: Callable[[list[str]], dict[str, int]] | None = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    window_ms = int(settings.deadline_s * 1000)
    local = await asyncio.to_thread(local_search)
    yield "local", {"query": query, "results": local}

    def skipped(reason: str) -> tuple[str, dict[str, Any]]:
        coverage = SearchCoverage(state="skipped", reason=reason, window_ms=window_ms)
        return "done", {"coverage": coverage.payload()}

    if user.get("auth_type") == "access_token":
        yield skipped("local_only")
        return
    # The local results are out; whatever fails from here on ends the stream
    # with a coverage, never a broken connection.
    coverage: SearchCoverage | None = None
    try:
        local_node, peers = await asyncio.to_thread(load_context or _load_context)
        if not local_node:
            yield skipped("federation_unavailable")
            return
        decision = await asyncio.to_thread(
            _routing_decision,
            query,
            local,
            peers,
            summaries=summaries or _load_summaries,
            stale_node_uids=stale_node_uids or _stale_replica_node_uids,
            album_counts=local_album_counts or _load_album_counts,
            settings=settings,
        )
        if not decision.fans_out:
            yield skipped(decision.reason)
            return

        coverage = SearchCoverage(
            state="searching",
            reason=decision.reason,
            window_ms=window_ms,
            peers=[
                {
                    "node_uid": str(peer["node_uid"]),
                    "node_name": str(peer.get("display_name") or ""),
                    "status": "pending",
                }
                for peer in decision.peers
            ],
        )
        yield "coverage", coverage.payload()

        groups = RemoteResultGroups(local=local)
        async for outcome in stream_peer_outcomes(
            query,
            decision.peers,
            local_node=local_node,
            user=user,
            limit=limit,
            settings=settings,
            cache=cache,
        ):
            coverage.record(outcome)
            if outcome.answered and _local_total(outcome.results):
                groups.add(outcome.results)
                yield (
                    "remote",
                    {"results": groups.snapshot(), "coverage": coverage.payload()},
                )
            else:
                yield "coverage", coverage.payload()
    except Exception:
        log.warning("Federated search stopped after the local results", exc_info=True)
        if coverage is None:
            yield skipped("federation_unavailable")
            return
    if coverage is None:
        return
    coverage.finish()
    yield "done", {"coverage": coverage.payload()}


__all__ = [
    "SearchCoverage",
    "SkipReason",
    "federated_search_events",
    "sse_frame",
]
