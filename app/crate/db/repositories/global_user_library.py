"""User-local refs to canonical global catalog entities."""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text

from crate.db.repositories.user_library_shared import (
    emit_user_domain_event,
    utc_now_iso,
)
from crate.db.tx import read_scope, transaction_scope


USER_LIBRARY_REFS_BACKFILL_VERSION = 3


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
                    WITH canonical AS (
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
                    ), legacy_only AS (
                        SELECT
                            uf.created_at,
                            NULL::text AS global_artist_uid,
                            uf.artist_name,
                            local_artist.id AS artist_id,
                            local_artist.entity_uid::text AS artist_entity_uid,
                            local_artist.slug AS artist_slug,
                            COALESCE(local_artist.album_count, 0) AS album_count,
                            COALESCE(local_artist.track_count, 0) AS track_count,
                            COALESCE(local_artist.has_photo, 0) != 0 AS has_photo,
                            NULL::text AS photo_url
                        FROM user_follows uf
                        LEFT JOIN LATERAL (
                            SELECT candidate.*
                            FROM library_artists candidate
                            WHERE candidate.name = uf.artist_name
                               OR (
                                    lower(candidate.name) = lower(uf.artist_name)
                                    AND NOT EXISTS (
                                        SELECT 1 FROM library_artists exact
                                        WHERE exact.name = uf.artist_name
                                    )
                                    AND 1 = (
                                        SELECT COUNT(*) FROM library_artists matching
                                        WHERE lower(matching.name) = lower(uf.artist_name)
                                    )
                               )
                            ORDER BY (candidate.name = uf.artist_name) DESC
                            LIMIT 1
                        ) local_artist ON TRUE
                        LEFT JOIN global_catalog_artists global_artist
                          ON global_artist.local_artist_id = local_artist.id
                        LEFT JOIN user_global_artist_follows projected
                          ON projected.user_id = uf.user_id
                         AND projected.global_artist_uid = global_artist.global_artist_uid
                        WHERE uf.user_id = :user_id
                          AND projected.user_id IS NULL
                    )
                    SELECT * FROM canonical
                    UNION ALL
                    SELECT * FROM legacy_only
                    ORDER BY created_at DESC
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
                    WITH canonical AS (
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
                    ), legacy_only AS (
                        SELECT
                            usa.created_at AS saved_at,
                            local_album.id,
                            NULL::text AS global_album_uid,
                            NULL::text AS global_artist_uid,
                            local_album.entity_uid::text AS album_entity_uid,
                            local_album.slug,
                            local_album.artist,
                            local_artist.id AS artist_id,
                            local_artist.entity_uid::text AS artist_entity_uid,
                            local_artist.slug AS artist_slug,
                            local_album.name,
                            local_album.year,
                            COALESCE(local_album.has_cover, 0) != 0 AS has_cover,
                            COALESCE(local_album.track_count, 0) AS track_count,
                            COALESCE(local_album.total_duration, 0) AS total_duration,
                            NULL::text AS cover_url
                        FROM user_saved_albums usa
                        JOIN library_albums local_album ON local_album.id = usa.album_id
                        LEFT JOIN library_artists local_artist
                          ON local_artist.name = local_album.artist
                        LEFT JOIN global_catalog_albums global_album
                          ON global_album.local_album_id = usa.album_id
                        LEFT JOIN user_global_album_saves projected
                          ON projected.user_id = usa.user_id
                         AND projected.global_album_uid = global_album.global_album_uid
                        WHERE usa.user_id = :user_id
                          AND projected.user_id IS NULL
                    )
                    SELECT * FROM canonical
                    UNION ALL
                    SELECT * FROM legacy_only
                    ORDER BY saved_at DESC
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def mutate_global_track_like(
    user_id: int,
    *,
    liked: bool,
    global_track_uid: str | None = None,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    track_path: str | None = None,
) -> bool | None:
    """Dual-write one like while global identity is the canonical key."""
    from crate.db.repositories.user_library_shared import resolve_track_id

    supplied_global_uid = _valid_uuid(global_track_uid)
    if global_track_uid and supplied_global_uid is None:
        return None
    now = utc_now_iso()
    with transaction_scope() as session:
        local_track_id = resolve_track_id(
            session,
            track_id=track_id,
            track_entity_uid=track_entity_uid,
            track_path=track_path,
        )
        global_track = _resolve_global_track(
            session,
            global_track_uid=supplied_global_uid,
            local_track_id=local_track_id,
        )
        if global_track and local_track_id is None:
            local_track_id = global_track.get("local_track_id")
        if global_track is None and local_track_id is None:
            return None

        changed = False
        canonical_uid = str(global_track["global_track_uid"]) if global_track else None
        if liked:
            if canonical_uid:
                changed = (
                    _has_changed(
                        session.execute(
                            text(
                                """
                            INSERT INTO user_global_track_likes
                                (user_id, global_track_uid, created_at)
                            VALUES (:user_id, CAST(:global_track_uid AS uuid), :created_at)
                            ON CONFLICT DO NOTHING
                            """
                            ),
                            {
                                "user_id": user_id,
                                "global_track_uid": canonical_uid,
                                "created_at": now,
                            },
                        )
                    )
                    or changed
                )
            if local_track_id is not None:
                changed = (
                    _has_changed(
                        session.execute(
                            text(
                                """
                            INSERT INTO user_liked_tracks (user_id, track_id, created_at)
                            VALUES (:user_id, :track_id, :created_at)
                            ON CONFLICT DO NOTHING
                            """
                            ),
                            {
                                "user_id": user_id,
                                "track_id": int(local_track_id),
                                "created_at": now,
                            },
                        )
                    )
                    or changed
                )
        else:
            if canonical_uid:
                changed = (
                    _has_changed(
                        session.execute(
                            text(
                                """
                            DELETE FROM user_global_track_likes
                            WHERE user_id = :user_id
                              AND global_track_uid = CAST(:global_track_uid AS uuid)
                            """
                            ),
                            {"user_id": user_id, "global_track_uid": canonical_uid},
                        )
                    )
                    or changed
                )
            if local_track_id is not None:
                changed = (
                    _has_changed(
                        session.execute(
                            text(
                                """
                            DELETE FROM user_liked_tracks
                            WHERE user_id = :user_id AND track_id = :track_id
                            """
                            ),
                            {"user_id": user_id, "track_id": int(local_track_id)},
                        )
                    )
                    or changed
                )

        if changed:
            emit_user_domain_event(
                session,
                event_type="user.likes.changed",
                user_id=user_id,
                payload={
                    "action": "like" if liked else "unlike",
                    "global_track_uid": canonical_uid,
                    "track_id": local_track_id,
                },
            )
        return changed


