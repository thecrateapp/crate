"""Local-library search shared by legacy and canonical HTTP routes."""

from __future__ import annotations

from crate.api.browse_shared import fs_search, has_library_data
from crate.db.cache_store import get_cache, set_cache
from crate.db.queries.browse_media_search import search_all_hybrid
from crate.metrics import record_later


def search_local_library(query: str, limit: int = 20) -> dict[str, list[dict]]:
    normalized = str(query or "").strip()
    capped_limit = max(1, min(int(limit or 20), 50))
    if len(normalized) < 2:
        return {"artists": [], "albums": [], "tracks": []}

    cache_key = f"listen:search:local:v3:{normalized.lower()}:{capped_limit}"
    cached = get_cache(cache_key, max_age_seconds=30)
    if cached is not None:
        return cached

    if has_library_data():
        payload = search_all_hybrid(normalized, capped_limit)
    else:
        payload = dict(fs_search(normalized))
        payload["tracks"] = []

    record_later("search.hybrid.results.artists", len(payload["artists"]))
    record_later("search.hybrid.results.albums", len(payload["albums"]))
    record_later("search.hybrid.results.tracks", len(payload["tracks"]))
    set_cache(cache_key, payload, ttl=45)
    return payload


__all__ = ["search_local_library"]
