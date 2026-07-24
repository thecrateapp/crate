"""Compatibility facade for global content cache persistence."""

from crate.db.repositories.global_content_cache import (
    cache_key_for_selection,
    get_cached_blob_facet,
    get_cached_json_facet,
    invalidate_source_cache,
    store_blob_facet,
    store_json_facet,
)

__all__ = [
    "cache_key_for_selection",
    "get_cached_blob_facet",
    "get_cached_json_facet",
    "invalidate_source_cache",
    "store_blob_facet",
    "store_json_facet",
]
