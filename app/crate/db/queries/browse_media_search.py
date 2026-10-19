from __future__ import annotations

import re
import shlex
from collections.abc import Mapping
from dataclasses import dataclass
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
    album_id = item.get("album_id")
    has_cover = bool(item.get("has_cover"))
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
        "year": item.get("year"),
        "genre": item.get("genre"),
        "bpm": item.get("bpm"),
        "audio_key": item.get("audio_key"),
        "audio_scale": item.get("audio_scale"),
        "has_cover": has_cover,
        "cover_url": f"/api/vdj/albums/{album_id}/cover?size=512"
        if album_id is not None and has_cover
        else None,
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
               t.path, t.duration,
               COALESCE(
                   NULLIF(t.genre, ''),
                   NULLIF(a.genre, ''),
                   (
                       SELECT g.name
                       FROM album_genres ag
                       JOIN genres g ON g.id = ag.genre_id
                       WHERE ag.album_id = a.id
                       ORDER BY ag.weight DESC NULLS LAST, g.name ASC
                       LIMIT 1
                   )
               ) AS genre,
               t.format, t.bitrate, COALESCE(NULLIF(t.year, ''), a.year) AS year,
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


DJ_SEARCH_LIMIT = 50
_DJ_CANDIDATE_LIMIT = 500
_CAMELOT_KEY = re.compile(r"^(1[0-2]|[1-9])([AB])$")
_RANGE = re.compile(r"^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$")


@dataclass(frozen=True, slots=True)
class DjSearchQuery:
    text: str = ""
    artist: str | None = None
    album: str | None = None
    bpm_min: float | None = None
    bpm_max: float | None = None
    camelot: str | None = None
    energy_min: float | None = None
    energy_max: float | None = None
    analyzed: bool | None = None

    @property
    def has_filters(self) -> bool:
        return any(
            value is not None
            for value in (
                self.artist,
                self.album,
                self.bpm_min,
                self.camelot,
                self.energy_min,
                self.analyzed,
            )
        )

    @property
    def has_profile_filters(self) -> bool:
        return (
            self.bpm_min is not None
            or self.camelot is not None
            or self.energy_min is not None
        )


def parse_dj_query(raw: str) -> DjSearchQuery:
    try:
        tokens = shlex.split(str(raw or ""))
    except ValueError as exc:
        raise ValueError("Unbalanced quotes in search") from exc
    words: list[str] = []
    fields: dict[str, Any] = {}
    for token in tokens:
        name, separator, value = token.partition(":")
        name = name.lower()
        if not separator or name not in {
            "artist",
            "album",
            "bpm",
            "key",
            "energy",
            "analyzed",
        }:
            words.append(token)
            continue
        if not value:
            raise ValueError(f"Missing value for {name}:")
        if name in {"artist", "album"}:
            fields[name] = value
        elif name == "bpm":
            low, high = _parse_range(value, single_margin=1.0)
            fields["bpm_min"], fields["bpm_max"] = low, high
        elif name == "energy":
            low, high = _parse_range(value, single_margin=0.0)
            if high > 1.0:
                raise ValueError("energy must be between 0 and 1")
            fields["energy_min"], fields["energy_max"] = low, high
        elif name == "key":
            match = _CAMELOT_KEY.match(value.upper())
            if match is None:
                raise ValueError("key must be a Camelot key such as 8A")
            fields["camelot"] = f"{match.group(1)}{match.group(2)}"
        elif value.lower() in {"no", "yes"}:
            fields["analyzed"] = value.lower() == "yes"
        else:
            raise ValueError("analyzed must be yes or no")
    return DjSearchQuery(text=" ".join(words), **fields)


def _parse_range(value: str, *, single_margin: float) -> tuple[float, float]:
    match = _RANGE.match(value)
    if match is None:
        raise ValueError(f"Invalid range: {value}")
    low = float(match.group(1))
    if match.group(2) is None:
        return low - single_margin, low + single_margin
    high = float(match.group(2))
    if high < low:
        raise ValueError(f"Invalid range: {value}")
    return low, high


