"""Source extraction for the federated global catalog read model."""

from __future__ import annotations

from collections.abc import Iterator
import json
import re
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope
from crate.federation.global_matching import (
    album_match_key,
    artist_match_key,
    normalize_name,
    track_match_key,
)

DEFAULT_BATCH_SIZE = 500
_REMOTE_AUDIO_KEYS = (
    "bpm",
    "energy",
    "danceability",
    "valence",
    "acousticness",
    "instrumentalness",
)
_REMOTE_QUALITY_KEYS = (
    "bitrate",
    "sample_rate",
    "bit_depth",
    "size_bytes",
)


def iter_local_sources(
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Iterator[dict[str, Any]]:
    yield from iter_local_artist_sources(batch_size=batch_size)
    yield from iter_local_album_sources(batch_size=batch_size)
    yield from iter_local_track_sources(batch_size=batch_size)


def iter_remote_sources(
    batch_size: int = DEFAULT_BATCH_SIZE,
    node_uid: str | None = None,
    entity_type: str | None = None,
    after_id: int = 0,
) -> Iterator[dict[str, Any]]:
    conditions = [
        "item.id > :after_id",
        "item.deleted_at IS NULL",
        "peer.trust_state = 'approved'",
        "peer.disabled_at IS NULL",
    ]
    params: dict[str, Any] = {"after_id": max(0, int(after_id))}
    if node_uid:
        conditions.append("item.node_uid = :node_uid")
        params["node_uid"] = node_uid
    if entity_type:
        conditions.append("item.entity_type = :entity_type")
        params["entity_type"] = entity_type
    where = f"WHERE {' AND '.join(conditions)}"
    for row in _iter_rows(
        f"""
        SELECT
            item.id AS source_id,
            item.node_uid::text AS node_uid,
            item.remote_entity_uid,
            item.entity_type,
            item.title,
            item.artist,
            item.album,
            item.year,
            item.release_date,
            item.duration_seconds,
            item.disc_number,
            item.track_number,
            item.track_count,
            item.musicbrainz_artist_mbid,
            item.musicbrainz_release_group_mbid,
            item.musicbrainz_release_mbid,
            item.musicbrainz_recording_mbid,
            item.isrc,
            item.upc,
            item.quality_json,
            item.artwork_json,
            item.availability_json,
            item.match_json,
            item.remote_revision,
            item.deleted_at,
            item.raw_json,
            item.indexed_at
        FROM federation_catalog_items item
        JOIN federation_nodes peer ON peer.node_uid = item.node_uid
        {where}
        ORDER BY item.id
        """,
        batch_size=batch_size,
        params=params,
    ):
        source = _remote_source_from_row(row)
        if source is not None:
            yield source


def get_remote_source(
    node_uid: str,
    entity_type: str,
    remote_entity_uid: str,
) -> dict[str, Any] | None:
    """Load one federated catalog source without scanning every peer row."""
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        item.node_uid::text AS node_uid,
                        item.remote_entity_uid,
                        item.entity_type,
                        item.title,
                        item.artist,
                        item.album,
                        item.year,
                        item.release_date,
                        item.duration_seconds,
                        item.disc_number,
                        item.track_number,
                        item.track_count,
                        item.musicbrainz_artist_mbid,
                        item.musicbrainz_release_group_mbid,
                        item.musicbrainz_release_mbid,
                        item.musicbrainz_recording_mbid,
                        item.isrc,
                        item.upc,
                        item.quality_json,
                        item.artwork_json,
                        item.availability_json,
                        item.match_json,
                        item.remote_revision,
                        item.deleted_at,
                        item.raw_json,
                        item.indexed_at
                    FROM federation_catalog_items item
                    JOIN federation_nodes peer ON peer.node_uid = item.node_uid
                    WHERE item.node_uid = CAST(:node_uid AS uuid)
                      AND item.entity_type = :entity_type
                      AND item.remote_entity_uid = :remote_entity_uid
                      AND item.deleted_at IS NULL
                      AND peer.trust_state = 'approved'
                      AND peer.disabled_at IS NULL
                    """
                ),
                {
                    "node_uid": node_uid,
                    "entity_type": entity_type,
                    "remote_entity_uid": remote_entity_uid,
                },
            )
            .mappings()
            .first()
        )
    return _remote_source_from_row(dict(row)) if row else None


def iter_local_artist_sources(
    batch_size: int = DEFAULT_BATCH_SIZE,
    after_id: int = 0,
) -> Iterator[dict[str, Any]]:
    for row in _iter_rows(
        """
        SELECT
            id,
            entity_uid::text AS entity_uid,
            name,
            mbid AS musicbrainz_artist_mbid,
            album_count,
            track_count,
            has_photo,
            (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object('raw_label', genre.name, 'weight', artist_genre.weight)
                        ORDER BY artist_genre.weight DESC, genre.name ASC
                    ),
                    '[]'::jsonb
                )
                FROM artist_genres artist_genre
                JOIN genres genre ON genre.id = artist_genre.genre_id
                WHERE artist_genre.artist_name = library_artists.name
            ) AS genres_json,
            updated_at
        FROM library_artists
        WHERE id > :after_id
        ORDER BY id
        """,
        batch_size=batch_size,
        params={"after_id": max(0, int(after_id))},
    ):
        payload = {
            "canonical_name": row["name"],
            "sort_name": row["name"],
            "normalized_name": normalize_name(row["name"]),
            "musicbrainz_artist_mbid": row["musicbrainz_artist_mbid"],
            "local_artist_id": row["id"],
            "local_artist_entity_uid": row["entity_uid"],
            "album_count": row["album_count"],
            "track_count": row["track_count"],
            "has_photo": bool(row["has_photo"]),
            "genres": _local_genres(row.get("genres_json")),
        }
        yield _local_source(
            entity_type="artist",
            local_id=row["id"],
            local_entity_uid=row["entity_uid"],
            source_revision=_revision(row["updated_at"]),
            source_payload=payload,
            match_key=artist_match_key(payload),
        )


def iter_local_album_sources(
    batch_size: int = DEFAULT_BATCH_SIZE,
    after_id: int = 0,
) -> Iterator[dict[str, Any]]:
    for row in _iter_rows(
        """
        SELECT
            id,
            entity_uid::text AS entity_uid,
            artist,
            name,
            year,
            release_date,
            track_count,
            total_duration,
            musicbrainz_albumid AS musicbrainz_release_mbid,
            musicbrainz_releasegroupid AS musicbrainz_release_group_mbid,
            release_group_primary_type,
            release_group_secondary_types,
            has_cover,
            (
                SELECT request.global_album_uid::text
                FROM federation_import_requests request
                WHERE request.global_album_uid IS NOT NULL
                  AND request.metadata_json #>> '{provenance,local_album_id}' = library_albums.id::text
                ORDER BY request.updated_at DESC
                LIMIT 1
            ) AS imported_global_album_uid,
            (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object('raw_label', genre.name, 'weight', album_genre.weight)
                        ORDER BY album_genre.weight DESC, genre.name ASC
                    ),
                    '[]'::jsonb
                )
                FROM album_genres album_genre
                JOIN genres genre ON genre.id = album_genre.genre_id
                WHERE album_genre.album_id = library_albums.id
            ) AS genres_json,
            updated_at
        FROM library_albums
        WHERE id > :after_id
        ORDER BY id
        """,
        batch_size=batch_size,
        params={"after_id": max(0, int(after_id))},
    ):
        payload = {
            "canonical_name": row["name"],
            "normalized_name": normalize_name(row["name"], strip_edition=True),
            "artist_name": row["artist"],
            "year": row["year"],
            "release_date": row["release_date"],
            "track_count": row["track_count"],
            "total_duration_seconds": _duration_seconds(row["total_duration"]),
            "musicbrainz_release_mbid": row["musicbrainz_release_mbid"],
            "musicbrainz_release_group_mbid": row["musicbrainz_release_group_mbid"],
            "release_group_primary_type": row["release_group_primary_type"],
            "release_group_secondary_types": list(
                row["release_group_secondary_types"] or []
            ),
            "local_album_id": row["id"],
            "local_album_entity_uid": row["entity_uid"],
            "imported_global_album_uid": row["imported_global_album_uid"],
            "has_cover": bool(row["has_cover"]),
            "genres": _local_genres(row.get("genres_json")),
        }
        yield _local_source(
            entity_type="album",
            local_id=row["id"],
            local_entity_uid=row["entity_uid"],
            source_revision=_revision(row["updated_at"]),
            source_payload=payload,
            match_key=album_match_key(payload),
        )


def iter_local_track_sources(
    batch_size: int = DEFAULT_BATCH_SIZE,
    after_id: int = 0,
) -> Iterator[dict[str, Any]]:
    for row in _iter_rows(
        """
        SELECT
            id,
            entity_uid::text AS entity_uid,
            album_id,
            artist,
            album,
            title,
            filename,
            disc_number,
            track_number,
            duration,
            musicbrainz_trackid AS musicbrainz_recording_mbid,
            genre,
            updated_at
        FROM library_tracks
        WHERE id > :after_id
        ORDER BY id
        """,
        batch_size=batch_size,
        params={"after_id": max(0, int(after_id))},
    ):
        title = row["title"] or row["filename"]
        payload = {
            "canonical_title": title,
            "normalized_title": normalize_name(title),
            "artist_name": row["artist"],
            "album_name": row["album"],
            "disc_number": row["disc_number"],
            "track_number": row["track_number"],
            "duration_seconds": _duration_seconds(row["duration"]),
            "musicbrainz_recording_mbid": row["musicbrainz_recording_mbid"],
            "local_track_id": row["id"],
            "local_track_entity_uid": row["entity_uid"],
            "local_album_id": row["album_id"],
            "genres": _local_genres(None, row.get("genre")),
        }
        yield _local_source(
            entity_type="track",
            local_id=row["id"],
            local_entity_uid=row["entity_uid"],
            source_revision=_revision(row["updated_at"]),
            source_payload=payload,
            match_key=track_match_key(payload),
        )


def get_local_source(entity_type: str, entity_uid: str) -> dict[str, Any] | None:
    """Load one local catalog source without scanning the whole library."""
    with read_scope() as session:
        if entity_type == "artist":
            row = (
                session.execute(
                    text(
                        """
                        SELECT
                            id,
                            entity_uid::text AS entity_uid,
                            name,
                            mbid AS musicbrainz_artist_mbid,
                            album_count,
                            track_count,
                            has_photo,
                            (
                                SELECT COALESCE(
                                    jsonb_agg(
                                        jsonb_build_object('raw_label', genre.name, 'weight', artist_genre.weight)
                                        ORDER BY artist_genre.weight DESC, genre.name ASC
                                    ),
                                    '[]'::jsonb
                                )
                                FROM artist_genres artist_genre
                                JOIN genres genre ON genre.id = artist_genre.genre_id
                                WHERE artist_genre.artist_name = library_artists.name
                            ) AS genres_json,
                            updated_at
                        FROM library_artists
                        WHERE entity_uid = CAST(:entity_uid AS uuid)
                        """
                    ),
                    {"entity_uid": entity_uid},
                )
                .mappings()
                .first()
            )
            if row is None:
                return None
            payload = {
                "canonical_name": row["name"],
                "sort_name": row["name"],
                "normalized_name": normalize_name(row["name"]),
                "musicbrainz_artist_mbid": row["musicbrainz_artist_mbid"],
                "local_artist_id": row["id"],
                "local_artist_entity_uid": row["entity_uid"],
                "album_count": row["album_count"],
                "track_count": row["track_count"],
                "has_photo": bool(row["has_photo"]),
                "genres": _local_genres(row.get("genres_json")),
            }
            return _local_source(
                entity_type="artist",
                local_id=row["id"],
                local_entity_uid=row["entity_uid"],
                source_revision=_revision(row["updated_at"]),
                source_payload=payload,
                match_key=artist_match_key(payload),
            )

        if entity_type == "album":
            row = (
                session.execute(
                    text(
                        """
                        SELECT
                            id,
                            entity_uid::text AS entity_uid,
                            artist,
                            name,
                            year,
                            release_date,
                            track_count,
                            total_duration,
                            musicbrainz_albumid AS musicbrainz_release_mbid,
                            musicbrainz_releasegroupid AS musicbrainz_release_group_mbid,
                            release_group_primary_type,
                            release_group_secondary_types,
                            has_cover,
                            (
                                SELECT request.global_album_uid::text
                                FROM federation_import_requests request
                                WHERE request.global_album_uid IS NOT NULL
                                  AND request.metadata_json #>> '{provenance,local_album_id}' = library_albums.id::text
                                ORDER BY request.updated_at DESC
                                LIMIT 1
                            ) AS imported_global_album_uid,
                            (
                                SELECT COALESCE(
                                    jsonb_agg(
                                        jsonb_build_object('raw_label', genre.name, 'weight', album_genre.weight)
                                        ORDER BY album_genre.weight DESC, genre.name ASC
                                    ),
                                    '[]'::jsonb
                                )
                                FROM album_genres album_genre
                                JOIN genres genre ON genre.id = album_genre.genre_id
                                WHERE album_genre.album_id = library_albums.id
                            ) AS genres_json,
                            updated_at
                        FROM library_albums
                        WHERE entity_uid = CAST(:entity_uid AS uuid)
                        """
                    ),
                    {"entity_uid": entity_uid},
                )
                .mappings()
                .first()
            )
            if row is None:
                return None
            payload = {
                "canonical_name": row["name"],
                "normalized_name": normalize_name(row["name"], strip_edition=True),
                "artist_name": row["artist"],
                "year": row["year"],
                "release_date": row["release_date"],
                "track_count": row["track_count"],
                "total_duration_seconds": _duration_seconds(row["total_duration"]),
                "musicbrainz_release_mbid": row["musicbrainz_release_mbid"],
                "musicbrainz_release_group_mbid": row["musicbrainz_release_group_mbid"],
                "release_group_primary_type": row["release_group_primary_type"],
                "release_group_secondary_types": list(
                    row["release_group_secondary_types"] or []
                ),
                "local_album_id": row["id"],
                "local_album_entity_uid": row["entity_uid"],
                "imported_global_album_uid": row["imported_global_album_uid"],
                "has_cover": bool(row["has_cover"]),
                "genres": _local_genres(row.get("genres_json")),
            }
            return _local_source(
                entity_type="album",
                local_id=row["id"],
                local_entity_uid=row["entity_uid"],
                source_revision=_revision(row["updated_at"]),
                source_payload=payload,
                match_key=album_match_key(payload),
            )

        if entity_type == "track":
            row = (
                session.execute(
                    text(
                        """
                        SELECT
                            id,
                            entity_uid::text AS entity_uid,
                            album_id,
                            artist,
                            album,
                            title,
                            filename,
                            disc_number,
                            track_number,
                            duration,
                            musicbrainz_trackid AS musicbrainz_recording_mbid,
                            genre,
                            updated_at
                        FROM library_tracks
                        WHERE entity_uid = CAST(:entity_uid AS uuid)
                        """
                    ),
                    {"entity_uid": entity_uid},
                )
                .mappings()
                .first()
            )
            if row is None:
                return None
            title = row["title"] or row["filename"]
            payload = {
                "canonical_title": title,
                "normalized_title": normalize_name(title),
                "artist_name": row["artist"],
                "album_name": row["album"],
                "disc_number": row["disc_number"],
                "track_number": row["track_number"],
                "duration_seconds": _duration_seconds(row["duration"]),
                "musicbrainz_recording_mbid": row["musicbrainz_recording_mbid"],
                "local_track_id": row["id"],
                "local_track_entity_uid": row["entity_uid"],
                "local_album_id": row["album_id"],
                "genres": _local_genres(None, row.get("genre")),
            }
            return _local_source(
                entity_type="track",
                local_id=row["id"],
                local_entity_uid=row["entity_uid"],
                source_revision=_revision(row["updated_at"]),
                source_payload=payload,
                match_key=track_match_key(payload),
            )

    raise ValueError(f"Unsupported local catalog entity type: {entity_type}")


def _iter_rows(
    sql: str,
    *,
    batch_size: int,
    params: dict[str, Any] | None = None,
) -> Iterator[dict[str, Any]]:
    size = max(1, int(batch_size or DEFAULT_BATCH_SIZE))
    offset = 0
    while True:
        query_params = {"limit": size, "offset": offset, **(params or {})}
        with read_scope() as session:
            rows = (
                session.execute(
                    text(f"{sql}\nLIMIT :limit OFFSET :offset"),
                    query_params,
                )
                .mappings()
                .all()
            )
        if not rows:
            break
        for row in rows:
            yield dict(row)
        offset += size


def _local_source(
    *,
    entity_type: str,
    local_id: int | None,
    local_entity_uid: str | None,
    source_revision: str | None,
    source_payload: dict[str, Any],
    match_key: str,
) -> dict[str, Any]:
    return {
        "entity_type": entity_type,
        "source_kind": "local",
        "node_uid": None,
        "remote_entity_uid": None,
        "local_id": local_id,
        "local_entity_uid": local_entity_uid,
        "source_revision": source_revision,
        "source_deleted_at": None,
        "source_stale": False,
        "source_payload": source_payload,
        "match_key": match_key,
        "match_confidence": 1.0,
        "match_method": "local_entity_uid",
    }


def _remote_source_from_row(row: dict[str, Any]) -> dict[str, Any] | None:
    entity_type = row["entity_type"]
    if entity_type == "artist":
        payload = _remote_artist_payload(row)
    elif entity_type == "album":
        payload = _remote_album_payload(row)
    elif entity_type == "track":
        payload = _remote_track_payload(row)
    else:
        return None

    return {
        "entity_type": entity_type,
        "source_kind": "federated",
        "node_uid": row["node_uid"],
        "remote_entity_uid": row["remote_entity_uid"],
        "local_id": None,
        "local_entity_uid": None,
        "source_revision": row["remote_revision"],
        "source_deleted_at": _revision(row["deleted_at"]),
        "source_stale": row["deleted_at"] is not None,
        "source_payload": payload,
        "match_key": _remote_match_key(entity_type, payload),
        "match_confidence": 0.0,
        "match_method": "remote_catalog",
        "source_cursor_id": row.get("source_id"),
    }


def _remote_artist_payload(row: dict[str, Any]) -> dict[str, Any]:
    raw = _raw_payload(row)
    facets = _facets(raw)
    return {
        "canonical_name": row["title"],
        "sort_name": row["title"],
        "normalized_name": normalize_name(row["title"]),
        "musicbrainz_artist_mbid": row["musicbrainz_artist_mbid"],
        "has_photo": _remote_asset_available(
            row,
            raw,
            facets,
            facet="artist_photo",
            raw_key="has_photo",
        ),
        "genres": _remote_genres(raw),
        "genre_assertions": _remote_genre_assertions(raw),
        "availability": row["availability_json"],
        "facets": facets,
        "raw": raw,
    }


def _remote_album_payload(row: dict[str, Any]) -> dict[str, Any]:
    raw = _raw_payload(row)
    facets = _facets(raw)
    secondary_types = raw.get("release_group_secondary_types") or []
    if not isinstance(secondary_types, list):
        secondary_types = []
    return {
        "canonical_name": row["title"],
        "normalized_name": normalize_name(row["title"], strip_edition=True),
        "artist_name": row["artist"],
        "year": row["year"],
        "release_date": row["release_date"],
        "track_count": row["track_count"],
        "total_duration_seconds": row["duration_seconds"],
        "musicbrainz_release_group_mbid": row["musicbrainz_release_group_mbid"],
        "musicbrainz_release_mbid": row["musicbrainz_release_mbid"],
        "release_group_primary_type": raw.get("release_group_primary_type"),
        "release_group_secondary_types": [
            str(value) for value in secondary_types if value
        ],
        "upc": row["upc"],
        "has_cover": _remote_asset_available(
            row,
            raw,
            facets,
            facet="album_artwork",
            raw_key="has_cover",
        ),
        "genres": _remote_genres(raw),
        "genre_assertions": _remote_genre_assertions(raw),
        "availability": row["availability_json"],
        "artwork": row["artwork_json"],
        "facets": facets,
        "raw": raw,
    }


def _remote_track_payload(row: dict[str, Any]) -> dict[str, Any]:
    raw = _raw_payload(row)
    return {
        "canonical_title": row["title"],
        "normalized_title": normalize_name(row["title"]),
        "artist_name": row["artist"],
        "album_name": row["album"],
        "disc_number": row["disc_number"],
        "track_number": row["track_number"],
        "duration_seconds": row["duration_seconds"],
        "musicbrainz_recording_mbid": row["musicbrainz_recording_mbid"],
        "isrc": row["isrc"],
        "genres": _remote_genres(raw),
        "genre_assertions": _remote_genre_assertions(raw),
        **_remote_audio_features(raw),
        **_remote_quality(raw),
        "availability": row["availability_json"],
        "facets": _facets(raw),
        "raw": raw,
    }


def _raw_payload(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("raw_json")
    return raw if isinstance(raw, dict) else {}


def _facets(raw: dict[str, Any]) -> dict[str, Any]:
    facets = raw.get("facets")
    return facets if isinstance(facets, dict) else {}


def _remote_genres(raw: dict[str, Any]) -> list[str]:
    genres = raw.get("genres")
    if not isinstance(genres, list):
        return []
    values: list[str] = []
    seen: set[str] = set()
    for value in genres:
        genre = str(value or "").strip().lower()
        if not genre or genre in seen:
            continue
        seen.add(genre)
        values.append(genre)
    return values


def _remote_genre_assertions(raw: dict[str, Any]) -> list[dict[str, Any]]:
    assertions = raw.get("genre_assertions")
    if not isinstance(assertions, list):
        return []
    return [assertion for assertion in assertions if isinstance(assertion, dict)]


def _local_genres(value: Any, legacy_genre: Any = None) -> list[dict[str, Any]]:
    """Return local genre assignments as weighted source assertions."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = []

    values: list[dict[str, Any]] = []
    seen: set[str] = set()
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            raw_label = str(item.get("raw_label") or item.get("name") or "").strip()
            if not raw_label or raw_label.lower() in seen:
                continue
            seen.add(raw_label.lower())
            values.append(
                {
                    "raw_label": raw_label,
                    "weight": item.get("weight", 1.0),
                    "confidence": 1.0,
                    "is_direct": True,
                }
            )

    for raw_label in re.split(r"[,;/]", str(legacy_genre or "")):
        raw_label = raw_label.strip()
        if not raw_label or raw_label.lower() in seen:
            continue
        seen.add(raw_label.lower())
        values.append(
            {
                "raw_label": raw_label,
                "weight": 1.0,
                "confidence": 1.0,
                "is_direct": True,
            }
        )
    return values


