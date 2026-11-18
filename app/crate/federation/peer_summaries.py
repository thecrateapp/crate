"""Receiver side of FED2: fetch, validate and store a peer's catalog summary."""

from __future__ import annotations

import base64
import binascii
import logging
from typing import Any, Literal

import httpx

from crate.db.repositories import federation_peer_summaries as summaries_repo
from crate.federation.summary_bloom import SUMMARY_CONTRACT, TOKENIZER, BloomFilter

log = logging.getLogger(__name__)

SUMMARY_PATH = "/api/federation/v1/catalog/summary"
SUMMARY_CAPABILITY = "catalog.summary"

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
        source_sequence = int(payload.get("source_sequence"))
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
        return "unchanged"
    if response.status_code != 200:
        return "unavailable"
    try:
        parsed = parse_summary_payload(response.json())
    except (ValueError, InvalidSummary) as exc:
        log.debug("Peer %s sent an unusable summary: %s", node_uid, exc)
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
