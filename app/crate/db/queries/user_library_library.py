from __future__ import annotations

from sqlalchemy import text

from crate.db.repositories.global_user_library import (
    get_user_global_library_counts,
    list_user_global_album_saves,
    list_user_global_artist_follows,
)
from crate.db.queries.user_library_shared import relative_track_path
from crate.db.tx import read_scope


def get_followed_artists(user_id: int) -> list[dict]:
    """Return canonical follows, retaining unresolved legacy rows as fallbacks."""
    return list_user_global_artist_follows(user_id)


def get_saved_albums(user_id: int) -> list[dict]:
    """Return canonical saves, retaining unresolved legacy rows as fallbacks."""
    return list_user_global_album_saves(user_id)


def is_following(user_id: int, artist_name: str) -> bool:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT 1
                    FROM user_global_artist_follows followed
                    JOIN global_catalog_artists artist
                      ON artist.global_artist_uid = followed.global_artist_uid
                    WHERE followed.user_id = :user_id
                      AND lower(artist.canonical_name) = lower(:artist_name)
                    UNION ALL
                    SELECT 1
                    FROM user_follows
                    WHERE user_id = :user_id
                      AND lower(artist_name) = lower(:artist_name)
                    LIMIT 1
                    """
                ),
                {"user_id": user_id, "artist_name": artist_name},
            )
            .mappings()
            .first()
        )
    return row is not None


def is_album_saved(user_id: int, album_id: int) -> bool:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT 1 FROM user_saved_albums WHERE user_id = :user_id AND album_id = :album_id"
                ),
                {"user_id": user_id, "album_id": album_id},
            )
            .mappings()
            .first()
        )
    return row is not None


def get_liked_tracks(user_id: int, limit: int = 100) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    WITH canonical AS (
                        SELECT
                            liked.created_at AS liked_at,
                            track.global_track_uid::text AS global_track_uid,
                            local_track.id AS track_id,
                            local_track.entity_uid::text AS track_entity_uid,
                            local_track.path,
                            track.canonical_title AS title,
                            track.artist_name AS artist,
                            global_artist.local_artist_id AS artist_id,
                            global_artist.local_artist_entity_uid::text AS artist_entity_uid,
                            global_artist.public_slug AS artist_slug,
                            track.album_name AS album,
                            global_album.local_album_id AS album_id,
                            global_album.local_album_entity_uid::text AS album_entity_uid,
                            global_album.public_slug AS album_slug,
                            COALESCE(local_track.duration, track.duration_seconds, 0) AS duration,
                            local_track.bpm,
                            local_track.audio_key,
                            local_track.audio_scale,
                            local_track.energy,
                            local_track.danceability,
                            local_track.valence,
                            local_track.bliss_vector,
                            track.has_local,
                            track.has_remote,
                            track.availability_json
                        FROM user_global_track_likes liked
                        JOIN global_catalog_tracks track
                          ON track.global_track_uid = liked.global_track_uid
                        LEFT JOIN library_tracks local_track
                          ON local_track.id = track.local_track_id
                        LEFT JOIN global_catalog_albums global_album
                          ON global_album.global_album_uid = track.global_album_uid
                        LEFT JOIN global_catalog_artists global_artist
                          ON global_artist.global_artist_uid = track.global_artist_uid
                        WHERE liked.user_id = :user_id
                    ), legacy_only AS (
                        SELECT
                            legacy.created_at AS liked_at,
                            NULL::text AS global_track_uid,
                            local_track.id AS track_id,
                            local_track.entity_uid::text AS track_entity_uid,
                            local_track.path,
                            local_track.title,
                            local_track.artist,
                            local_artist.id AS artist_id,
                            local_artist.entity_uid::text AS artist_entity_uid,
                            local_artist.slug AS artist_slug,
                            local_track.album,
                            local_album.id AS album_id,
                            local_album.entity_uid::text AS album_entity_uid,
                            local_album.slug AS album_slug,
                            local_track.duration,
                            local_track.bpm,
                            local_track.audio_key,
                            local_track.audio_scale,
                            local_track.energy,
                            local_track.danceability,
                            local_track.valence,
                            local_track.bliss_vector,
                            true AS has_local,
                            false AS has_remote,
                            jsonb_build_object('local', true, 'remote', false) AS availability_json
                        FROM user_liked_tracks legacy
                        JOIN library_tracks local_track ON local_track.id = legacy.track_id
                        LEFT JOIN library_albums local_album
                          ON local_album.id = local_track.album_id
                        LEFT JOIN library_artists local_artist
                          ON lower(local_artist.name) = lower(local_track.artist)
                        LEFT JOIN global_catalog_tracks global_track
                          ON global_track.local_track_id = legacy.track_id
                        LEFT JOIN user_global_track_likes projected
                          ON projected.user_id = legacy.user_id
                         AND projected.global_track_uid = global_track.global_track_uid
                        WHERE legacy.user_id = :user_id
                          AND projected.user_id IS NULL
                    )
                    SELECT * FROM canonical
                    UNION ALL
                    SELECT * FROM legacy_only
                    ORDER BY liked_at DESC
                    LIMIT :lim
                    """
                ),
                {"user_id": user_id, "lim": limit},
            )
            .mappings()
            .all()
        )
    payload = [dict(row) for row in rows]
    for item in payload:
        if item.get("track_entity_uid") is not None:
            item["track_entity_uid"] = str(item["track_entity_uid"])
        if item.get("artist_entity_uid") is not None:
            item["artist_entity_uid"] = str(item["artist_entity_uid"])
        if item.get("album_entity_uid") is not None:
            item["album_entity_uid"] = str(item["album_entity_uid"])
        if item.get("bliss_vector") is not None:
            item["bliss_vector"] = list(item["bliss_vector"])
        item["relative_path"] = relative_track_path(item.get("path") or "")
        availability = item.get("availability_json") or {}
        if not isinstance(availability, dict):
            availability = {}
        has_local = bool(item.pop("has_local", False))
        has_remote = bool(item.pop("has_remote", False))
        item["availability"] = {
            **availability,
            "catalog": bool(availability.get("catalog", has_local or has_remote)),
            "stream": bool(availability.get("stream", has_local or has_remote)),
            "import": bool(availability.get("import", has_remote)),
            "local": has_local,
            "remote": has_remote,
        }
        item.pop("availability_json", None)
    return payload


def is_track_liked(user_id: int, track_id: int) -> bool:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT 1 FROM user_liked_tracks WHERE user_id = :user_id AND track_id = :track_id"
                ),
                {"user_id": user_id, "track_id": track_id},
            )
            .mappings()
            .first()
        )
    return row is not None


def get_user_library_counts(user_id: int) -> dict:
    return get_user_global_library_counts(user_id)


__all__ = [
    "get_followed_artists",
    "get_liked_tracks",
    "get_saved_albums",
    "get_user_library_counts",
    "is_album_saved",
    "is_following",
    "is_track_liked",
]
