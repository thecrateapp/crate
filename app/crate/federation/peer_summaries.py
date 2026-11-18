"""Receiver side of FED2: fetch, validate and store a peer's catalog summary."""

from __future__ import annotations

import base64
import binascii
import logging
import threading
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from crate.db.repositories import federation_peer_summaries as summaries_repo
from crate.federation.summary_bloom import (
    SUMMARY_CONTRACT,
    TOKENIZER,
    BloomFilter,
    artist_key,
    query_probe_terms,
)

log = logging.getLogger(__name__)

SUMMARY_PATH = "/api/federation/v1/catalog/summary"
SUMMARY_CAPABILITY = "catalog.summary"
# Twice the 900 s poll: a summary neither re-fetched nor confirmed (304, or the
# same etag announced in the delta feed) for this long no longer routes.
PEER_SUMMARY_MAX_AGE_S = 1800

RefreshResult = Literal["updated", "unchanged", "unavailable"]


class InvalidSummary(ValueError):
    """The peer's summary does not match the contract this node understands."""


def peer_advertises_summary(peer: dict) -> bool:
    """True only when the peer lists the summary capability; unknown means no."""
    capabilities = peer.get("capabilities_json")
    if isinstance(capabilities, dict):
        return bool(capabilities.get(SUMMARY_CAPABILITY))
    if isinstance(capabilities, (list, tuple)):
        return SUMMARY_CAPABILITY in capabilities
    return False


def parse_summary_payload(payload: dict) -> dict:
    """Validate a summary body and return the fields to store."""
    if not isinstance(payload, dict):
        raise InvalidSummary("summary is not an object")
    if payload.get("contract") != SUMMARY_CONTRACT:
        raise InvalidSummary("unknown summary contract")
    params = payload.get("params")
    if not isinstance(params, dict) or params.get("tokenizer") != TOKENIZER:
        raise InvalidSummary("unsupported summary tokenizer")
    etag = payload.get("etag")
    if not isinstance(etag, str) or not etag:
        raise InvalidSummary("summary is missing its etag")
    counts = payload.get("artist_album_counts")
    if not isinstance(counts, dict):
        raise InvalidSummary("summary is missing artist_album_counts")
    try:
        source_sequence = int(payload["source_sequence"])
        bloom = base64.b64decode(str(payload.get("bloom") or ""), validate=True)
        BloomFilter.from_bytes(bloom, m=int(params["m"]), k=int(params["k"]))
    except (TypeError, ValueError, KeyError, binascii.Error) as exc:
        raise InvalidSummary("summary bloom or params are malformed") from exc
    return {
        "contract": SUMMARY_CONTRACT,
        "params": params,
        "bloom": bloom,
        "artist_album_counts": {str(k): int(v) for k, v in counts.items()},
        "source_sequence": source_sequence,
        "etag": etag,
    }


def refresh_peer_summary(
    peer: dict, local_node: dict, *, known_etag: str | None
) -> RefreshResult:
    """Conditional signed GET of the peer's summary; store it when it changed."""
    from crate.federation.client import federated_get

    node_uid = str(peer["node_uid"])
    headers = {"If-None-Match": f'"{known_etag}"'} if known_etag else None
    try:
        response = federated_get(
            base_url=peer["api_base_url"],
            path=SUMMARY_PATH,
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            headers=headers,
        )
    except (httpx.HTTPError, ValueError) as exc:
        log.debug("Peer summary fetch failed for %s: %s", node_uid, exc)
        return "unavailable"
    if response.status_code == 304:
        summaries_repo.touch_peer_summary(node_uid)
        return "unchanged"
    if response.status_code in (403, 404):
        # The peer no longer shares a summary with us: stop routing on the old one.
        summaries_repo.delete_peer_summary(node_uid)
        return "unavailable"
    if response.status_code != 200:
        # Transient (5xx, 429): keep the row; it ages out after the max age.
        return "unavailable"
    try:
        parsed = parse_summary_payload(response.json())
    except ValueError as exc:  # InvalidSummary or a body that is not JSON
        log.debug("Peer %s sent an unusable summary: %s", node_uid, exc)
        summaries_repo.delete_peer_summary(node_uid)
        return "unavailable"
    summaries_repo.upsert_peer_summary(node_uid, **parsed)
    return "updated"


def fetch_peer_summaries(peers: list[dict], local_node: dict) -> dict[str, Any]:
    """Refresh every eligible peer that advertises a summary."""
    from crate.federation.search_fanout import eligible_search_peers

    targets = [p for p in eligible_search_peers(peers) if peer_advertises_summary(p)]
    etags = (
        summaries_repo.list_peer_summary_etags([str(p["node_uid"]) for p in targets])
        if targets
        else {}
    )
    counts = {"updated": 0, "unchanged": 0, "unavailable": 0}
    for peer in targets:
        try:
            result = refresh_peer_summary(
                peer, local_node, known_etag=etags.get(str(peer["node_uid"]))
            )
        except Exception:
            log.debug("Peer summary refresh crashed", exc_info=True)
            result = "unavailable"
        counts[result] += 1
    return {"peers": len(targets), **counts}


@dataclass(frozen=True)
class PeerSummary:
    node_uid: str
    etag: str
    bloom: BloomFilter
    artist_album_counts: dict[str, int]

    def may_match(self, query: str) -> bool:
        """False only when the filter proves the query cannot match this peer."""
        probes = query_probe_terms(query)
        if probes is None:
            return True
        return all(term in self.bloom for term in probes)

    def album_count(self, artist_name: str) -> int | None:
        key = artist_key(artist_name)
        if key is None:
            return None
        return self.artist_album_counts.get(key)


_CACHE_LIMIT = 64
_SUMMARY_CACHE: dict[tuple[str, str], PeerSummary] = {}
_CACHE_LOCK = threading.Lock()


def _build_summary(row: dict) -> PeerSummary:
    params = row["params"]
    return PeerSummary(
        node_uid=str(row["node_uid"]),
        etag=str(row["etag"]),
        bloom=BloomFilter.from_bytes(
            bytes(row["bloom"]), m=int(params["m"]), k=int(params["k"])
        ),
        artist_album_counts=dict(row.get("artist_album_counts") or {}),
    )


def load_peer_summaries(node_uids: list[str]) -> dict[str, PeerSummary]:
    """Fresh stored summaries of the peers; bodies load only for new etags.

    A summary older than PEER_SUMMARY_MAX_AGE_S is ignored, so the peer is asked.
    """
    etags = summaries_repo.list_peer_summary_etags(
        node_uids, max_age_s=PEER_SUMMARY_MAX_AGE_S
    )
    with _CACHE_LOCK:
        missing = [
            uid for uid, etag in etags.items() if (uid, etag) not in _SUMMARY_CACHE
        ]
    if missing:
        for row in summaries_repo.get_peer_summaries(missing):
            try:
                summary = _build_summary(row)
            except Exception:
                log.debug("Peer summary could not be built", exc_info=True)
                continue
            with _CACHE_LOCK:
                _SUMMARY_CACHE[(summary.node_uid, summary.etag)] = summary
                while len(_SUMMARY_CACHE) > _CACHE_LIMIT:
                    _SUMMARY_CACHE.pop(next(iter(_SUMMARY_CACHE)))
    with _CACHE_LOCK:
        return {
            uid: _SUMMARY_CACHE[(uid, etag)]
            for uid, etag in etags.items()
            if (uid, etag) in _SUMMARY_CACHE
        }
