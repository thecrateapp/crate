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
                SELECT
                    ult.track_id,
                    lt.entity_uid AS track_entity_uid,
                    ult.created_at AS liked_at,
                    lt.path,
                    lt.title,
                    lt.artist,
                    ar.id AS artist_id,
                    ar.entity_uid::text AS artist_entity_uid,
                    ar.slug AS artist_slug,
                    lt.album,
                    alb.id AS album_id,
                    alb.entity_uid::text AS album_entity_uid,
                    alb.slug AS album_slug,
                    lt.duration,
                    lt.bpm,
                    lt.audio_key,
                    lt.audio_scale,
                    lt.energy,
                    lt.danceability,
                    lt.valence,
                    lt.bliss_vector
                FROM user_liked_tracks ult
                JOIN library_tracks lt ON lt.id = ult.track_id
                LEFT JOIN library_albums alb ON alb.id = lt.album_id
                LEFT JOIN library_artists ar ON ar.name = lt.artist
                WHERE ult.user_id = :user_id
                ORDER BY ult.created_at DESC
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
