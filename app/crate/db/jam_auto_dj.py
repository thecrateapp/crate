"""Database reads used by the detached Jam Room Auto DJ."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import text

from crate.db.queries.playable_media_filters import (
    playable_media_params,
    playable_track_clause,
)
from crate.db.tx import read_scope


def list_detached_auto_dj_rooms() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM jam_rooms
                    WHERE status = 'active' AND queue_mode = 'auto_dj'
                    ORDER BY created_at ASC
                    """
                )
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def list_recent_auto_dj_artists(room_id: str, *, limit: int = 8) -> list[str]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        LOWER(q.track_payload->>'artist') AS artist,
                        MAX(COALESCE(q.completed_at, q.created_at)) AS last_played_at
                    FROM jam_room_queue_items q
                    WHERE q.room_id = :room_id
                      AND q.status = 'played'
                      AND q.track_payload->>'artist' IS NOT NULL
                    GROUP BY LOWER(q.track_payload->>'artist')
                    ORDER BY last_played_at DESC NULLS LAST
                    LIMIT :limit
                    """
                ),
                {"room_id": room_id, "limit": limit},
            )
            .scalars()
            .all()
        )
    return [str(row) for row in rows if row]


def list_recent_auto_dj_tracks(room_id: str, *, limit: int = 128) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT track_payload
                    FROM jam_room_queue_items
                    WHERE room_id = :room_id
                      AND status = 'played'
                    ORDER BY completed_at DESC NULLS LAST, created_at DESC
                    LIMIT :limit
                    """
                ),
                {"room_id": room_id, "limit": limit},
            )
            .scalars()
            .all()
        )
    return [dict(row) for row in rows if isinstance(row, dict)]


def list_auto_dj_candidates(
    room_id: str,
    *,
    genre_filters: Sequence[str] = (),
    limit: int = 80,
) -> list[dict]:
    filters = [
        str(value).strip().casefold() for value in genre_filters if str(value).strip()
    ]
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                    SELECT
                        t.id AS track_id,
                        t.entity_uid::text AS track_entity_uid,
                        t.path AS track_path,
                        COALESCE(t.title, t.filename) AS title,
                        t.artist,
                        t.album,
                        t.album_id,
                        a.entity_uid::text AS album_entity_uid,
                        t.duration,
                        t.bpm,
                        t.energy,
                        t.danceability,
                        t.valence,
                        t.bliss_vector,
                        COALESCE(t.lastfm_playcount, 0)
                            + COALESCE(pref.play_count, 0)
                            + COALESCE(instance_stats.play_count, 0) AS popularity,
                        COALESCE(instance_stats.play_count, 0) AS instance_play_count,
                        COALESCE(room_history.play_count, 0) AS room_plays,
                        ARRAY_REMOVE(
                            ARRAY_AGG(DISTINCT LOWER(g.name)) || ARRAY[t.genre, a.genre],
                            NULL
                        ) AS genres
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    LEFT JOIN artist_genres ag ON ag.artist_name = t.artist
                    LEFT JOIN genres g ON g.id = ag.genre_id
                    LEFT JOIN (
                        SELECT uts.track_id, SUM(uts.play_count)::int AS play_count
                        FROM user_track_stats uts
                        JOIN jam_room_members members ON members.user_id = uts.user_id
                        WHERE members.room_id = :room_id
                          AND uts.stat_window IN ('30d', '90d', 'all_time')
                          AND uts.track_id IS NOT NULL
                        GROUP BY uts.track_id
                    ) pref ON pref.track_id = t.id
                    LEFT JOIN (
                        SELECT
                            uts.track_id,
                            COALESCE(
                                NULLIF(SUM(CASE WHEN uts.stat_window = '30d' THEN uts.play_count ELSE 0 END), 0),
                                NULLIF(SUM(CASE WHEN uts.stat_window = '90d' THEN uts.play_count ELSE 0 END), 0),
                                SUM(CASE WHEN uts.stat_window = 'all_time' THEN uts.play_count ELSE 0 END),
                                0
                            )::int AS play_count
                        FROM user_track_stats uts
                        WHERE uts.track_id IS NOT NULL
                          AND uts.stat_window IN ('30d', '90d', 'all_time')
                        GROUP BY uts.track_id
                    ) instance_stats ON instance_stats.track_id = t.id
                    LEFT JOIN (
                        SELECT
                            q.track_payload->>'id' AS track_id,
                            q.track_payload->>'path' AS track_path,
                            COUNT(*)::int AS play_count
                        FROM jam_room_queue_items q
                        WHERE q.room_id = :room_id AND q.status = 'played'
                        GROUP BY q.track_payload->>'id', q.track_payload->>'path'
                    ) room_history
                      ON room_history.track_id = t.id::text OR room_history.track_path = t.path
                    WHERE {playable_track_clause("t", "a")}
                      AND NOT EXISTS (
                          SELECT 1
                          FROM jam_room_queue_items queued
                          WHERE queued.room_id = :room_id
                            AND queued.status IN ('queued', 'playing')
                            AND (
                                queued.track_payload->>'id' = t.id::text
                                OR queued.track_payload->>'path' = t.path
                            )
                      )
                      AND (
                          cardinality(CAST(:genre_filters AS text[])) = 0
                          OR LOWER(COALESCE(t.genre, '')) = ANY(CAST(:genre_filters AS text[]))
                          OR LOWER(COALESCE(a.genre, '')) = ANY(CAST(:genre_filters AS text[]))
                          OR EXISTS (
                              SELECT 1
                              FROM artist_genres selected_ag
                              JOIN genres selected_g ON selected_g.id = selected_ag.genre_id
                              WHERE selected_ag.artist_name = t.artist
                                AND LOWER(selected_g.name) = ANY(CAST(:genre_filters AS text[]))
                          )
                      )
                    GROUP BY
                        t.id, t.entity_uid, t.path, t.title, t.filename, t.artist, t.album,
                        t.album_id, a.entity_uid, t.duration, t.bpm, t.energy, t.danceability,
                        t.valence, t.bliss_vector, t.lastfm_playcount, pref.play_count,
                        room_history.play_count, room_history.track_id, room_history.track_path,
                        instance_stats.play_count,
                        t.genre, a.genre
                    ORDER BY COALESCE(room_history.play_count, 0) ASC,
                             COALESCE(pref.play_count, 0) DESC,
                             COALESCE(t.lastfm_playcount, 0) DESC,
                             t.id ASC
                    LIMIT :limit
                    """
                ),
                {
                    "room_id": room_id,
                    "genre_filters": filters,
                    "limit": limit,
                    **playable_media_params(),
                },
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


__all__ = [
    "list_auto_dj_candidates",
    "list_detached_auto_dj_rooms",
    "list_recent_auto_dj_artists",
    "list_recent_auto_dj_tracks",
]
