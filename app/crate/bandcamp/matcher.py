from __future__ import annotations

from typing import Any

from crate.db.repositories.bandcamp import (
    get_exact_bandcamp_library_candidates,
    upsert_bandcamp_library_match,
)


def create_matches_for_bandcamp_item(
    bandcamp_item_id: int,
    *,
    session=None,
) -> list[dict[str, Any]]:
    """Create high-confidence Bandcamp matches for obvious local entities."""
    candidates = get_exact_bandcamp_library_candidates(
        bandcamp_item_id, session=session
    )
    if not candidates:
        return []

    item = candidates["item"] or {}
    artist_name = str(item.get("artist_name") or "").strip()
    album_title = str(item.get("album_title") or "").strip()
    created: list[dict[str, Any]] = []

    artist = candidates["artist"]
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
                session=session,
            )
        )

    album = candidates["album"]
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
                session=session,
            )
        )

    return created
