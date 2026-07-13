"""Artwork source selection for canonical global catalog entities."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope
from crate.federation.global_source_resolver import (
    GlobalEntityNotFound,
    NoGlobalSource,
    resolve_global_source,
)


class GlobalAlbumNotFound(Exception):
    """Raised when a canonical album UID does not exist."""


class GlobalArtistNotFound(Exception):
    """Raised when a canonical artist UID does not exist."""


class NoArtworkSource(Exception):
    """Raised when a canonical album has no artwork-capable source."""


class NoArtistPhotoSource(Exception):
    """Raised when a canonical artist has no photo-capable source."""


class NoArtistBackgroundSource(Exception):
    """Raised when a canonical artist has no background-capable source."""


def resolve_global_artist_background(global_artist_uid: str) -> dict[str, Any]:
    try:
        selection = resolve_global_source(
            global_entity_uid=global_artist_uid,
            entity_type="artist",
            facet="artist_background",
        )
    except GlobalEntityNotFound:
        raise GlobalArtistNotFound(global_artist_uid) from None
    except NoGlobalSource:
        raise NoArtistBackgroundSource(global_artist_uid) from None

    if selection["kind"] == "local":
        return {
            "kind": "local",
            "local_artist_id": selection["local_id"],
            "local_artist_entity_uid": selection["local_entity_uid"],
        }
    return {
        "kind": "remote",
        "node_uid": selection["node_uid"],
        "remote_entity_uid": selection["remote_entity_uid"],
        "entity_type": selection["entity_type"],
        "global_entity_uid": selection["global_entity_uid"],
        "source_revision": selection["source_revision"],
        "facet": selection["facet"],
        "facet_payload": selection["facet_payload"],
    }


def resolve_global_artist_photo(global_artist_uid: str) -> dict[str, Any]:
    try:
        selection = resolve_global_source(
            global_entity_uid=global_artist_uid,
            entity_type="artist",
            facet="artist_photo",
        )
    except GlobalEntityNotFound:
        raise GlobalArtistNotFound(global_artist_uid) from None
    except NoGlobalSource:
        raise NoArtistPhotoSource(global_artist_uid) from None

    if selection["kind"] == "local":
        return {
            "kind": "local",
            "local_artist_id": selection["local_id"],
            "local_artist_entity_uid": selection["local_entity_uid"],
        }
    return {
        "kind": "remote",
        "node_uid": selection["node_uid"],
        "remote_entity_uid": selection["remote_entity_uid"],
        "entity_type": selection["entity_type"],
        "global_entity_uid": selection["global_entity_uid"],
        "source_revision": selection["source_revision"],
        "facet": selection["facet"],
        "facet_payload": selection["facet_payload"],
    }


def resolve_global_album_artwork(global_album_uid: str) -> dict[str, Any]:
    try:
        selection = resolve_global_source(
            global_entity_uid=global_album_uid,
            entity_type="album",
            facet="album_artwork",
        )
    except GlobalEntityNotFound:
        raise GlobalAlbumNotFound(global_album_uid) from None
    except NoGlobalSource:
        raise NoArtworkSource(global_album_uid) from None

    if selection["kind"] == "local":
        return {
            "kind": "local",
            "local_album_id": selection["local_id"],
            "local_album_entity_uid": selection["local_entity_uid"],
        }
    return {
        "kind": "remote",
        "node_uid": selection["node_uid"],
        "remote_entity_uid": selection["remote_entity_uid"],
        "entity_type": selection["entity_type"],
        "global_entity_uid": selection["global_entity_uid"],
        "source_revision": selection["source_revision"],
        "facet": selection["facet"],
        "facet_payload": selection["facet_payload"],
    }


def _resolve_global_album_artwork_legacy(global_album_uid: str) -> dict[str, Any]:
    with read_scope() as session:
        exists = session.execute(
            text(
                """
                SELECT 1
                FROM global_catalog_albums
                WHERE global_album_uid = :global_album_uid
                """
            ),
            {"global_album_uid": global_album_uid},
        ).first()
        if not exists:
            raise GlobalAlbumNotFound(global_album_uid)

        local = (
            session.execute(
                text(
                    """
                    SELECT
                        COALESCE(s.local_id, a.local_album_id) AS local_album_id,
                        COALESCE(
                            s.local_entity_uid::text,
                            a.local_album_entity_uid::text
                        ) AS local_album_entity_uid
                    FROM global_catalog_albums a
                    LEFT JOIN global_catalog_sources s
                      ON s.global_entity_uid = a.global_album_uid
                     AND s.entity_type = 'album'
                     AND s.source_kind = 'local'
                     AND NOT s.source_stale
                     AND s.source_deleted_at IS NULL
                    WHERE a.global_album_uid = :global_album_uid
                      AND a.has_cover
                      AND (
                        s.local_id IS NOT NULL
                        OR s.local_entity_uid IS NOT NULL
                        OR a.local_album_id IS NOT NULL
                        OR a.local_album_entity_uid IS NOT NULL
                      )
                    ORDER BY
                        COALESCE(s.preferred_for_artwork, true) DESC,
                        s.updated_at DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {"global_album_uid": global_album_uid},
            )
            .mappings()
            .first()
        )
        if local:
            return {
                "kind": "local",
                "local_album_id": local["local_album_id"],
                "local_album_entity_uid": local["local_album_entity_uid"],
            }

        remote = (
            session.execute(
                text(
                    """
                    SELECT
                        node_uid::text AS node_uid,
                        remote_entity_uid
                    FROM global_catalog_sources
                    WHERE entity_type = 'album'
                      AND global_entity_uid = :global_album_uid
                      AND source_kind = 'federated'
                      AND node_uid IS NOT NULL
                      AND remote_entity_uid IS NOT NULL
                      AND NOT source_stale
                      AND source_deleted_at IS NULL
                    ORDER BY
                        preferred_for_artwork DESC,
                        match_confidence DESC,
                        updated_at DESC,
                        id ASC
                    LIMIT 1
                    """
                ),
                {"global_album_uid": global_album_uid},
            )
            .mappings()
            .first()
        )
        if remote:
            return {
                "kind": "remote",
                "node_uid": remote["node_uid"],
                "remote_entity_uid": remote["remote_entity_uid"],
            }

    raise NoArtworkSource(global_album_uid)


__all__ = [
    "GlobalAlbumNotFound",
    "GlobalArtistNotFound",
    "NoArtistBackgroundSource",
    "NoArtworkSource",
    "NoArtistPhotoSource",
    "resolve_global_artist_background",
    "resolve_global_artist_photo",
    "resolve_global_album_artwork",
]
