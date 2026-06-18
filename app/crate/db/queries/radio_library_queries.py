"""Library/object lookup queries for the shaped radio engine."""

from __future__ import annotations

import random

from sqlalchemy import text

from crate.db.queries.playable_media_filters import (
    playable_album_clause,
    playable_media_params,
    playable_track_clause,
)
from crate.db.tx import optional_scope, read_scope


def get_track_path_by_id(track_id: int) -> str | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    SELECT t.path
                    FROM library_tracks t
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE t.id = :track_id
                      AND {playable_track_clause("t", "a")}
                    LIMIT 1
                    """
                ),
                {"track_id": track_id, **playable_media_params()},
            )
            .mappings()
            .first()
        )
    return str(row["path"]) if row and row.get("path") else None


def get_track_path_by_pattern(path: str, escaped_like: str) -> str | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                SELECT t.path
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                WHERE t.path = :path
                  AND {playable_track_clause("t", "a")}
                LIMIT 1
                """
                ),
                {"path": path, "escaped_like": escaped_like, **playable_media_params()},
            )
            .mappings()
            .first()
        )
    return str(row["path"]) if row and row.get("path") else None


def get_album_for_radio(album_id: int) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                SELECT id, artist, name
                FROM library_albums a
                WHERE id = :album_id
                  AND {playable_album_clause("a")}
                LIMIT 1
                """
                ),
                {"album_id": album_id, **playable_media_params()},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_playlist_for_radio(playlist_id: int) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                SELECT id, name, scope, user_id, is_active
                FROM playlists
                WHERE id = :playlist_id
                LIMIT 1
                """
                ),
                {"playlist_id": playlist_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_random_library_seed_rows(limit: int = 30, *, session=None) -> list[dict]:
    with optional_scope(session) as s:
        max_row = (
            s.execute(
                text(
                    f"""
                SELECT MAX(t.id)::INTEGER AS max_id
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                WHERE t.bliss_vector IS NOT NULL
                  AND {playable_track_clause("t", "a")}
                """
                ),
                playable_media_params(),
            )
            .mappings()
            .first()
        )
        max_id = int(max_row["max_id"] or 0) if max_row else 0
        if max_id <= 0:
            return []

        start_id = random.randint(1, max_id)
        rows = list(
            s.execute(
                text(
                    f"""
                SELECT t.id AS track_id, t.artist, t.title, t.bliss_vector
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                WHERE t.bliss_vector IS NOT NULL
                  AND {playable_track_clause("t", "a")}
                  AND t.id >= :start_id
                ORDER BY t.id
                LIMIT :limit
                """
                ),
                {"limit": limit, "start_id": start_id, **playable_media_params()},
            )
            .mappings()
            .all()
        )
        if len(rows) < limit:
            rows += list(
                s.execute(
                    text(
                        f"""
                    SELECT t.id AS track_id, t.artist, t.title, t.bliss_vector
                    FROM library_tracks t
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE t.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                      AND t.id < :start_id
                    ORDER BY t.id
                    LIMIT :remaining
                    """
                    ),
                    {
                        "remaining": limit - len(rows),
                        "start_id": start_id,
                        **playable_media_params(),
                    },
                )
                .mappings()
                .all()
            )
    return [dict(row) for row in rows]


def get_random_library_vectors(limit: int = 30, *, session=None) -> list[list[float]]:
    return [
        list(row["bliss_vector"])
        for row in get_random_library_seed_rows(limit, session=session)
    ]


def get_track_bliss_vector(track_id: int, *, session=None) -> list[float] | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    f"""
                    SELECT t.bliss_vector
                    FROM library_tracks t
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE t.id = :id
                      AND t.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                    """
                ),
                {"id": track_id, **playable_media_params()},
            )
            .mappings()
            .first()
        )
    return list(row["bliss_vector"]) if row else None


__all__ = [
    "get_album_for_radio",
    "get_playlist_for_radio",
    "get_random_library_seed_rows",
    "get_random_library_vectors",
    "get_track_bliss_vector",
    "get_track_path_by_id",
    "get_track_path_by_pattern",
]
