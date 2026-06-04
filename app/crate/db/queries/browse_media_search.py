from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope


def _optional_str(value: Any) -> str | None:
    return str(value) if value is not None else None


def _serialize_artist_row(row: Mapping[Any, Any]) -> dict:
    item = dict(row)
    item["entity_uid"] = _optional_str(item.get("entity_uid"))
    return item


def _serialize_album_row(row: Mapping[Any, Any]) -> dict:
    item = dict(row)
    item["entity_uid"] = _optional_str(item.get("entity_uid"))
    item["artist_entity_uid"] = _optional_str(item.get("artist_entity_uid"))
    return item


def _serialize_track_row(row: Mapping[Any, Any]) -> dict:
    item = dict(row)
    item["entity_uid"] = _optional_str(item.get("entity_uid"))
    item["album_entity_uid"] = _optional_str(item.get("album_entity_uid"))
    item["artist_entity_uid"] = _optional_str(item.get("artist_entity_uid"))
    if item.get("bliss_vector") is not None:
        item["bliss_vector"] = list(item["bliss_vector"])
    return item


def build_fts_query(user_query: str) -> str | None:
    """Build a safe prefix-aware PostgreSQL tsquery string."""
    terms = re.findall(r"\w+", user_query.strip(), re.UNICODE)
    if not terms:
        return None
    tokens = [term.lower() for term in terms]
    return " & ".join(
        f"{token}:*" if index == len(tokens) - 1 else token
        for index, token in enumerate(tokens)
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_prefix_pattern(user_query: str) -> str:
    return f"{_escape_like(user_query.strip())}%"


def build_substring_pattern(user_query: str) -> str:
    return f"%{_escape_like(user_query.strip())}%"


def _search_params(query: str, limit: int) -> dict[str, Any]:
    return {
        "fts_query": build_fts_query(query),
        "prefix": build_prefix_pattern(query),
        "substring": build_substring_pattern(query),
        "limit": limit,
    }


def search_artists(like: str, limit: int) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT id, entity_uid::text AS entity_uid, slug, name, album_count, has_photo
                FROM library_artists
                WHERE name ILIKE :like
                ORDER BY listeners DESC NULLS LAST, album_count DESC, name ASC
                LIMIT :limit
                """
                ),
                {"like": like, "limit": limit},
            )
            .mappings()
            .all()
        )
        return [_serialize_artist_row(row) for row in rows]


def search_albums(like: str, limit: int) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.artist, a.name, a.year, a.has_cover,
                       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                WHERE a.name ILIKE :like OR a.artist ILIKE :like
                ORDER BY year DESC NULLS LAST, name ASC
                LIMIT :limit
                """
                ),
                {"like": like, "limit": limit},
            )
            .mappings()
            .all()
        )
        return [_serialize_album_row(row) for row in rows]