def _resolve_global_track(
    session,
    *,
    global_track_uid: str | None,
    local_track_id: int | None,
) -> dict[str, Any] | None:
    if global_track_uid is None and local_track_id is None:
        return None
    row = (
        session.execute(
            text(
                """
                SELECT global_track_uid::text AS global_track_uid, local_track_id
                FROM global_catalog_tracks
                WHERE (
                    :global_track_uid IS NOT NULL
                    AND global_track_uid = CAST(:global_track_uid AS uuid)
                ) OR (
                    :global_track_uid IS NULL
                    AND local_track_id = :local_track_id
                )
                ORDER BY (:global_track_uid IS NOT NULL) DESC
                LIMIT 1
                """
            ),
            {
                "global_track_uid": global_track_uid,
                "local_track_id": local_track_id,
            },
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def _valid_uuid(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def get_user_global_library_counts(user_id: int) -> dict[str, int]:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        (
                            (SELECT COUNT(*) FROM user_global_artist_follows WHERE user_id = :uid1)
                            +
                            (
                                SELECT COUNT(*)
                                FROM user_follows uf
                                LEFT JOIN LATERAL (
                                    SELECT candidate.*
                                    FROM library_artists candidate
                                    WHERE candidate.name = uf.artist_name
                                       OR (
                                            lower(candidate.name) = lower(uf.artist_name)
                                            AND NOT EXISTS (
                                                SELECT 1 FROM library_artists exact
                                                WHERE exact.name = uf.artist_name
                                            )
                                            AND 1 = (
                                                SELECT COUNT(*) FROM library_artists matching
                                                WHERE lower(matching.name) = lower(uf.artist_name)
                                            )
                                       )
                                    ORDER BY (candidate.name = uf.artist_name) DESC
                                    LIMIT 1
                                ) local_artist ON TRUE
                                LEFT JOIN global_catalog_artists global_artist
                                  ON global_artist.local_artist_id = local_artist.id
                                LEFT JOIN user_global_artist_follows projected
                                  ON projected.user_id = uf.user_id
                                 AND projected.global_artist_uid = global_artist.global_artist_uid
                                WHERE uf.user_id = :uid1
                                  AND projected.user_id IS NULL
                            )
                        ) AS followed_artists,
                        (
                            (SELECT COUNT(*) FROM user_global_album_saves WHERE user_id = :uid2)
                            +
                            (
                                SELECT COUNT(*)
                                FROM user_saved_albums usa
                                LEFT JOIN global_catalog_albums global_album
                                  ON global_album.local_album_id = usa.album_id
                                LEFT JOIN user_global_album_saves projected
                                  ON projected.user_id = usa.user_id
                                 AND projected.global_album_uid = global_album.global_album_uid
                                WHERE usa.user_id = :uid2
                                  AND projected.user_id IS NULL
                            )
                        ) AS saved_albums,
                        (
                            (SELECT COUNT(*) FROM user_global_track_likes
                             WHERE user_id = :uid3)
                            +
                            (
                                SELECT COUNT(*)
                                FROM user_liked_tracks legacy
                                LEFT JOIN global_catalog_tracks global_track
                                  ON global_track.local_track_id = legacy.track_id
                                LEFT JOIN user_global_track_likes projected
                                  ON projected.user_id = legacy.user_id
                                 AND projected.global_track_uid = global_track.global_track_uid
                                WHERE legacy.user_id = :uid3
                                  AND projected.user_id IS NULL
                            )
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


_BACKFILL_COUNTERS = (
    "artist_follows",
    "album_saves",
    "track_likes",
    "playlist_tracks",
    "playlist_track_exclusions",
    "play_events",
    "listening_stats_users",
)


def backfill_legacy_user_library_refs() -> dict[str, int]:
    """Run the resumable user-reference backfill to completion."""
    with transaction_scope() as session:
        state = _get_catalog_state_for_backfill(session)
    rebuild_stats = (
        int(state.get("user_refs_backfill_version") or 0)
        < USER_LIBRARY_REFS_BACKFILL_VERSION
    )
    report = {name: 0 for name in _BACKFILL_COUNTERS}
    cursor: int | None = None
    while True:
        batch = backfill_legacy_user_library_refs_batch(
            batch_size=100,
            cursor=cursor,
            rebuild_listening_stats=rebuild_stats,
        )
        for name in _BACKFILL_COUNTERS:
            report[name] += int(batch[name])
        if batch["completed"]:
            break
        cursor = int(batch["next_cursor"])
    return finalize_user_library_refs_backfill(report)


def backfill_legacy_user_library_refs_batch(
    *,
    batch_size: int = 100,
    cursor: int | None = None,
    rebuild_listening_stats: bool = False,
) -> dict[str, Any]:
    """Project one bounded keyset page of users and retain every legacy row."""
    capped = max(1, min(int(batch_size or 100), 1000))
    after_user_id = max(0, int(cursor or 0))
    with transaction_scope() as session:
        candidate_user_ids = [
            int(row["user_id"])
            for row in session.execute(
                text(
                    """
                    SELECT DISTINCT user_id
                    FROM (
                        SELECT user_id FROM user_follows
                        UNION ALL SELECT user_id FROM user_saved_albums
                        UNION ALL SELECT user_id FROM user_liked_tracks
                        UNION ALL SELECT user_id FROM playlists
                        UNION ALL SELECT user_id FROM user_play_events
                    ) referenced_users
                    WHERE user_id > :after_user_id
                    ORDER BY user_id
                    LIMIT :limit
                    """
                ),
                {"after_user_id": after_user_id, "limit": capped + 1},
            )
            .mappings()
            .all()
        ]
        user_ids = candidate_user_ids[:capped]
        result: dict[str, Any] = {name: 0 for name in _BACKFILL_COUNTERS}
        if user_ids:
            params = {"user_ids": user_ids}
            result["artist_follows"] = _row_count(
                session.execute(
                    text(
                        """
                        INSERT INTO user_global_artist_follows
                            (user_id, global_artist_uid, created_at)
                        SELECT DISTINCT ON (followed.user_id, global_artist.global_artist_uid)
                            followed.user_id,
                            global_artist.global_artist_uid,
                            followed.created_at
                        FROM user_follows followed
                        JOIN LATERAL (
                            SELECT candidate.*
                            FROM library_artists candidate
                            WHERE candidate.name = followed.artist_name
                               OR (
                                    lower(candidate.name) = lower(followed.artist_name)
                                    AND NOT EXISTS (
                                        SELECT 1 FROM library_artists exact
                                        WHERE exact.name = followed.artist_name
                                    )
                                    AND 1 = (
                                        SELECT COUNT(*) FROM library_artists matching
                                        WHERE lower(matching.name) = lower(followed.artist_name)
                                    )
                               )
                            ORDER BY (candidate.name = followed.artist_name) DESC
                            LIMIT 1
                        ) local_artist ON TRUE
                        JOIN global_catalog_artists global_artist
                          ON global_artist.local_artist_id = local_artist.id
                        WHERE followed.user_id = ANY(CAST(:user_ids AS integer[]))
                        ORDER BY followed.user_id, global_artist.global_artist_uid,
                                 followed.created_at ASC
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    params,
                )
            )
            result["album_saves"] = _row_count(
                session.execute(
                    text(
                        """
                        INSERT INTO user_global_album_saves
                            (user_id, global_album_uid, created_at)
                        SELECT DISTINCT ON (saved.user_id, global_album.global_album_uid)
                            saved.user_id, global_album.global_album_uid, saved.created_at
                        FROM user_saved_albums saved
                        JOIN global_catalog_albums global_album
                          ON global_album.local_album_id = saved.album_id
                        WHERE saved.user_id = ANY(CAST(:user_ids AS integer[]))
                        ORDER BY saved.user_id, global_album.global_album_uid,
                                 saved.created_at ASC
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    params,
                )
            )
            result["track_likes"] = _row_count(
                session.execute(
                    text(
                        """
                        INSERT INTO user_global_track_likes
                            (user_id, global_track_uid, created_at)
                        SELECT DISTINCT ON (liked.user_id, global_track.global_track_uid)
                            liked.user_id,
                            global_track.global_track_uid,
                            liked.created_at
                        FROM user_liked_tracks liked
                        JOIN global_catalog_tracks global_track
                          ON global_track.local_track_id = liked.track_id
                        WHERE liked.user_id = ANY(CAST(:user_ids AS integer[]))
                        ORDER BY liked.user_id, global_track.global_track_uid,
                                 liked.created_at ASC
                        ON CONFLICT (user_id, global_track_uid) DO UPDATE
                        SET created_at = LEAST(
                            user_global_track_likes.created_at,
                            EXCLUDED.created_at
                        )
                        """
                    ),
                    params,
                )
            )
            session.execute(
                text(
                    """
                    INSERT INTO user_global_track_like_repairs
                        (user_id, legacy_track_id, created_at, status, reason,
                         last_attempt_at)
                    SELECT liked.user_id, liked.track_id, liked.created_at,
                           'unresolved', 'global_track_not_found', NOW()
                    FROM user_liked_tracks liked
                    WHERE liked.user_id = ANY(CAST(:user_ids AS integer[]))
                      AND NOT EXISTS (
                          SELECT 1 FROM global_catalog_tracks global_track
                          WHERE global_track.local_track_id = liked.track_id
                      )
                    ON CONFLICT (user_id, legacy_track_id) DO UPDATE
                    SET last_attempt_at = NOW(), status = 'unresolved'
                    """
                ),
                params,
            )
            session.execute(
                text(
                    """
                    UPDATE user_global_track_like_repairs repair
                    SET status = 'resolved', resolved_at = NOW(), last_attempt_at = NOW()
                    WHERE repair.user_id = ANY(CAST(:user_ids AS integer[]))
                      AND EXISTS (
                          SELECT 1
                          FROM global_catalog_tracks global_track
                          WHERE global_track.local_track_id = repair.legacy_track_id
                      )
                    """
                ),
                params,
            )
            result["playlist_tracks"] = _row_count(
                session.execute(
                    text(
                        """
                        UPDATE playlist_tracks playlist_track
                        SET global_track_uid = global_track.global_track_uid
                        FROM global_catalog_tracks global_track, playlists playlist
                        WHERE playlist_track.global_track_uid IS NULL
                          AND playlist.id = playlist_track.playlist_id
                          AND playlist.user_id = ANY(CAST(:user_ids AS integer[]))
                          AND (
                            global_track.local_track_id = playlist_track.track_id
                            OR (
                                playlist_track.track_entity_uid IS NOT NULL
                                AND global_track.local_track_entity_uid = playlist_track.track_entity_uid
                            )
                          )
                        """
                    ),
                    params,
                )
            )
            result["playlist_track_exclusions"] = _row_count(
                session.execute(
                    text(
                        """
                        UPDATE playlist_track_exclusions exclusion
                        SET global_track_uid = global_track.global_track_uid
                        FROM global_catalog_tracks global_track, playlists playlist
                        WHERE exclusion.global_track_uid IS NULL
                          AND playlist.id = exclusion.playlist_id
                          AND playlist.user_id = ANY(CAST(:user_ids AS integer[]))
                          AND (
                            global_track.local_track_id = exclusion.track_id
                            OR (
                                exclusion.track_entity_uid IS NOT NULL
                                AND global_track.local_track_entity_uid = exclusion.track_entity_uid
                            )
                          )
                        """
                    ),
                    params,
                )
            )
            play_events = session.execute(
                text(
                    """
                    UPDATE user_play_events event
                    SET global_track_uid = global_track.global_track_uid
                    FROM global_catalog_tracks global_track
                    WHERE event.global_track_uid IS NULL
                      AND event.user_id = ANY(CAST(:user_ids AS integer[]))
                      AND (
                        global_track.local_track_id = event.track_id
                        OR (
                            event.track_entity_uid IS NOT NULL
                            AND global_track.local_track_entity_uid = event.track_entity_uid
                        )
                      )
                    """
                ),
                params,
            )
            result["play_events"] = _row_count(play_events)
            if rebuild_listening_stats or result["play_events"] > 0:
                from crate.db.repositories.user_library_aggregate_runner import (
                    recompute_user_listening_aggregates_in_session,
                )

                listening_user_ids = [
                    int(row["user_id"])
                    for row in session.execute(
                        text(
                            """
                            SELECT DISTINCT user_id
                            FROM user_play_events
                            WHERE user_id = ANY(CAST(:user_ids AS integer[]))
                              AND global_track_uid IS NOT NULL
                            """
                        ),
                        params,
                    )
                    .mappings()
                    .all()
                ]
                for user_id in listening_user_ids:
                    recompute_user_listening_aggregates_in_session(session, user_id)
                result["listening_stats_users"] = len(listening_user_ids)

    completed = len(candidate_user_ids) <= capped
    result.update(
        {
            "users_processed": len(user_ids),
            "completed": completed,
            "next_cursor": None if completed else user_ids[-1],
        }
    )
    return result


def finalize_user_library_refs_backfill(report: dict[str, int]) -> dict[str, int]:
    """Persist the aggregate report only after every user batch completed."""
    with transaction_scope() as session:
        unresolved = _unresolved_user_reference_counts(session)
        result = {
            **{name: int(report.get(name) or 0) for name in _BACKFILL_COUNTERS},
            **{f"unresolved_{name}": count for name, count in unresolved.items()},
        }
        session.execute(
            text(
                """
                UPDATE global_catalog_state
                SET
                    user_refs_backfilled_at = NOW(),
                    user_refs_backfill_version = :backfill_version,
                    user_refs_backfill_report_json = CAST(:report AS jsonb),
                    updated_at = NOW()
                WHERE singleton = TRUE
                """
            ),
            {
                "backfill_version": USER_LIBRARY_REFS_BACKFILL_VERSION,
                "report": json.dumps(result),
            },
        )
    return result


def project_local_artist_follow(session, *, user_id: int, artist_name: str) -> None:
    """Keep the canonical projection current for legacy local follow writes."""
    session.execute(
        text(
            """
            INSERT INTO user_global_artist_follows
                (user_id, global_artist_uid, created_at)
            SELECT followed.user_id, global_artist.global_artist_uid, followed.created_at
            FROM user_follows followed
            JOIN LATERAL (
                SELECT candidate.*
                FROM library_artists candidate
                WHERE candidate.name = followed.artist_name
                   OR (
                        lower(candidate.name) = lower(followed.artist_name)
                        AND NOT EXISTS (
                            SELECT 1 FROM library_artists exact
                            WHERE exact.name = followed.artist_name
                        )
                        AND 1 = (
                            SELECT COUNT(*) FROM library_artists matching
                            WHERE lower(matching.name) = lower(followed.artist_name)
                        )
                   )
                ORDER BY (candidate.name = followed.artist_name) DESC
                LIMIT 1
            ) local_artist ON TRUE
            JOIN global_catalog_artists global_artist
              ON global_artist.local_artist_id = local_artist.id
            WHERE followed.user_id = :user_id
              AND lower(followed.artist_name) = lower(:artist_name)
            ON CONFLICT DO NOTHING
            """
        ),
        {"user_id": user_id, "artist_name": artist_name},
    )


def remove_projected_local_artist_follow(
    session, *, user_id: int, artist_name: str
) -> None:
    session.execute(
        text(
            """
            DELETE FROM user_global_artist_follows followed
            USING library_artists local_artist, global_catalog_artists global_artist
            WHERE followed.user_id = :user_id
              AND global_artist.global_artist_uid = followed.global_artist_uid
              AND global_artist.local_artist_id = local_artist.id
              AND lower(local_artist.name) = lower(:artist_name)
            """
        ),
        {"user_id": user_id, "artist_name": artist_name},
    )


def project_local_album_save(session, *, user_id: int, album_id: int) -> None:
    """Keep the canonical projection current for legacy local album saves."""
    session.execute(
        text(
            """
            INSERT INTO user_global_album_saves
                (user_id, global_album_uid, created_at)
            SELECT saved.user_id, global_album.global_album_uid, saved.created_at
            FROM user_saved_albums saved
            JOIN global_catalog_albums global_album
              ON global_album.local_album_id = saved.album_id
            WHERE saved.user_id = :user_id
              AND saved.album_id = :album_id
            ON CONFLICT DO NOTHING
            """
        ),
        {"user_id": user_id, "album_id": album_id},
    )


def remove_projected_local_album_save(session, *, user_id: int, album_id: int) -> None:
    session.execute(
        text(
            """
            DELETE FROM user_global_album_saves saved
            USING global_catalog_albums global_album
            WHERE saved.user_id = :user_id
              AND saved.global_album_uid = global_album.global_album_uid
              AND global_album.local_album_id = :album_id
            """
        ),
        {"user_id": user_id, "album_id": album_id},
    )


def _get_catalog_state_for_backfill(session) -> dict[str, Any]:
    session.execute(
        text(
            """
            INSERT INTO global_catalog_state (singleton, status, generation)
            VALUES (TRUE, 'cold', gen_random_uuid())
            ON CONFLICT (singleton) DO NOTHING
            """
        )
    )
    row = (
        session.execute(
            text(
                """
            SELECT user_refs_backfill_version
            FROM global_catalog_state
            WHERE singleton = TRUE
            """
            )
        )
        .mappings()
        .one()
    )
    return dict(row)


def _unresolved_user_reference_counts(session) -> dict[str, int]:
    counts = (
        session.execute(
            text(
                """
            SELECT
                (
                    SELECT COUNT(*)
                    FROM user_follows uf
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM library_artists local_artist
                        JOIN global_catalog_artists global_artist
                          ON global_artist.local_artist_id = local_artist.id
                        WHERE local_artist.name = uf.artist_name
                           OR (
                                lower(local_artist.name) = lower(uf.artist_name)
                                AND NOT EXISTS (
                                    SELECT 1 FROM library_artists exact
                                    WHERE exact.name = uf.artist_name
                                )
                                AND 1 = (
                                    SELECT COUNT(*) FROM library_artists matching
                                    WHERE lower(matching.name) = lower(uf.artist_name)
                                )
                           )
                    )
                ) AS artist_follows,
                (
                    SELECT COUNT(*)
                    FROM user_saved_albums saved
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM global_catalog_albums global_album
                        WHERE global_album.local_album_id = saved.album_id
                    )
                ) AS album_saves,
                (
                    SELECT COUNT(*)
                    FROM user_liked_tracks liked
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM global_catalog_tracks global_track
                        WHERE global_track.local_track_id = liked.track_id
                    )
                ) AS track_likes,
                (SELECT COUNT(*) FROM playlist_tracks WHERE global_track_uid IS NULL) AS playlist_tracks,
                (
                    SELECT COUNT(*)
                    FROM playlist_track_exclusions
                    WHERE global_track_uid IS NULL
                ) AS playlist_track_exclusions,
                (SELECT COUNT(*) FROM user_play_events WHERE global_track_uid IS NULL) AS play_events
            """
            )
        )
        .mappings()
        .one()
    )
    return {key: int(value or 0) for key, value in dict(counts).items()}


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
    return _row_count(result) > 0


def _row_count(result: Any) -> int:
    return max(0, int(getattr(result, "rowcount", 0) or 0))


__all__ = [
    "USER_LIBRARY_REFS_BACKFILL_VERSION",
    "backfill_legacy_user_library_refs",
    "backfill_legacy_user_library_refs_batch",
    "finalize_user_library_refs_backfill",
    "follow_global_artist",
    "get_user_global_library_counts",
    "is_global_album_saved",
    "is_global_artist_followed",
    "list_global_collection_albums",
    "list_global_collection_artists",
    "list_user_global_album_saves",
    "list_user_global_artist_follows",
    "mutate_global_track_like",
    "project_local_album_save",
    "project_local_artist_follow",
    "remove_projected_local_album_save",
    "remove_projected_local_artist_follow",
    "save_global_album",
    "unfollow_global_artist",
    "unsave_global_album",
]
