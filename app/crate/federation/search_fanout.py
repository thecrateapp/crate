"""Federated search fan-out to direct, authorised peers (FED-D2, D4, D17).

A searches its own index first. When FED-D14 triggers, it asks its direct
peers in parallel, with bounded concurrency, a per-peer timeout and a total
deadline, and streams each peer's answer as it arrives. Answers that come after
the window still land in a short cache per (query, peer), so they show up as
"more results from the network" and in the next search; an empty answer or a
429 is remembered the same way, so a repeated query does not hit that peer
again. Remote results are grouped by entity: the same album or track found at
two peers is one result with two sources.

``federated_search`` is the older synchronous entry point behind
``/api/search?scope=federated``; it shares the same peer query.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import logging
import threading
import time
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Protocol

import httpx

from crate.db.queries.browse_media_search import search_all_hybrid
from crate.db.repositories import federation as repo
from crate.federation.client import (
    SEARCH_TIMEOUT,
    federated_post,
)
from crate.federation.results_envelope import (
    RESULTS_CONTRACT,
    envelope_to_search_contract,
    is_results_envelope,
    parse_results_envelope,
)

log = logging.getLogger(__name__)

MAX_CONCURRENT_PEERS = 2
DEFAULT_PEER_SEARCH_TIMEOUT_MS = 600
FANOUT_DEADLINE_SECONDS = 2.0

SEARCH_GROUPS = ("artists", "albums", "tracks")
CACHE_PREFIX = "federation:search:v1"


@dataclass(frozen=True, slots=True)
class FanoutSettings:
    """FED1 values (decided by Diego, 2026-11-12)."""

    # FED-D14: fan out when there are fewer than k local results.
    min_local_results: int = 5
    # Shorter queries never fan out (Listen also waits for 3 characters).
    min_query_length: int = 3
    # FED-D4: 1.5 s per peer and a 2 s total window.
    per_peer_timeout_s: float = 1.5
    deadline_s: float = 2.0
    max_concurrency: int = 4
    # The HTTP call may outlive the window so a late answer reaches the cache.
    answer_timeout_s: float = 4.0
    # FED-D17: short TTLs for the per (query, peer) cache.
    answer_ttl_s: int = 300
    empty_ttl_s: int = 60
    max_rate_limited_ttl_s: int = 60


DEFAULT_SETTINGS = FanoutSettings()

PeerStatus = Literal["answered", "cached", "failed", "timed_out", "rate_limited"]


def _empty_results() -> dict[str, list[dict]]:
    return {group: [] for group in SEARCH_GROUPS}


@dataclass(frozen=True, slots=True)
class PeerAnswer:
    """What one peer said, as seen by the thread that asked it."""

    status: Literal["answered", "failed", "rate_limited"]
    results: dict[str, list[dict]] = field(default_factory=_empty_results)
    retry_after_s: int | None = None


@dataclass(frozen=True, slots=True)
class PeerOutcome:
    """One peer's part of a fan-out, as streamed to the caller."""

    node_uid: str
    node_name: str
    status: PeerStatus
    results: dict[str, list[dict]] = field(default_factory=_empty_results)

    @property
    def answered(self) -> bool:
        return self.status in ("answered", "cached")


class FanoutCache(Protocol):
    def get_many(self, keys: list[str]) -> dict[str, Any]: ...

    def set(self, key: str, value: Any, ttl_s: int) -> None: ...


class StoreFanoutCache:
    """The shared cache store (Redis, with its usual fallbacks)."""

    def get_many(self, keys: list[str]) -> dict[str, Any]:
        from crate.db.cache_store import get_caches

        try:
            return get_caches(keys)
        except Exception:
            log.debug("Federated search cache read failed", exc_info=True)
            return {}

    def set(self, key: str, value: Any, ttl_s: int) -> None:
        from crate.db.cache_store import set_cache

        try:
            set_cache(key, value, ttl=ttl_s)
        except Exception:
            log.debug("Federated search cache write failed", exc_info=True)