def search_tracks(like: str, limit: int) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT t.id, t.entity_uid::text AS entity_uid, t.slug, t.title, t.artist, a.id AS album_id, a.slug AS album_slug,
                       a.entity_uid::text AS album_entity_uid, a.name AS album,
                       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug,
                       t.path, t.duration,
                       t.bpm, t.audio_key, t.audio_scale, t.energy,
                       t.danceability, t.valence, t.bliss_vector
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE t.title ILIKE :like OR t.artist ILIKE :like OR a.name ILIKE :like
                ORDER BY t.title ASC
                LIMIT :limit
                """
                ),
                {"like": like, "limit": limit},
            )
            .mappings()
            .all()
        )
        return [_serialize_track_row(row) for row in rows]


def _artist_payload(row: Mapping[Any, Any]) -> dict:
    item = _serialize_artist_row(row)
    return {
        "id": item["id"],
        "entity_uid": item.get("entity_uid"),
        "slug": item.get("slug"),
        "name": item["name"],
        "album_count": item.get("album_count", 0),
        "has_photo": bool(item.get("has_photo")),
    }


def _album_payload(row: Mapping[Any, Any]) -> dict:
    item = _serialize_album_row(row)
    return {
        "id": item["id"],
        "entity_uid": item.get("entity_uid"),
        "slug": item.get("slug"),
        "artist": item["artist"],
        "artist_id": item.get("artist_id"),
        "artist_entity_uid": item.get("artist_entity_uid"),
        "artist_slug": item.get("artist_slug"),
        "name": item["name"],
        "year": item.get("year") or "",
        "has_cover": bool(item.get("has_cover")),
    }


def _track_payload(row: Mapping[Any, Any]) -> dict:
    item = _serialize_track_row(row)
    return {
        "id": item["id"],
        "entity_uid": item.get("entity_uid"),
        "slug": item.get("slug"),
        "title": item["title"],
        "artist": item["artist"],
        "artist_id": item.get("artist_id"),
        "artist_entity_uid": item.get("artist_entity_uid"),
        "artist_slug": item.get("artist_slug"),
        "album_id": item.get("album_id"),
        "album_entity_uid": item.get("album_entity_uid"),
        "album_slug": item.get("album_slug"),
        "album": item["album"],
        "path": item["path"],
        "duration": item["duration"],
    }


_HYBRID_ARTISTS_SQL = text(
    """
    WITH ranked AS (
        SELECT id, entity_uid::text AS entity_uid, slug, name, album_count, has_photo,
               COALESCE(ts_rank(search_vector, to_tsquery('simple', :fts_query)), 0) AS fts_rank,
               CASE WHEN name ILIKE :prefix ESCAPE '\\' THEN 0.3 ELSE 0 END AS prefix_bonus,
               CASE WHEN name ILIKE :substring ESCAPE '\\' THEN 0.15 ELSE 0 END AS substring_bonus
        FROM library_artists
        WHERE (:fts_query IS NOT NULL AND search_vector @@ to_tsquery('simple', :fts_query))
           OR name ILIKE :substring ESCAPE '\\'
    )
    SELECT *, (fts_rank + prefix_bonus + substring_bonus) AS score
    FROM ranked
    ORDER BY score DESC, album_count DESC, name ASC
    LIMIT :limit
    """
)

_HYBRID_ALBUMS_SQL = text(
    """
    WITH ranked AS (
        SELECT a.id, a.entity_uid::text AS entity_uid, a.slug,
               a.artist, a.name, a.year, a.has_cover,
               ar.id AS artist_id,
               ar.entity_uid::text AS artist_entity_uid,
               ar.slug AS artist_slug,
               COALESCE(ts_rank(a.search_vector, to_tsquery('simple', :fts_query)), 0) AS fts_rank,
               CASE WHEN a.name ILIKE :prefix ESCAPE '\\' THEN 0.3
                    WHEN a.artist ILIKE :prefix ESCAPE '\\' THEN 0.2
                    ELSE 0 END AS prefix_bonus,
               CASE WHEN a.name ILIKE :substring ESCAPE '\\' THEN 0.15
                    WHEN a.artist ILIKE :substring ESCAPE '\\' THEN 0.1
                    ELSE 0 END AS substring_bonus
        FROM library_albums a
        LEFT JOIN library_artists ar ON ar.name = a.artist
        WHERE (:fts_query IS NOT NULL AND a.search_vector @@ to_tsquery('simple', :fts_query))
           OR a.name ILIKE :substring ESCAPE '\\'
           OR a.artist ILIKE :substring ESCAPE '\\'
    )
    SELECT *, (fts_rank + prefix_bonus + substring_bonus) AS score
    FROM ranked
    ORDER BY score DESC, year DESC NULLS LAST, name ASC
    LIMIT :limit
    """
)

_HYBRID_TRACKS_SQL = text(
    """
    WITH ranked AS (
        SELECT t.id, t.entity_uid::text AS entity_uid, t.slug,
               t.title, t.artist,
               a.id AS album_id, a.slug AS album_slug,
               a.entity_uid::text AS album_entity_uid, a.name AS album,
               ar.id AS artist_id,
               ar.entity_uid::text AS artist_entity_uid,
               ar.slug AS artist_slug,
               t.path, t.duration,
               COALESCE(ts_rank(t.search_vector, to_tsquery('simple', :fts_query)), 0) AS fts_rank,
               CASE WHEN t.title ILIKE :prefix ESCAPE '\\' THEN 0.3
                    WHEN t.artist ILIKE :prefix ESCAPE '\\' THEN 0.2
                    WHEN a.name ILIKE :prefix ESCAPE '\\' THEN 0.1
                    ELSE 0 END AS prefix_bonus,
               CASE WHEN t.title ILIKE :substring ESCAPE '\\' THEN 0.15
                    WHEN t.artist ILIKE :substring ESCAPE '\\' THEN 0.1
                    WHEN a.name ILIKE :substring ESCAPE '\\' THEN 0.05
                    ELSE 0 END AS substring_bonus
        FROM library_tracks t
        JOIN library_albums a ON t.album_id = a.id
        LEFT JOIN library_artists ar ON ar.name = t.artist
        WHERE (:fts_query IS NOT NULL AND t.search_vector @@ to_tsquery('simple', :fts_query))
           OR t.title ILIKE :substring ESCAPE '\\'
           OR t.artist ILIKE :substring ESCAPE '\\'
           OR a.name ILIKE :substring ESCAPE '\\'
    )
    SELECT *, (fts_rank + prefix_bonus + substring_bonus) AS score
    FROM ranked
    ORDER BY score DESC, title ASC
    LIMIT :limit
    """
)


def search_all_hybrid(query: str, limit: int) -> dict[str, list[dict]]:
    params = _search_params(query, limit)
    with read_scope() as session:
        artist_rows = session.execute(_HYBRID_ARTISTS_SQL, params).mappings().all()
        album_rows = session.execute(_HYBRID_ALBUMS_SQL, params).mappings().all()
        track_rows = session.execute(_HYBRID_TRACKS_SQL, params).mappings().all()

    return {
        "artists": [_artist_payload(row) for row in artist_rows],
        "albums": [_album_payload(row) for row in album_rows],
        "tracks": [_track_payload(row) for row in track_rows],
    }


__all__ = [
    "build_fts_query",
    "build_prefix_pattern",
    "build_substring_pattern",
    "search_all_hybrid",
    "search_albums",
    "search_artists",
    "search_tracks",
]
