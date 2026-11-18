"""Owner-side catalog summaries: one Bloom filter per distinct sharing scope.

Runs in the worker only. Requests never build a summary; they serve the stored
row. Rows are keyed on the scope digest, so peers with equal scopes share one.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass
from typing import Any

from crate.db.jobs.federation_catalog_changes import catalog_high_water_mark
from crate.db.jobs.federation_catalog_summaries import (
    delete_catalog_summaries_except,
    upsert_catalog_summary,
)
from crate.db.queries.federation_catalog_summaries import list_catalog_summary_heads
from crate.db.queries.federation_manifest import list_federation_manifest_rows
from crate.db.repositories import federation as repo
from crate.federation.catalog_scope import (
    catalog_policy_params,
    catalog_scope_digest,
    peer_search_policy,
)
from crate.federation.summary_bloom import (
    MIN_PREFIX,
    SUMMARY_CONTRACT,
    SUMMARY_HASH,
    TOKENIZER,
    BloomFilter,
    artist_key,
    summary_terms,
)


@dataclass(frozen=True)
class BuiltSummary:
    scope_digest: str
    contract: str
    params: dict
    bloom: bytes
    artist_album_counts: dict[str, int]
    entry_count: int
    source_sequence: int
    etag: str


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _iter_rows(policy_params: dict, page_size: int) -> Iterator[dict]:
    after_type, after_uid = "", ""
    while True:
        rows = list_federation_manifest_rows(
            after_entity_type=after_type,
            after_entity_uid=after_uid,
            limit=page_size,
            policy_params=policy_params,
        )
        yield from rows
        if len(rows) < page_size:
            return
        after_type = str(rows[-1]["entity_type"])
        after_uid = str(rows[-1]["remote_entity_uid"])


def _row_texts(row: dict) -> tuple[Any, ...]:
    kind = row.get("entity_type")
    if kind == "artist":
        return (row.get("title"),)
    if kind == "album":
        return (row.get("title"), row.get("artist"))
    return (row.get("title"), row.get("artist"), row.get("album"))


def build_scope_summary(
    policy_params: dict,
    *,
    scope_digest: str,
    source_sequence: int,
    page_size: int = 5000,
) -> BuiltSummary:
    # Pass 1 sizes the filter from the distinct term count; pass 2 fills it.
    terms: set[str] = set()
    for row in _iter_rows(policy_params, page_size):
        terms |= summary_terms(*_row_texts(row))
    bloom = BloomFilter.sized(len(terms))
    for term in sorted(terms):
        bloom.add(term)

    counts: dict[str, int] = {}
    entry_count = 0
    for row in _iter_rows(policy_params, page_size):
        entry_count += 1
        if row.get("entity_type") == "album":
            key = artist_key(row.get("artist"))
            if key:
                counts[key] = counts.get(key, 0) + 1

    bits = bloom.to_bytes()
    params = bloom.params
    etag = hashlib.sha256(
        SUMMARY_CONTRACT.encode() + _canonical(params) + bits + _canonical(counts)
    ).hexdigest()
    return BuiltSummary(
        scope_digest=scope_digest,
        contract=SUMMARY_CONTRACT,
        params=params,
        bloom=bits,
        artist_album_counts=counts,
        entry_count=entry_count,
        source_sequence=source_sequence,
        etag=etag,
    )


def _live_scopes() -> dict[str, dict]:
    scopes: dict[str, dict] = {}
    for peer in repo.list_peers(trust_state="approved"):
        if peer.get("disabled_at") or not peer.get("node_uid"):
            continue
        policy = peer_search_policy(peer)
        if policy is None:
            continue
        scopes.setdefault(catalog_scope_digest(policy), policy)
    return scopes


def _head_is_current(head: dict, sequence: int) -> bool:
    """Same contract, catalog sequence and wire format as this build would make.

    A summary in an older format (tokenizer, hash, min_prefix) is rebuilt even
    when the catalog is unchanged: receivers reject it.
    """
    return (
        head["contract"] == SUMMARY_CONTRACT
        and int(head["source_sequence"]) == sequence
        and head.get("tokenizer") == TOKENIZER
        and head.get("hash") == SUMMARY_HASH
        and head.get("min_prefix") == MIN_PREFIX
    )


def refresh_catalog_summaries(*, should_stop: Callable[[], bool] | None = None) -> dict:
    """Rebuild stale scope summaries and drop the ones no peer uses any more."""
    scopes = _live_scopes()
    sequence = catalog_high_water_mark()
    heads = {h["scope_digest"]: h for h in list_catalog_summary_heads()}
    built = skipped = 0
    stopped = False
    for digest, policy in scopes.items():
        if should_stop is not None and should_stop():
            stopped = True
            break
        head = heads.get(digest)
        if head and _head_is_current(head, sequence):
            skipped += 1
            continue
        summary = build_scope_summary(
            catalog_policy_params(policy),
            scope_digest=digest,
            source_sequence=sequence,
        )
        upsert_catalog_summary(asdict(summary))
        built += 1
    deleted = 0 if stopped else delete_catalog_summaries_except(list(scopes))
    result = {
        "scopes": len(scopes),
        "built": built,
        "skipped": skipped,
        "deleted": deleted,
    }
    if stopped:
        result["stopped"] = True
    return result