class MemoryFanoutCache:
    """In-process cache for tests and for callers without a shared store."""

    def __init__(self) -> None:
        self._values: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get_many(self, keys: list[str]) -> dict[str, Any]:
        now = time.monotonic()
        with self._lock:
            return {
                key: value
                for key in keys
                if (entry := self._values.get(key)) is not None
                for expires_at, value in (entry,)
                if expires_at > now
            }

    def set(self, key: str, value: Any, ttl_s: int) -> None:
        with self._lock:
            self._values[key] = (time.monotonic() + ttl_s, value)


class NullFanoutCache:
    def get_many(self, keys: list[str]) -> dict[str, Any]:
        del keys
        return {}

    def set(self, key: str, value: Any, ttl_s: int) -> None:
        del key, value, ttl_s


# Peer queries run on their own small pool so a slow peer never holds a request
# worker, and so an answer that comes after the window can still be cached.
_PEER_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=8, thread_name_prefix="federated-search"
)


def normalize_fanout_query(query: str) -> str:
    return " ".join(query.casefold().split())


def peer_cache_key(node_uid: str, query: str, *, limit: int, user: dict | None) -> str:
    """Key per (query, peer, viewer). The query is hashed, never stored (FED-D16)."""
    viewer = str(user.get("id")) if user and user.get("id") is not None else "node"
    digest = hashlib.sha256(
        f"{normalize_fanout_query(query)}\x1f{limit}\x1f{viewer}".encode()
    ).hexdigest()[:40]
    return f"{CACHE_PREFIX}:{node_uid}:{digest}"


def _peer_is_in_backoff(peer: dict, *, now: datetime | None = None) -> bool:
    health = peer.get("health_json")
    if not isinstance(health, dict) or health.get("healthy") is not False:
        return False
    raw_backoff_until = health.get("backoff_until")
    if not isinstance(raw_backoff_until, str):
        return False
    try:
        backoff_until = datetime.fromisoformat(raw_backoff_until.replace("Z", "+00:00"))
    except ValueError:
        return False
    if backoff_until.tzinfo is None:
        backoff_until = backoff_until.replace(tzinfo=timezone.utc)
    return backoff_until > (now or datetime.now(timezone.utc))


def _query_peer(
    peer: dict,
    query: str,
    limit: int,
    local_node: dict,
    user: dict | None = None,
    timeout_s: float | None = None,
) -> PeerAnswer:
    """Ask one peer, asking for the v1 envelope (older owners answer the legacy shape)."""
    try:
        user_assertion = None
        if user:
            from crate.federation.assertions import build_outbound_user_assertion

            user_assertion = build_outbound_user_assertion(
                local_node=local_node,
                peer=peer,
                user=user,
                purpose="catalog.search",
                capabilities=["federation.catalog.search"],
            )
        timeout = (
            httpx.Timeout(timeout_s, connect=min(timeout_s, 2.0))
            if timeout_s is not None
            else SEARCH_TIMEOUT
        )
        resp = federated_post(
            base_url=peer["api_base_url"],
            path="/api/federation/v1/search",
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            json_body={"q": query, "limit": limit, "contracts": [RESULTS_CONTRACT]},
            timeout=timeout,
            user_assertion=user_assertion,
        )
        if resp.status_code == 200:
            return PeerAnswer(
                status="answered", results=_adapt_peer_answer(resp.json(), peer=peer)
            )
        if resp.status_code == 429:
            return PeerAnswer(
                status="rate_limited",
                retry_after_s=_retry_after_seconds(resp.headers.get("Retry-After")),
            )
        log.debug("Peer %s returned %d", peer["node_uid"], resp.status_code)
        return PeerAnswer(status="failed")
    except Exception as e:
        log.debug("Peer %s search failed: %s", peer["node_uid"], e)
        return PeerAnswer(status="failed")


def _retry_after_seconds(value: str | None) -> int | None:
    try:
        return max(1, int(str(value).strip())) if value is not None else None
    except ValueError:
        return None


def _search_one_peer(
    peer: dict,
    query: str,
    limit: int,
    local_node: dict,
    user: dict | None = None,
) -> dict | None:
    """Fan out a search to one peer. Returns remote results or None on failure."""
    answer = _query_peer(peer, query, limit, local_node, user)
    return answer.results if answer.status == "answered" else None