_DJ_TEXT_CANDIDATES = """
    SELECT id FROM (
        SELECT id
        FROM library_tracks
        WHERE :fts_query IS NOT NULL
          AND search_vector @@ to_tsquery('simple', :fts_query)
        ORDER BY ts_rank(search_vector, to_tsquery('simple', :fts_query)) DESC, id
        LIMIT :candidate_limit
    ) fts
    UNION
    SELECT id FROM (
        SELECT id
        FROM library_tracks t
        WHERE t.title ILIKE :substring ESCAPE '\\'
           OR t.artist ILIKE :substring ESCAPE '\\'
           OR t.album ILIKE :substring ESCAPE '\\'
        ORDER BY id
        LIMIT :candidate_limit
    ) substring_matches
"""

_DJ_NAME_CANDIDATES = """
    SELECT t.id
    FROM library_tracks t
    WHERE (CAST(:artist AS text) IS NULL OR t.artist ILIKE :artist ESCAPE '\\')
      AND (CAST(:album AS text) IS NULL OR t.album ILIKE :album ESCAPE '\\')
    ORDER BY t.id
    LIMIT :candidate_limit
"""

_DJ_PROFILE_CANDIDATES = """
    SELECT p.track_id AS id
    FROM track_mix_profiles p
    WHERE p.quality <> 'unavailable'
      AND p.source_stale_at IS NULL
      AND p.bpm IS NOT NULL
      AND (CAST(:bpm_min AS double precision) IS NULL OR p.bpm >= :bpm_min)
      AND (CAST(:bpm_max AS double precision) IS NULL OR p.bpm <= :bpm_max)
      AND (CAST(:camelot AS text) IS NULL OR p.key_camelot = :camelot)
      AND (
          CAST(:energy_min AS double precision) IS NULL
          OR p.global_energy >= :energy_min
      )
      AND (
          CAST(:energy_max AS double precision) IS NULL
          OR p.global_energy <= :energy_max
      )
    ORDER BY p.bpm, p.track_id
    LIMIT :candidate_limit
"""

_DJ_UNANALYZED_CANDIDATES = """
    SELECT t.id
    FROM library_tracks t
    WHERE NOT EXISTS (
        SELECT 1 FROM track_mix_profiles p
        WHERE p.track_id = t.id AND p.quality <> 'unavailable'
          AND p.source_stale_at IS NULL
    )
    ORDER BY t.id
    LIMIT :candidate_limit
"""

