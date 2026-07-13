from __future__ import annotations

from crate.db.queries.home import get_recent_global_artist_rows
from crate.db.repositories.global_user_library import list_global_collection_artists
from crate.federation.global_policy import global_catalog_surface_enabled


def _build_recent_global_artists(limit: int = 10) -> list[dict]:
    if global_catalog_surface_enabled("home"):
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
            for row in list_global_collection_artists(limit)
            if row.get("artist_name")
        ]

    return [
        {
            "id": row.get("id"),
            "slug": row.get("slug"),
            "name": row.get("name"),
            "album_count": row.get("album_count"),
            "track_count": row.get("track_count"),
            "has_photo": bool(row.get("has_photo")),
        }
        for row in get_recent_global_artist_rows(limit)
        if row.get("name")
    ]


__all__ = ["_build_recent_global_artists"]
