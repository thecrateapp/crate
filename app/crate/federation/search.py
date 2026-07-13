"""Metadata-only remote search handler for node-to-node federation.

This module handles inbound /api/federation/v1/search requests — a peer
asks this node to search its local catalog. Results are returned in the
unified Phase 0 contract shape (origin omitted = local).
"""

from __future__ import annotations

import logging

from crate.db.queries.browse_media_search import (
    search_all_hybrid,
)

log = logging.getLogger(__name__)


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