def _adapt_peer_answer(data: Any, *, peer: dict) -> dict:
    """Read a peer's answer: the v1 envelope, or the legacy shape of older owners."""
    if is_results_envelope(data):
        envelope = parse_results_envelope(data)
        if envelope is None:
            raise ValueError("Unreadable results envelope")
        return envelope_to_search_contract(envelope, peer=peer)
    return _tag_remote_results(data=data, peer=peer)


def _tag_remote_results(data: dict, peer: dict) -> dict:
    """Add origin, node_uid, node_name, and remote_entity_uid to results."""
    node_uid = str(peer["node_uid"])
    node_name = peer["display_name"]
    preset = peer.get("default_grant_preset", "discovery")

    from crate.federation.grants import preset_allows

    has_stream = preset_allows(preset, "stream.proxy")
    has_import = preset_allows(preset, "import.request")

    avail = {"catalog": True, "stream": has_stream, "import": has_import}

    for artist in data.get("artists", []):
        artist["origin"] = "remote"
        artist["node_uid"] = node_uid
        artist["node_name"] = node_name
        artist["remote_entity_uid"] = artist.get("entity_uid", "")
        artist["availability"] = avail

    for album in data.get("albums", []):
        album["origin"] = "remote"
        album["node_uid"] = node_uid
        album["node_name"] = node_name
        album["remote_entity_uid"] = album.get("entity_uid", "")
        album["availability"] = avail

    for track in data.get("tracks", []):
        track["origin"] = "remote"
        track["node_uid"] = node_uid
        track["node_name"] = node_name
        track["remote_entity_uid"] = track.get("entity_uid", "")
        track["availability"] = avail

    return data


def _advertises_search(peer: dict) -> bool:
    """Peers that advertise capabilities must list catalog.search; unknown is allowed."""
    capabilities = peer.get("capabilities_json")
    if isinstance(capabilities, dict):
        return not capabilities or bool(capabilities.get("catalog.search"))
    if isinstance(capabilities, (list, tuple)):
        return not capabilities or "catalog.search" in capabilities
    return True


def eligible_search_peers(peers: Iterable[dict]) -> list[dict]:
    """Direct peers that may receive a search: approved, enabled, searchable (FED-D2)."""
    return [
        peer
        for peer in peers
        if peer.get("trust_state", "approved") == "approved"
        and peer.get("disabled_at") is None
        and not _peer_is_in_backoff(peer)
        and _advertises_search(peer)
    ]


def _get_approved_peers_for_search() -> list[dict]:
    """Return approved peers that should receive search queries."""
    return eligible_search_peers(repo.list_peers(trust_state="approved"))


def _merge_results(
    local: dict[str, list[dict]],
    remote_results: list[dict],
) -> dict[str, list[dict]]:
    """Merge local and remote results. Local results come first."""
    artists = list(local.get("artists", []))
    albums = list(local.get("albums", []))
    tracks = list(local.get("tracks", []))

    local_album_keys = {_album_match_key(a) for a in albums}
    local_artist_keys = {_artist_match_key(a) for a in artists}

    for remote in remote_results:
        for artist in remote.get("artists", []):
            key = _artist_match_key(artist)
            if key not in local_artist_keys:
                artists.append(artist)
                local_artist_keys.add(key)

        for album in remote.get("albums", []):
            key = _album_match_key(album)
            if key not in local_album_keys:
                albums.append(album)
                local_album_keys.add(key)

        for track in remote.get("tracks", []):
            tracks.append(track)

    return {
        "artists": artists,
        "albums": albums,
        "tracks": tracks,
    }


def _artist_match_key(artist: dict) -> str:
    name = (artist.get("name") or "").strip().lower()
    return f"artist:{name}"


def _album_match_key(album: dict) -> str:
    artist = (album.get("artist") or "").strip().lower()
    name = (album.get("name") or "").strip().lower()
    year = str(album.get("year", "")).strip()
    return f"album:{artist}|{name}|{year}"


def _track_match_key(track: dict) -> str:
    artist = (track.get("artist") or "").strip().lower()
    title = (track.get("title") or "").strip().lower()
    album = (track.get("album") or "").strip().lower()
    return f"track:{artist}|{title}|{album}"