def _remote_audio_features(raw: dict[str, Any]) -> dict[str, float]:
    features: dict[str, float] = {}
    for key in _REMOTE_AUDIO_KEYS:
        value = raw.get(key)
        if value is None:
            continue
        try:
            features[key] = float(value)
        except (TypeError, ValueError):
            continue
    return features


def _remote_quality(raw: dict[str, Any]) -> dict[str, Any]:
    quality: dict[str, Any] = {}
    fmt = str(raw.get("format") or "").strip().lower()
    if fmt:
        quality["format"] = fmt

    for key in _REMOTE_QUALITY_KEYS:
        value = raw.get(key)
        if value is None:
            continue
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            continue
        if normalized <= 0:
            continue
        quality[key] = normalized
    return quality


def _remote_asset_available(
    row: dict[str, Any],
    raw: dict[str, Any],
    facets: dict[str, Any],
    *,
    facet: str,
    raw_key: str,
) -> bool:
    facet_payload = facets.get(facet)
    if isinstance(facet_payload, dict) and "available" in facet_payload:
        return bool(facet_payload.get("available"))
    if raw_key in raw:
        return bool(raw.get(raw_key))
    return bool(row["artwork_json"])


def _remote_match_key(entity_type: str, payload: dict[str, Any]) -> str:
    if entity_type == "artist":
        return artist_match_key(payload)
    if entity_type == "album":
        return album_match_key(payload)
    return track_match_key(payload)


def _revision(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


def _duration_seconds(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


__all__ = [
    "iter_local_album_sources",
    "iter_local_artist_sources",
    "iter_local_sources",
    "iter_local_track_sources",
    "iter_remote_sources",
]
