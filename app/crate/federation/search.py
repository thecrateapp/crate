"""Metadata-only remote search handler for node-to-node federation.

This module handles inbound /api/federation/v1/search requests — a peer
asks this node to search its local catalog. Results are returned in the
unified Phase 0 contract shape (origin omitted = local).
"""

from __future__ import annotations

import logging
from typing import Any

from crate.db.queries.browse_media_search import (
    search_all_hybrid,
)
from crate.federation.abuse import (
    check_rate_limit,
    peer_rate_limit_key,
    subject_rate_limit_key,
)

log = logging.getLogger(__name__)

# FED-D17: inbound search quotas, per requesting peer and per remote user. Listen
# debounces and A caches per (query, peer), so these only bite on abuse.
INBOUND_SEARCH_PER_PEER_PER_MINUTE = 120
INBOUND_SEARCH_PER_SUBJECT_PER_MINUTE = 30
INBOUND_SEARCH_WINDOW_SECONDS = 60
INBOUND_SEARCH_RETRY_AFTER_SECONDS = 10
_SEARCH_ACTION = "catalog.search"


def inbound_search_allowed(
    redis_client: Any, *, node_uid: str, subject_hash: str | None
) -> bool:
    """Count one inbound search; False once the peer or its user is over quota."""
    try:
        if not check_rate_limit(
            redis_client,
            peer_rate_limit_key(node_uid, _SEARCH_ACTION),
            INBOUND_SEARCH_PER_PEER_PER_MINUTE,
            INBOUND_SEARCH_WINDOW_SECONDS,
        ):
            return False
        if subject_hash and not check_rate_limit(
            redis_client,
            subject_rate_limit_key(node_uid, subject_hash, _SEARCH_ACTION),
            INBOUND_SEARCH_PER_SUBJECT_PER_MINUTE,
            INBOUND_SEARCH_WINDOW_SECONDS,
        ):
            return False
    except Exception:
        # The limiter protects the owner; an unreadable limiter must not turn
        # every remote search into an error.
        log.warning("Inbound search quota check failed", exc_info=True)
    return True


def handle_remote_search(
    query: str,
    limit: int = 20,
) -> dict:
    results = search_all_hybrid(query=query, limit=limit)
    return {
        "artists": results.get("artists", []),
        "albums": results.get("albums", []),
        "tracks": results.get("tracks", []),
    }