_DJ_RESULTS = """
    WITH candidates AS MATERIALIZED ({candidates})
    SELECT
        t.id,
        t.entity_uid::text AS entity_uid,
        t.slug,
        COALESCE(NULLIF(t.title, ''), t.filename) AS title,
        t.artist,
        a.id AS album_id,
        a.slug AS album_slug,
        a.entity_uid::text AS album_entity_uid,
        a.name AS album,
        a.has_cover,
        t.duration,
        COALESCE(NULLIF(t.year, ''), a.year) AS year,
        COALESCE(
            NULLIF(t.genre, ''),
            NULLIF(a.genre, ''),
            (
                SELECT g.name
                FROM album_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.album_id = a.id
                ORDER BY ag.weight DESC NULLS LAST, g.name ASC
                LIMIT 1
            )
        ) AS genre,
        COALESCE(p.bpm, t.bpm) AS bpm,
        t.audio_key,
        t.audio_scale,
        p.key_camelot AS camelot,
        p.global_energy AS energy,
        (p.track_id IS NULL) AS analysis_required,
        COALESCE(
            ts_rank(t.search_vector, to_tsquery('simple', :fts_query)), 0
        ) AS fts_rank
    FROM candidates c
    JOIN library_tracks t ON t.id = c.id
    JOIN library_albums a ON a.id = t.album_id
    LEFT JOIN track_mix_profiles p
      ON p.track_id = t.id AND p.quality <> 'unavailable'
      AND p.source_stale_at IS NULL
    WHERE (CAST(:artist AS text) IS NULL OR t.artist ILIKE :artist ESCAPE '\\')
      AND (CAST(:album AS text) IS NULL OR a.name ILIKE :album ESCAPE '\\')
      AND (CAST(:bpm_min AS double precision) IS NULL OR p.bpm >= :bpm_min)
      AND (CAST(:bpm_max AS double precision) IS NULL OR p.bpm <= :bpm_max)
      AND (CAST(:camelot AS text) IS NULL OR p.key_camelot = :camelot)
      AND (
          CAST(:energy_min AS double precision) IS NULL
          OR p.global_energy >= :energy_min
      )
      AND (
          CAST(:energy_max AS double precision) IS NULL
          OR p.global_energy <= :energy_max
      )
      AND (
          CAST(:analyzed AS boolean) IS NULL
          OR (p.track_id IS NOT NULL) = :analyzed
      )
    ORDER BY fts_rank DESC, LOWER(t.artist), LOWER(a.name), t.track_number, t.id
    LIMIT :limit
"""


def dj_search_statement(query: DjSearchQuery, limit: int) -> tuple[Any, dict[str, Any]]:
    normalized = normalize_search_query(query.text)
    if normalized:
        candidates = _DJ_TEXT_CANDIDATES
    elif query.artist is not None or query.album is not None:
        candidates = _DJ_NAME_CANDIDATES
    elif query.has_profile_filters:
        candidates = _DJ_PROFILE_CANDIDATES
    elif query.analyzed is False:
        candidates = _DJ_UNANALYZED_CANDIDATES
    else:
        candidates = None
    if candidates is None:
        raise ValueError("Empty DJ search")
    params = {
        "fts_query": build_fts_query(normalized) if normalized else None,
        "substring": build_substring_pattern(normalized),
        "artist": build_substring_pattern(query.artist) if query.artist else None,
        "album": build_substring_pattern(query.album) if query.album else None,
        "bpm_min": query.bpm_min,
        "bpm_max": query.bpm_max,
        "camelot": query.camelot,
        "energy_min": query.energy_min,
        "energy_max": query.energy_max,
        "analyzed": query.analyzed,
        "candidate_limit": _DJ_CANDIDATE_LIMIT,
        "limit": max(1, min(int(limit), DJ_SEARCH_LIMIT)),
    }
    return text(_DJ_RESULTS.format(candidates=candidates)), params


def search_dj_tracks(raw_query: str, limit: int) -> list[dict]:
    query = parse_dj_query(raw_query)
    try:
        statement, params = dj_search_statement(query, limit)
    except ValueError:
        return []
    with read_scope() as session:
        rows = session.execute(statement, params).mappings().all()
    return [_dj_track_payload(row) for row in rows]


def _dj_track_payload(row: Mapping[Any, Any]) -> dict:
    item = _serialize_track_row(row)
    item.pop("fts_rank", None)
    album_id = item.get("album_id")
    has_cover = bool(item.get("has_cover"))
    item["has_cover"] = has_cover
    item["analysis_required"] = bool(item.get("analysis_required"))
    item["cover_url"] = (
        f"/api/vdj/albums/{album_id}/cover?size=512"
        if album_id is not None and has_cover
        else None
    )
    return item


__all__ = [
    "DJ_SEARCH_LIMIT",
    "DjSearchQuery",
    "dj_search_statement",
    "parse_dj_query",
    "search_dj_tracks",
    "build_fts_query",
    "build_prefix_pattern",
    "build_substring_pattern",
    "normalize_search_query",
    "search_all_hybrid",
    "search_albums",
    "search_artists",
    "search_tracks",
]
