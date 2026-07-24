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


def normalize_search_query(query: str) -> str:
    """Accept raw user text and legacy LIKE patterns as the same search input."""
    value = str(query or "").strip()
    if "%" in value or "_" in value:
        value = value.strip("%").replace("%", " ").replace("_", " ")
    return re.sub(r"\s+", " ", value).strip()


def _search_params(query: str, limit: int) -> dict[str, Any]:
    normalized = normalize_search_query(query)
    return {
        "fts_query": build_fts_query(normalized),
        "prefix": build_prefix_pattern(normalized),
        "substring": build_substring_pattern(normalized),
        "limit": limit,
        "candidate_limit": max(100, min(limit * 20, 1000)),
    }


def search_artists(query: str, limit: int) -> list[dict]:
    params = _search_params(query, limit)
    if not normalize_search_query(query):
        return []
    with read_scope() as session:
        rows = session.execute(_HYBRID_ARTISTS_SQL, params).mappings().all()
    return [_serialize_artist_row(row) for row in rows]


def search_albums(query: str, limit: int) -> list[dict]:
    params = _search_params(query, limit)
    if not normalize_search_query(query):
        return []
    with read_scope() as session:
        rows = session.execute(_HYBRID_ALBUMS_SQL, params).mappings().all()
    return [_serialize_album_row(row) for row in rows]


def search_tracks(query: str, limit: int) -> list[dict]:
    params = _search_params(query, limit)
    if not normalize_search_query(query):
        return []
    with read_scope() as session:
        rows = session.execute(_HYBRID_TRACKS_SQL, params).mappings().all()
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
    WITH fts_candidates AS (
        SELECT id
        FROM library_artists
        WHERE :fts_query IS NOT NULL
          AND search_vector @@ to_tsquery('simple', :fts_query)
        ORDER BY ts_rank(search_vector, to_tsquery('simple', :fts_query)) DESC, id
        LIMIT :candidate_limit
    ), substring_candidates AS (
        SELECT id
        FROM library_artists
        WHERE name ILIKE :substring ESCAPE '\\'
        ORDER BY CASE WHEN name ILIKE :prefix ESCAPE '\\' THEN 0 ELSE 1 END, id
        LIMIT :candidate_limit
    ), candidates AS (
        SELECT id FROM fts_candidates
        UNION
        SELECT id FROM substring_candidates
    ), ranked AS (
        SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.name,
               a.album_count, a.has_photo,
               COALESCE(ts_rank(a.search_vector, to_tsquery('simple', :fts_query)), 0) AS fts_rank,
               CASE WHEN a.name ILIKE :prefix ESCAPE '\\' THEN 0.3 ELSE 0 END AS prefix_bonus,
               CASE WHEN a.name ILIKE :substring ESCAPE '\\' THEN 0.15 ELSE 0 END AS substring_bonus
        FROM candidates c
        JOIN library_artists a ON a.id = c.id
    )
    SELECT *, (fts_rank + prefix_bonus + substring_bonus) AS score
    FROM ranked
    ORDER BY score DESC, album_count DESC, name ASC
    LIMIT :limit
    """
)

_HYBRID_ALBUMS_SQL = text(
    """
    WITH fts_candidates AS (
        SELECT id
        FROM library_albums
        WHERE :fts_query IS NOT NULL
          AND search_vector @@ to_tsquery('simple', :fts_query)
        ORDER BY ts_rank(search_vector, to_tsquery('simple', :fts_query)) DESC, id
        LIMIT :candidate_limit
    ), substring_candidates AS (
        SELECT id
        FROM library_albums
        WHERE name ILIKE :substring ESCAPE '\\'
           OR artist ILIKE :substring ESCAPE '\\'
        ORDER BY CASE
            WHEN name ILIKE :prefix ESCAPE '\\' THEN 0
            WHEN artist ILIKE :prefix ESCAPE '\\' THEN 1
            ELSE 2
        END, id
        LIMIT :candidate_limit
    ), candidates AS (
        SELECT id FROM fts_candidates
        UNION
        SELECT id FROM substring_candidates
    ), ranked AS (
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
        FROM candidates c
        JOIN library_albums a ON a.id = c.id
        LEFT JOIN library_artists ar ON ar.name = a.artist
    )
    SELECT *, (fts_rank + prefix_bonus + substring_bonus) AS score
    FROM ranked
    ORDER BY score DESC, year DESC NULLS LAST, name ASC
    LIMIT :limit
    """
)

_HYBRID_TRACKS_SQL = text(
    """
    WITH fts_candidates AS (
        SELECT id
        FROM library_tracks
        WHERE :fts_query IS NOT NULL
          AND search_vector @@ to_tsquery('simple', :fts_query)
        ORDER BY ts_rank(search_vector, to_tsquery('simple', :fts_query)) DESC, id
        LIMIT :candidate_limit
    ), substring_candidates AS (
        SELECT id
        FROM library_tracks t
        WHERE t.title ILIKE :substring ESCAPE '\\'
           OR t.artist ILIKE :substring ESCAPE '\\'
           OR t.album ILIKE :substring ESCAPE '\\'
        ORDER BY CASE
            WHEN t.title ILIKE :prefix ESCAPE '\\' THEN 0
            WHEN t.artist ILIKE :prefix ESCAPE '\\' THEN 1
            WHEN t.album ILIKE :prefix ESCAPE '\\' THEN 2
            ELSE 3
        END, id
        LIMIT :candidate_limit
    ), candidates AS (
        SELECT id FROM fts_candidates
        UNION
        SELECT id FROM substring_candidates
    ), ranked AS (
        SELECT t.id, t.entity_uid::text AS entity_uid, t.slug,
               t.title, t.artist,
               a.id AS album_id, a.slug AS album_slug, a.has_cover,
               a.entity_uid::text AS album_entity_uid, a.name AS album,
               ar.id AS artist_id,
               ar.entity_uid::text AS artist_entity_uid,
               ar.slug AS artist_slug,
               t.path, t.duration, t.genre, t.format, t.bitrate, t.year,
               t.bpm, t.audio_key, t.audio_scale, t.energy,
               t.danceability, t.valence, t.bliss_vector,
               COALESCE(ts_rank(t.search_vector, to_tsquery('simple', :fts_query)), 0) AS fts_rank,
               CASE WHEN t.title ILIKE :prefix ESCAPE '\\' THEN 0.3
                    WHEN t.artist ILIKE :prefix ESCAPE '\\' THEN 0.2
                    WHEN a.name ILIKE :prefix ESCAPE '\\' THEN 0.1
                    ELSE 0 END AS prefix_bonus,
               CASE WHEN t.title ILIKE :substring ESCAPE '\\' THEN 0.15
                    WHEN t.artist ILIKE :substring ESCAPE '\\' THEN 0.1
                    WHEN t.album ILIKE :substring ESCAPE '\\' THEN 0.05
                    ELSE 0 END AS substring_bonus
        FROM candidates c
        JOIN library_tracks t ON t.id = c.id
        JOIN library_albums a ON t.album_id = a.id
        LEFT JOIN library_artists ar ON ar.name = t.artist
    )
    SELECT *, (fts_rank + prefix_bonus + substring_bonus) AS score
    FROM ranked
    ORDER BY score DESC, title ASC
    LIMIT :limit
    """
)


def search_all_hybrid(query: str, limit: int) -> dict[str, list[dict]]:
    params = _search_params(query, limit)
    if not normalize_search_query(query):
        return {"artists": [], "albums": [], "tracks": []}
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
    "normalize_search_query",
    "search_all_hybrid",
    "search_albums",
    "search_artists",
    "search_tracks",
]
