"""Compatibility facade for global catalog source queries."""

from crate.db.queries.global_catalog_sources import (
    get_local_source,
    get_remote_source,
    iter_local_album_sources,
    iter_local_artist_sources,
    iter_local_sources,
    iter_local_track_sources,
    iter_remote_sources,
)

__all__ = [
    "get_local_source",
    "get_remote_source",
    "iter_local_album_sources",
    "iter_local_artist_sources",
    "iter_local_sources",
    "iter_local_track_sources",
    "iter_remote_sources",
]