_MATCH_KEYS = {
    "artists": _artist_match_key,
    "albums": _album_match_key,
    "tracks": _track_match_key,
}


def _source_of(item: dict) -> dict[str, Any]:
    source = {
        "node_uid": item.get("node_uid"),
        "node_name": item.get("node_name"),
        "remote_entity_uid": item.get("remote_entity_uid"),
    }
    if isinstance(item.get("availability"), dict):
        source["availability"] = item["availability"]
    return source


class RemoteResultGroups:
    """Remote results grouped by entity across peers.

    The first peer's item represents the entity; later peers add a source.
    Artists and albums the local library already has are left out, as the older
    merge did; tracks are kept, since another copy is another playback source.
    """

    def __init__(self, *, local: dict[str, list[dict]]) -> None:
        self._local_keys = {
            group: {_MATCH_KEYS[group](item) for item in local.get(group) or []}
            for group in ("artists", "albums")
        }
        self._items: dict[str, dict[str, dict]] = {group: {} for group in SEARCH_GROUPS}

    def add(self, results: dict[str, list[dict]]) -> None:
        for group in SEARCH_GROUPS:
            match_key = _MATCH_KEYS[group]
            grouped = self._items[group]
            for item in results.get(group) or []:
                key = match_key(item)
                if key in self._local_keys.get(group, ()):
                    continue
                existing = grouped.get(key)
                if existing is None:
                    grouped[key] = {**item, "sources": [_source_of(item)]}
                elif all(
                    source["node_uid"] != item.get("node_uid")
                    for source in existing["sources"]
                ):
                    existing["sources"].append(_source_of(item))

    def snapshot(self) -> dict[str, list[dict]]:
        return {
            group: [
                {**item, "sources": list(item["sources"])}
                for item in self._items[group].values()
            ]
            for group in SEARCH_GROUPS
        }


def _cache_entry(answer: PeerAnswer) -> dict[str, Any]:
    return {"status": answer.status, "results": answer.results}


def _query_and_remember(
    peer: dict,
    query: str,
    limit: int,
    local_node: dict,
    user: dict | None,
    settings: FanoutSettings,
    cache: FanoutCache,
    cache_key: str,
) -> PeerAnswer:
    """Runs on the peer pool; it caches the answer even if the window has closed."""
    try:
        answer = _query_peer(
            peer, query, limit, local_node, user, timeout_s=settings.answer_timeout_s
        )
    except Exception:
        log.debug("Peer %s search failed", peer.get("node_uid"), exc_info=True)
        return PeerAnswer(status="failed")
    if answer.status == "answered":
        has_results = any(answer.results.get(group) for group in SEARCH_GROUPS)
        ttl = settings.answer_ttl_s if has_results else settings.empty_ttl_s
        cache.set(cache_key, _cache_entry(answer), ttl)
    elif answer.status == "rate_limited":
        ttl = min(
            answer.retry_after_s or settings.max_rate_limited_ttl_s,
            settings.max_rate_limited_ttl_s,
        )
        cache.set(cache_key, _cache_entry(answer), ttl)
    return answer


def _outcome(
    peer: dict, status: PeerStatus, results: dict | None = None
) -> PeerOutcome:
    return PeerOutcome(
        node_uid=str(peer["node_uid"]),
        node_name=str(peer.get("display_name") or ""),
        status=status,
        results=results if results is not None else _empty_results(),
    )


def _cached_outcome(peer: dict, entry: Any) -> PeerOutcome | None:
    if not isinstance(entry, dict):
        return None
    if entry.get("status") == "rate_limited":
        return _outcome(peer, "rate_limited")
    if entry.get("status") != "answered" or not isinstance(entry.get("results"), dict):
        return None
    results = {
        group: list(entry["results"].get(group) or []) for group in SEARCH_GROUPS
    }
    return _outcome(peer, "cached", results)


