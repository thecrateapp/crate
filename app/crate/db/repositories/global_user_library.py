"""User-local refs to canonical global catalog entities."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.repositories.user_library_shared import (
    emit_user_domain_event,
    utc_now_iso,
)
from crate.db.tx import read_scope, transaction_scope


def list_global_collection_artists(limit: int = 500) -> list[dict[str, Any]]:
    capped = max(1, min(int(limit or 500), 2000))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        a.global_artist_uid::text AS global_artist_uid,
                        a.canonical_name AS artist_name,
                        a.local_artist_id AS artist_id,
                        a.local_artist_entity_uid::text AS artist_entity_uid,
                        la.slug AS artist_slug,
                        a.updated_at AS created_at,
                        COALESCE(album_counts.album_count, 0) AS album_count,
                        COALESCE(track_counts.track_count, 0) AS track_count,
                        a.has_photo,
                        CASE WHEN a.has_photo THEN
                            '/api/catalog/artists/' || a.global_artist_uid::text || '/photo'
                        ELSE NULL END AS photo_url,
                        a.has_local,
                        a.has_remote,
                        a.availability_json
                    FROM global_catalog_artists a
                    LEFT JOIN library_artists la ON la.id = a.local_artist_id
                    LEFT JOIN (
                        SELECT global_artist_uid, COUNT(*) AS album_count
                        FROM global_catalog_albums
                        GROUP BY global_artist_uid
                    ) album_counts ON album_counts.global_artist_uid = a.global_artist_uid
                    LEFT JOIN (
                        SELECT global_artist_uid, COUNT(*) AS track_count
                        FROM global_catalog_tracks
                        GROUP BY global_artist_uid
                    ) track_counts ON track_counts.global_artist_uid = a.global_artist_uid
                    ORDER BY a.has_local DESC, a.has_remote DESC, a.canonical_name ASC
                    LIMIT :limit
                    """
                ),
                {"limit": capped},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def list_global_collection_albums(limit: int = 500) -> list[dict[str, Any]]:
    capped = max(1, min(int(limit or 500), 2000))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        a.updated_at AS saved_at,
                        a.local_album_id AS id,
                        a.global_album_uid::text AS global_album_uid,
                        a.global_artist_uid::text AS global_artist_uid,
                        a.local_album_entity_uid::text AS album_entity_uid,
                        la.slug,
                        a.artist_name AS artist,
                        art.local_artist_id AS artist_id,
                        art.local_artist_entity_uid::text AS artist_entity_uid,
                        lar.slug AS artist_slug,
                        a.canonical_name AS name,
                        a.year,
                        a.has_cover,
                        COALESCE(a.track_count, track_counts.track_count, 0) AS track_count,
                        COALESCE(a.total_duration_seconds, track_counts.total_duration, 0) AS total_duration,
                        CASE WHEN a.has_cover THEN
                            '/api/catalog/albums/' || a.global_album_uid::text || '/cover'
                        ELSE NULL END AS cover_url,
                        a.has_local,
                        a.has_remote,
                        a.availability_json
                    FROM global_catalog_albums a
                    LEFT JOIN library_albums la ON la.id = a.local_album_id
                    LEFT JOIN global_catalog_artists art
                      ON art.global_artist_uid = a.global_artist_uid
                    LEFT JOIN library_artists lar ON lar.id = art.local_artist_id
                    LEFT JOIN (
                        SELECT
                            global_album_uid,
                            COUNT(*) AS track_count,
                            COALESCE(SUM(duration_seconds), 0) AS total_duration
                        FROM global_catalog_tracks
                        GROUP BY global_album_uid
                    ) track_counts ON track_counts.global_album_uid = a.global_album_uid
                    ORDER BY a.has_local DESC, a.year DESC NULLS LAST,
                             a.artist_name ASC, a.canonical_name ASC
                    LIMIT :limit
                    """
                ),
                {"limit": capped},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def list_user_global_artist_follows(user_id: int) -> list[dict[str, Any]]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        f.created_at,
                        a.global_artist_uid::text AS global_artist_uid,
                        a.canonical_name AS artist_name,
                        a.local_artist_id AS artist_id,
                        a.local_artist_entity_uid::text AS artist_entity_uid,
                        la.slug AS artist_slug,
                        COALESCE(album_counts.album_count, 0) AS album_count,
                        COALESCE(track_counts.track_count, 0) AS track_count,
                        a.has_photo,
                        CASE WHEN a.has_photo THEN
                            '/api/catalog/artists/' || a.global_artist_uid::text || '/photo'
                        ELSE NULL END AS photo_url
                    FROM user_global_artist_follows f
                    JOIN global_catalog_artists a
                      ON a.global_artist_uid = f.global_artist_uid
                    LEFT JOIN library_artists la ON la.id = a.local_artist_id
                    LEFT JOIN (
                        SELECT global_artist_uid, COUNT(*) AS album_count
                        FROM global_catalog_albums
                        GROUP BY global_artist_uid
                    ) album_counts ON album_counts.global_artist_uid = a.global_artist_uid
                    LEFT JOIN (
                        SELECT global_artist_uid, COUNT(*) AS track_count
                        FROM global_catalog_tracks
                        GROUP BY global_artist_uid
                    ) track_counts ON track_counts.global_artist_uid = a.global_artist_uid
                    WHERE f.user_id = :user_id
                    ORDER BY f.created_at DESC
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def list_user_global_album_saves(user_id: int) -> list[dict[str, Any]]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        s.created_at AS saved_at,
                        a.local_album_id AS id,
                        a.global_album_uid::text AS global_album_uid,
                        a.global_artist_uid::text AS global_artist_uid,
                        a.local_album_entity_uid::text AS album_entity_uid,
                        la.slug,
                        a.artist_name AS artist,
                        art.local_artist_id AS artist_id,
                        art.local_artist_entity_uid::text AS artist_entity_uid,
                        lar.slug AS artist_slug,
                        a.canonical_name AS name,
                        a.year,
                        a.has_cover,
                        COALESCE(a.track_count, 0) AS track_count,
                        COALESCE(a.total_duration_seconds, 0) AS total_duration,
                        CASE WHEN a.has_cover THEN
                            '/api/catalog/albums/' || a.global_album_uid::text || '/cover'
                        ELSE NULL END AS cover_url
                    FROM user_global_album_saves s
                    JOIN global_catalog_albums a
                      ON a.global_album_uid = s.global_album_uid
                    LEFT JOIN library_albums la ON la.id = a.local_album_id
                    LEFT JOIN global_catalog_artists art
                      ON art.global_artist_uid = a.global_artist_uid
                    LEFT JOIN library_artists lar ON lar.id = art.local_artist_id
                    WHERE s.user_id = :user_id
                    ORDER BY s.created_at DESC
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_user_global_library_counts(user_id: int) -> dict[str, int]:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        (
                            SELECT COUNT(*)
                            FROM user_global_artist_follows
                            WHERE user_id = :uid1
                        ) AS followed_artists,
                        (
                            SELECT COUNT(*)
                            FROM user_global_album_saves
                            WHERE user_id = :uid2
                        ) AS saved_albums,
                        (
                            SELECT COUNT(*)
                            FROM user_liked_tracks
                            WHERE user_id = :uid3
                        ) AS liked_tracks,
                        (
                            SELECT COUNT(*)
                            FROM playlists
                            WHERE user_id = :uid4
                        ) AS playlists
                    """
                ),
                {"uid1": user_id, "uid2": user_id, "uid3": user_id, "uid4": user_id},
            )
            .mappings()
            .first()
        )
    return {key: int(value or 0) for key, value in dict(row or {}).items()}


