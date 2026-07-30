from __future__ import annotations

from crate.db.repositories.global_user_library import (
    list_recent_global_collection_artists,
)


def _build_recent_global_artists(limit: int = 10) -> list[dict]:
    return [
        {
            "id": row.get("artist_id"),
            "global_artist_uid": row.get("global_artist_uid"),
            "entity_uid": row.get("artist_entity_uid"),
            "slug": row.get("artist_slug"),
            "name": row.get("artist_name"),
            "album_count": row.get("album_count"),
            "track_count": row.get("track_count"),
            "has_photo": bool(row.get("has_photo")),
            "photo_url": row.get("photo_url"),
        }
        for row in list_recent_global_collection_artists(limit)
        if row.get("artist_name")
    ]


__all__ = ["_build_recent_global_artists"]
