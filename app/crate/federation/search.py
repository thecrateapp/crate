"""Metadata-only remote search handler for node-to-node federation.

This module handles inbound /api/federation/v1/search requests — a peer
asks this node to search its local catalog. Results are returned in the
unified Phase 0 contract shape (origin omitted = local).
"""

from __future__ import annotations

import logging
import math
import time
import uuid
from typing import Any

from crate.db.queries.browse_media_search import (
    search_all_hybrid,
)
from crate.federation.abuse import (
    peer_rate_limit_key,
    subject_rate_limit_key,
)

log = logging.getLogger(__name__)

# FED-D17: inbound search quotas, per requesting peer and per remote user. Listen
# debounces and A caches per (query, peer), so these only bite on abuse.
INBOUND_SEARCH_PER_PEER_PER_MINUTE = 120
INBOUND_SEARCH_PER_SUBJECT_PER_MINUTE = 30
INBOUND_SEARCH_WINDOW_SECONDS = 60
_SEARCH_ACTION = "catalog.search"


def _window_wait(redis_client: Any, key: str, limit: int, now: float) -> int | None:
    """Seconds until the window has room, or None when it has room now.

    Rejected requests are not counted, so a peer that waits as told gets in.
    """
    window = INBOUND_SEARCH_WINDOW_SECONDS
    redis_client.zremrangebyscore(key, 0, now - window)
    if int(redis_client.zcard(key) or 0) < limit:
        return None
    oldest = redis_client.zrange(key, 0, 0, withscores=True)
    if not oldest:
        return window
    return max(1, math.ceil(float(oldest[0][1]) + window - now))


def inbound_search_wait(
    redis_client: Any, *, node_uid: str, subject_hash: str | None
) -> int | None:
    """Count one inbound search; the Retry-After seconds when over quota."""
    keys = [
        (
            peer_rate_limit_key(node_uid, _SEARCH_ACTION),
            INBOUND_SEARCH_PER_PEER_PER_MINUTE,
        )
    ]
    if subject_hash:
        keys.append(
            (
                subject_rate_limit_key(node_uid, subject_hash, _SEARCH_ACTION),
                INBOUND_SEARCH_PER_SUBJECT_PER_MINUTE,
            )
        )
    now = time.time()
    try:
        for key, limit in keys:
            wait = _window_wait(redis_client, key, limit, now)
            if wait is not None:
                return wait
        member = f"{now}:{uuid.uuid4().hex}"
        for key, _limit in keys:
            redis_client.zadd(key, {member: now})
            redis_client.expire(key, INBOUND_SEARCH_WINDOW_SECONDS + 10)
    except Exception:
        # The limiter protects the owner; an unreadable limiter must not turn
        # every remote search into an error.
        log.warning("Inbound search quota check failed", exc_info=True)
    return None


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