def follow_global_artist(user_id: int, global_artist_uid: str) -> bool:
    now = utc_now_iso()
    with transaction_scope() as session:
        artist = _get_global_artist(session, global_artist_uid)
        if not artist:
            return False
        result = session.execute(
            text(
                """
                INSERT INTO user_global_artist_follows
                    (user_id, global_artist_uid, created_at)
                VALUES
                    (:user_id, :global_artist_uid, :created_at)
                ON CONFLICT DO NOTHING
                """
            ),
            {
                "user_id": user_id,
                "global_artist_uid": global_artist_uid,
                "created_at": now,
            },
        )
        changed = _has_changed(result)
        if artist.get("local_artist_id") is not None:
            session.execute(
                text(
                    """
                    INSERT INTO user_follows (user_id, artist_name, created_at)
                    VALUES (:user_id, :artist_name, :created_at)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {
                    "user_id": user_id,
                    "artist_name": artist["canonical_name"],
                    "created_at": now,
                },
            )
        if changed:
            emit_user_domain_event(
                session,
                event_type="user.follows.changed",
                user_id=user_id,
                payload={
                    "action": "follow",
                    "global_artist_uid": global_artist_uid,
                    "artist_name": artist["canonical_name"],
                },
            )
        return changed


def unfollow_global_artist(user_id: int, global_artist_uid: str) -> bool:
    with transaction_scope() as session:
        artist = _get_global_artist(session, global_artist_uid)
        result = session.execute(
            text(
                """
                DELETE FROM user_global_artist_follows
                WHERE user_id = :user_id
                  AND global_artist_uid = :global_artist_uid
                """
            ),
            {"user_id": user_id, "global_artist_uid": global_artist_uid},
        )
        changed = _has_changed(result)
        if artist and artist.get("local_artist_id") is not None:
            session.execute(
                text(
                    """
                    DELETE FROM user_follows
                    WHERE user_id = :user_id
                      AND artist_name = :artist_name
                    """
                ),
                {"user_id": user_id, "artist_name": artist["canonical_name"]},
            )
        if changed:
            emit_user_domain_event(
                session,
                event_type="user.follows.changed",
                user_id=user_id,
                payload={
                    "action": "unfollow",
                    "global_artist_uid": global_artist_uid,
                },
            )
        return changed


def is_global_artist_followed(user_id: int, global_artist_uid: str) -> bool:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT 1
                    FROM user_global_artist_follows
                    WHERE user_id = :user_id
                      AND global_artist_uid = :global_artist_uid
                    """
                ),
                {"user_id": user_id, "global_artist_uid": global_artist_uid},
            )
            .mappings()
            .first()
        )
    return row is not None


