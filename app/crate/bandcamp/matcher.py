from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.repositories.bandcamp import upsert_bandcamp_library_match
from crate.db.tx import optional_scope


def create_matches_for_bandcamp_item(
    bandcamp_item_id: int,
    *,
    session=None,
) -> list[dict[str, Any]]:
    """Create high-confidence Bandcamp matches for obvious local entities."""
    with optional_scope(session) as s:
        item = (
            s.execute(
                text("""
                SELECT *
                FROM bandcamp_items
                WHERE id = :bandcamp_item_id
                """),
                {"bandcamp_item_id": bandcamp_item_id},
            )
            .mappings()
            .first()
        )
        if not item:
            return []

        artist_name = str(item.get("artist_name") or "").strip()
        album_title = str(item.get("album_title") or "").strip()
        created: list[dict[str, Any]] = []

        if artist_name:
            artist = (
                s.execute(
                    text("""
                    SELECT entity_uid::text AS entity_uid, name
                    FROM library_artists
                    WHERE entity_uid IS NOT NULL
                      AND lower(name) = lower(:artist_name)
                    LIMIT 1
                    """),
                    {"artist_name": artist_name},
                )
                .mappings()
                .first()
            )
            if artist:
                created.append(
                    upsert_bandcamp_library_match(
                        bandcamp_item_id=bandcamp_item_id,
                        entity_type="artist",
                        entity_uid=str(artist["entity_uid"]),
                        confidence=0.92,
                        status="confirmed",
                        source="sync",
                        evidence={
                            "artist_name": artist_name,
                            "match": "exact_artist_name",
                        },
                        session=s,
                    )
                )

        if artist_name and album_title:
            album = (
                s.execute(
                    text("""
                    SELECT entity_uid::text AS entity_uid, artist, name
                    FROM library_albums
                    WHERE entity_uid IS NOT NULL
                      AND lower(artist) = lower(:artist_name)
                      AND lower(name) = lower(:album_title)
                    LIMIT 1
                    """),
                    {"artist_name": artist_name, "album_title": album_title},
                )
                .mappings()
                .first()
            )
            if album:
                created.append(
                    upsert_bandcamp_library_match(
                        bandcamp_item_id=bandcamp_item_id,
                        entity_type="album",
                        entity_uid=str(album["entity_uid"]),
                        confidence=0.98,
                        status="confirmed",
                        source="sync",
                        evidence={
                            "artist_name": artist_name,
                            "album_title": album_title,
                            "match": "exact_artist_album",
                        },
                        session=s,
                    )
                )

        return created
