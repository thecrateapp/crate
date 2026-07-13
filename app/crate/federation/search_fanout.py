"""Federated search fan-out — parallel peer search with local merge.

Phase 2: live fan-out to trusted peers. Results use the unified Phase 0
contract (origin fields in the same arrays as local results).
"""

from __future__ import annotations

import concurrent.futures
import logging

from crate.db.queries.browse_media_search import search_all_hybrid
from crate.db.repositories import federation as repo
from crate.federation.client import (
    SEARCH_TIMEOUT,
    federated_post,
)

log = logging.getLogger(__name__)

MAX_CONCURRENT_PEERS = 2
DEFAULT_PEER_SEARCH_TIMEOUT_MS = 600


def _search_one_peer(
    peer: dict,
    query: str,
    limit: int,
    local_node: dict,
    user: dict | None = None,
) -> dict | None:
    """Fan out a search to one peer. Returns remote results or None on failure."""
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
        resp = federated_post(
            base_url=peer["api_base_url"],
            path="/api/federation/v1/search",
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            json_body={"q": query, "limit": limit},
            timeout=SEARCH_TIMEOUT,
            user_assertion=user_assertion,
        )
        if resp.status_code == 200:
            data = resp.json()
            return _tag_remote_results(
                data=data,
                peer=peer,
            )
        else:
            log.debug("Peer %s returned %d", peer["node_uid"], resp.status_code)
            return None
    except Exception as e:
        log.debug("Peer %s search failed: %s", peer["node_uid"], e)
        return None


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


def _get_approved_peers_for_search() -> list[dict]:
    """Return approved peers that should receive search queries."""
    peers = repo.list_peers(trust_state="approved")
    return [p for p in peers if p.get("disabled_at") is None]


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


def federated_search(
    query: str,
    limit: int = 20,
    scope: str = "local",
    local_node: dict | None = None,
    user: dict | None = None,
) -> dict:
    if scope == "local":
        return search_all_hybrid(query, limit)

    local = search_all_hybrid(query, limit)
    peers = _get_approved_peers_for_search()

    if not peers:
        return local

    if scope == "auto" and _has_strong_local_matches(local):
        return local

    remote_results: list[dict] = []
    indexed_results = _search_local_index(query, limit, peers)
    if indexed_results:
        remote_results.extend(indexed_results)

    # Live fan-out
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(MAX_CONCURRENT_PEERS, len(peers))
    ) as executor:
        futures = {}
        for peer in peers:
            if not local_node:
                break
            future = executor.submit(
                _search_one_peer,
                peer=peer,
                query=query,
                limit=limit,
                local_node=local_node,
                user=user,
            )
            futures[future] = peer

        for future in concurrent.futures.as_completed(futures, timeout=2.0):
            try:
                result = future.result(timeout=1.0)
                if result:
                    remote_results.append(result)
            except Exception as e:
                log.debug("Peer search future failed: %s", e)

    if not remote_results:
        return local

    return _merge_results(local, remote_results)


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