async def stream_peer_outcomes(
    query: str,
    peers: list[dict],
    *,
    local_node: dict,
    user: dict | None,
    limit: int,
    settings: FanoutSettings = DEFAULT_SETTINGS,
    cache: FanoutCache | None = None,
) -> AsyncIterator[PeerOutcome]:
    """Yield each peer's outcome as soon as it is known, within the window.

    Cached answers come first and at once. Live peers are asked with at most
    ``max_concurrency`` in flight; each gets ``per_peer_timeout_s`` and the whole
    fan-out ``deadline_s``. A peer still pending at the deadline is reported as
    ``timed_out``; its thread keeps going and caches what it gets.
    """
    store: FanoutCache = cache if cache is not None else StoreFanoutCache()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + settings.deadline_s
    keys = {
        str(peer["node_uid"]): peer_cache_key(
            str(peer["node_uid"]), query, limit=limit, user=user
        )
        for peer in peers
    }
    cached = await asyncio.to_thread(store.get_many, list(keys.values()))

    live: list[dict] = []
    for peer in peers:
        outcome = _cached_outcome(peer, cached.get(keys[str(peer["node_uid"])]))
        if outcome is None:
            live.append(peer)
        else:
            yield outcome
    if not live:
        return

    slots = asyncio.Semaphore(max(1, settings.max_concurrency))

    async def ask(peer: dict) -> PeerOutcome:
        async with slots:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return _outcome(peer, "timed_out")
            job = loop.run_in_executor(
                _PEER_EXECUTOR,
                _query_and_remember,
                peer,
                query,
                limit,
                local_node,
                user,
                settings,
                store,
                keys[str(peer["node_uid"])],
            )
            try:
                answer = await asyncio.wait_for(
                    asyncio.shield(job),
                    timeout=min(settings.per_peer_timeout_s, remaining),
                )
            except TimeoutError:
                return _outcome(peer, "timed_out")
        if answer.status == "answered":
            return _outcome(peer, "answered", answer.results)
        return _outcome(peer, answer.status)

    tasks = {asyncio.create_task(ask(peer)): peer for peer in live}
    pending = set(tasks)
    try:
        while pending:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            done, pending = await asyncio.wait(
                pending, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                try:
                    yield task.result()
                except Exception:
                    log.debug("Peer search task failed", exc_info=True)
                    yield _outcome(tasks[task], "failed")
        for task in pending:
            task.cancel()
            yield _outcome(tasks[task], "timed_out")
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()


def _run_coroutine(coroutine_factory):
    """Run a coroutine from sync code, even if this thread already runs a loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine_factory())
    result: dict[str, Any] = {}

    def runner() -> None:
        result["value"] = asyncio.run(coroutine_factory())

    thread = threading.Thread(target=runner, name="federated-search-sync")
    thread.start()
    thread.join()
    return result["value"]


def collect_peer_outcomes(
    query: str,
    peers: list[dict],
    *,
    local_node: dict,
    user: dict | None,
    limit: int,
    settings: FanoutSettings = DEFAULT_SETTINGS,
    cache: FanoutCache | None = None,
) -> list[PeerOutcome]:
    async def collect() -> list[PeerOutcome]:
        return [
            outcome
            async for outcome in stream_peer_outcomes(
                query,
                peers,
                local_node=local_node,
                user=user,
                limit=limit,
                settings=settings,
                cache=cache,
            )
        ]

    return _run_coroutine(collect)


def federated_search(
    query: str,
    limit: int = 20,
    scope: str = "local",
    local_node: dict | None = None,
    user: dict | None = None,
) -> dict[str, Any]:
    if scope == "local":
        return search_all_hybrid(query, limit)

    local = search_all_hybrid(query, limit)
    peers = _get_approved_peers_for_search()

    if not peers:
        return _with_federation_status(local)

    if scope == "auto" and _has_strong_local_matches(local):
        return _with_federation_status(local)

    remote_results: list[dict] = []
    indexed_results = _search_local_index(query, limit, peers)
    if indexed_results:
        remote_results.extend(indexed_results)

    completed_peer_uids: set[str] = set()
    failed_peer_uids: set[str] = set()
    timed_out_peer_uids: set[str] = set()
    if local_node:
        settings = FanoutSettings(
            per_peer_timeout_s=FANOUT_DEADLINE_SECONDS,
            deadline_s=FANOUT_DEADLINE_SECONDS,
        )
        for outcome in collect_peer_outcomes(
            query,
            peers,
            local_node=local_node,
            user=user,
            limit=limit,
            settings=settings,
            cache=NullFanoutCache(),
        ):
            if outcome.answered:
                completed_peer_uids.add(outcome.node_uid)
                remote_results.append(outcome.results)
            elif outcome.status == "timed_out":
                timed_out_peer_uids.add(outcome.node_uid)
            else:
                failed_peer_uids.add(outcome.node_uid)
        if timed_out_peer_uids:
            log.info(
                "Federated search returned partial results; %d peer(s) timed out",
                len(timed_out_peer_uids),
            )
    else:
        failed_peer_uids.update(str(peer["node_uid"]) for peer in peers)

    payload = _merge_results(local, remote_results) if remote_results else local
    return _with_federation_status(
        payload,
        attempted_peers=len(peers),
        completed_peers=len(completed_peer_uids),
        failed_peer_uids=failed_peer_uids,
        timed_out_peer_uids=timed_out_peer_uids,
    )


def _with_federation_status(
    payload: dict,
    *,
    attempted_peers: int = 0,
    completed_peers: int = 0,
    failed_peer_uids: set[str] | None = None,
    timed_out_peer_uids: set[str] | None = None,
) -> dict[str, Any]:
    failed = sorted(failed_peer_uids or ())
    timed_out = sorted(timed_out_peer_uids or ())
    return {
        **payload,
        "federation": {
            "complete": not failed and not timed_out,
            "attempted_peers": attempted_peers,
            "completed_peers": completed_peers,
            "failed_peer_uids": failed,
            "timed_out_peer_uids": timed_out,
        },
    }


def _has_strong_local_matches(local: dict) -> bool:
    """Return True if local results are strong enough to skip remote fan-out."""
    total = (
        len(local.get("artists", []))
        + len(local.get("albums", []))
        + len(local.get("tracks", []))
    )
    return total >= 3


def _search_local_index(query: str, limit: int, peers: list[dict]) -> list[dict] | None:
    """Search the local federated catalog index. Returns None if no results."""
    try:
        from crate.federation.catalog import search_federated_catalog

        all_results: list[dict] = []
        for peer in peers:
            results = search_federated_catalog(
                query=query,
                entity_type="album",
                limit=limit,
                node_uid=peer["node_uid"],
            )
            if results:
                results = [
                    _normalise_index_result(r, peer=peer, entity_type="album")
                    for r in results
                ]
                all_results.append({"artists": [], "albums": results, "tracks": []})

            track_results = search_federated_catalog(
                query=query,
                entity_type="track",
                limit=limit,
                node_uid=peer["node_uid"],
            )
            if track_results:
                track_results = [
                    _normalise_index_result(r, peer=peer, entity_type="track")
                    for r in track_results
                ]
                all_results.append(
                    {"artists": [], "albums": [], "tracks": track_results}
                )

        return all_results if all_results else None
    except Exception as e:
        log.debug("Local federated index search failed: %s", e)
        return None


def _normalise_index_result(row: dict, *, peer: dict, entity_type: str) -> dict:
    from crate.federation.grants import preset_allows

    item = dict(row)
    node_uid = str(item.get("node_uid") or peer["node_uid"])
    remote_entity_uid = str(
        item.get("remote_entity_uid") or item.get("entity_uid") or ""
    )
    preset = peer.get("default_grant_preset", "discovery")

    item["origin"] = "remote"
    item["node_uid"] = node_uid
    item["node_name"] = peer["display_name"]
    item["remote_entity_uid"] = remote_entity_uid
    item["availability"] = {
        "catalog": True,
        "stream": preset_allows(preset, "stream.proxy"),
        "import": preset_allows(preset, "import.request"),
    }

    if entity_type == "album" and not item.get("name"):
        item["name"] = item.get("title") or item.get("album") or ""
    if entity_type == "artist" and not item.get("name"):
        item["name"] = item.get("title") or ""
    if entity_type == "track" and item.get("duration") is None:
        item["duration"] = item.get("duration_seconds")

    return item