def save_global_album(user_id: int, global_album_uid: str) -> bool:
    now = utc_now_iso()
    with transaction_scope() as session:
        album = _get_global_album(session, global_album_uid)
        if not album:
            return False
        result = session.execute(
            text(
                """
                INSERT INTO user_global_album_saves
                    (user_id, global_album_uid, created_at)
                VALUES
                    (:user_id, :global_album_uid, :created_at)
                ON CONFLICT DO NOTHING
                """
            ),
            {
                "user_id": user_id,
                "global_album_uid": global_album_uid,
                "created_at": now,
            },
        )
        changed = _has_changed(result)
        if album.get("local_album_id") is not None:
            session.execute(
                text(
                    """
                    INSERT INTO user_saved_albums (user_id, album_id, created_at)
                    VALUES (:user_id, :album_id, :created_at)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {
                    "user_id": user_id,
                    "album_id": album["local_album_id"],
                    "created_at": now,
                },
            )
        if changed:
            emit_user_domain_event(
                session,
                event_type="user.saved_albums.changed",
                user_id=user_id,
                payload={"action": "save", "global_album_uid": global_album_uid},
            )
        return changed


def unsave_global_album(user_id: int, global_album_uid: str) -> bool:
    with transaction_scope() as session:
        album = _get_global_album(session, global_album_uid)
        result = session.execute(
            text(
                """
                DELETE FROM user_global_album_saves
                WHERE user_id = :user_id
                  AND global_album_uid = :global_album_uid
                """
            ),
            {"user_id": user_id, "global_album_uid": global_album_uid},
        )
        changed = _has_changed(result)
        if album and album.get("local_album_id") is not None:
            session.execute(
                text(
                    """
                    DELETE FROM user_saved_albums
                    WHERE user_id = :user_id
                      AND album_id = :album_id
                    """
                ),
                {"user_id": user_id, "album_id": album["local_album_id"]},
            )
        if changed:
            emit_user_domain_event(
                session,
                event_type="user.saved_albums.changed",
                user_id=user_id,
                payload={"action": "unsave", "global_album_uid": global_album_uid},
            )
        return changed


def is_global_album_saved(user_id: int, global_album_uid: str) -> bool:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT 1
                    FROM user_global_album_saves
                    WHERE user_id = :user_id
                      AND global_album_uid = :global_album_uid
                    """
                ),
                {"user_id": user_id, "global_album_uid": global_album_uid},
            )
            .mappings()
            .first()
        )
    return row is not None


def _get_global_artist(session, global_artist_uid: str) -> dict[str, Any] | None:
    row = (
        session.execute(
            text(
                """
                SELECT
                    global_artist_uid::text AS global_artist_uid,
                    canonical_name,
                    local_artist_id
                FROM global_catalog_artists
                WHERE global_artist_uid = :global_artist_uid
                """
            ),
            {"global_artist_uid": global_artist_uid},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def _get_global_album(session, global_album_uid: str) -> dict[str, Any] | None:
    row = (
        session.execute(
            text(
                """
                SELECT
                    global_album_uid::text AS global_album_uid,
                    canonical_name,
                    local_album_id
                FROM global_catalog_albums
                WHERE global_album_uid = :global_album_uid
                """
            ),
            {"global_album_uid": global_album_uid},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def _has_changed(result: Any) -> bool:
    return int(getattr(result, "rowcount", 0) or 0) > 0


__all__ = [
    "follow_global_artist",
    "get_user_global_library_counts",
    "is_global_album_saved",
    "is_global_artist_followed",
    "list_global_collection_albums",
    "list_global_collection_artists",
    "list_user_global_album_saves",
    "list_user_global_artist_follows",
    "save_global_album",
    "unfollow_global_artist",
    "unsave_global_album",
]
