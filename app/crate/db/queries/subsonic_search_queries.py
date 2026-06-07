"""Search queries for the Subsonic API."""

from __future__ import annotations

from crate.db.queries.browse_media_search import (
    search_albums as search_library_albums,
)
from crate.db.queries.browse_media_search import (
    search_artists as search_library_artists,
)
from crate.db.queries.browse_media_search import (
    search_tracks as search_library_tracks,
)


def search_artists(query: str, limit: int) -> list[dict]:
    return [
        {"id": row["id"], "name": row["name"]}
        for row in search_library_artists(query, limit)
    ]


def search_albums(query: str, limit: int) -> list[dict]:
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "artist": row["artist"],
            "year": row.get("year"),
            "has_cover": row.get("has_cover"),
            "artist_id": row.get("artist_id"),
        }
        for row in search_library_albums(query, limit)
    ]


def search_tracks(query: str, limit: int) -> list[dict]:
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "artist": row["artist"],
            "album": row["album"],
            "duration": row.get("duration"),
            "path": row.get("path"),
            "format": row.get("format"),
            "bitrate": row.get("bitrate"),
            "album_id": row.get("album_id"),
            "has_cover": row.get("has_cover"),
            "artist_id": row.get("artist_id"),
        }
        for row in search_library_tracks(query, limit)
    ]


__all__ = [
    "search_albums",
    "search_artists",
    "search_tracks",
]
