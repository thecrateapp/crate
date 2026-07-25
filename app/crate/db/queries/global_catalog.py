"""Read helpers for the federated global catalog."""

from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope
from crate.federation.global_matching import normalize_name
from crate.genre_covers import genre_cover_public_url
from crate.slugs import build_artist_slug, build_public_album_slug


class GlobalCatalogPublicRouteConflict(ValueError):
    """Raised when a human catalog route identifies more than one entity."""


def search_global_catalog(
    query: str,
    limit: int = 20,
    *,
    include_sources: bool = False,
) -> dict[str, list[dict]]:
    q = query.strip()
    capped_limit = max(1, min(int(limit or 20), 50))
    if len(q) < 2:
        return {"artists": [], "albums": [], "tracks": []}

    params = {
        "query": q,
        "pattern": f"%{_escape_like(q)}%",
        "normalized_pattern": f"%{_escape_like(normalize_name(q))}%",
        "limit": capped_limit,
    }
    with read_scope() as session:
        rows = session.execute(_SEARCH_DOCUMENTS_SQL, params).mappings().all()

    projection_ready = any(
        row["entity_type"] == "__projection__" and row["projection_ready"]
        for row in rows
    )
    if not projection_ready:
        return _search_global_catalog_legacy(
            q, capped_limit, include_sources=include_sources
        )

    result: dict[str, list[dict]] = {
        "artists": [],
        "albums": [],
        "tracks": [],
    }
    result_keys = {"artist": "artists", "album": "albums", "track": "tracks"}
    for row in rows:
        result_key = result_keys.get(str(row["entity_type"]))
        if result_key is None:
            continue
        payload_raw = row["payload_json"]
        payload = dict(payload_raw) if isinstance(payload_raw, dict) else {}
        if include_sources:
            payload["source_count"] = int(row["source_count"] or 0)
        result[result_key].append(payload)
    return result


def _search_global_catalog_legacy(
    query: str,
    limit: int,
    *,
    include_sources: bool = False,
) -> dict[str, list[dict]]:
    """Compatibility search while the materialized projection is warming."""
    q = query.strip()
    capped_limit = max(1, min(int(limit or 20), 50))

    params = {
        "query": q,
        "pattern": f"%{_escape_like(q)}%",
        "normalized_pattern": f"%{_escape_like(normalize_name(q))}%",
        "limit": capped_limit,
    }
    with read_scope() as session:
        artists = [
            _artist_payload(row, include_sources=include_sources)
            for row in session.execute(
                _SEARCH_ARTISTS_SQL, {**params, "entity_type": "artist"}
            )
            .mappings()
            .all()
        ]
        albums = [
            _album_payload(row, include_sources=include_sources)
            for row in session.execute(
                _SEARCH_ALBUMS_SQL, {**params, "entity_type": "album"}
            )
            .mappings()
            .all()
        ]
        tracks = [
            _track_payload(row, include_sources=include_sources)
            for row in session.execute(
                _SEARCH_TRACKS_SQL, {**params, "entity_type": "track"}
            )
            .mappings()
            .all()
        ]
    return {"artists": artists, "albums": albums, "tracks": tracks}


_SEARCH_DOCUMENTS_SQL = text(
    """
    WITH projection AS (
        SELECT status IN ('ready', 'refreshing', 'degraded') AS ready
        FROM global_catalog_search_projection_state
        WHERE singleton = true
    ), ranked AS (
        SELECT
            document.entity_type,
            document.payload_json,
            document.source_count,
            true AS projection_ready,
            ROW_NUMBER() OVER (
                PARTITION BY document.entity_type
                ORDER BY
                    document.has_local DESC,
                    document.has_healthy_source DESC,
                    ts_rank_cd(
                        document.search_vector,
                        websearch_to_tsquery('simple', :query)
                    ) DESC,
                    similarity(document.search_text, :query) DESC,
                    document.source_count DESC,
                    document.search_text ASC
            ) AS kind_rank
        FROM global_catalog_search_documents document
        CROSS JOIN projection
        WHERE projection.ready
          AND (
              document.search_vector @@ websearch_to_tsquery('simple', :query)
              OR document.search_text ILIKE :pattern ESCAPE '\\'
              OR document.normalized_text ILIKE :normalized_pattern ESCAPE '\\'
          )
    ), combined AS (
        SELECT entity_type, payload_json, source_count, projection_ready,
               kind_rank, false AS projection_row
        FROM ranked
        WHERE kind_rank <= :limit
        UNION ALL
        SELECT '__projection__', '{}'::jsonb, 0, COALESCE(ready, false),
               0, true
        FROM projection
    )
    SELECT entity_type, payload_json, source_count, projection_ready
    FROM combined
    ORDER BY projection_row, entity_type, kind_rank
    """
)


_SOURCE_HEALTH_SQL = """
    SELECT
        global_entity_uid,
        BOOL_OR(NOT source_stale AND source_deleted_at IS NULL) AS has_healthy_source
    FROM global_catalog_sources
    WHERE entity_type = :entity_type
    GROUP BY global_entity_uid
"""


_SEARCH_ARTISTS_SQL = text(
    f"""
    WITH source_health AS ({_SOURCE_HEALTH_SQL})
    SELECT
        a.global_artist_uid::text AS global_artist_uid,
        a.canonical_name,
        a.local_artist_id,
        a.local_artist_entity_uid::text AS local_artist_entity_uid,
        a.availability_json,
        a.source_count,
        a.has_local,
        a.has_remote,
        a.has_photo,
        COALESCE(sh.has_healthy_source, false) AS has_healthy_source
    FROM global_catalog_artists a
    LEFT JOIN source_health sh ON sh.global_entity_uid = a.global_artist_uid
    WHERE a.search_vector @@ plainto_tsquery('simple', :query)
       OR a.canonical_name ILIKE :pattern ESCAPE '\\'
       OR a.normalized_name ILIKE :normalized_pattern ESCAPE '\\'
    ORDER BY a.has_local DESC, COALESCE(sh.has_healthy_source, false) DESC,
             a.source_count DESC, a.canonical_name ASC
    LIMIT :limit
    """
)


_SEARCH_ALBUMS_SQL = text(
    f"""
    WITH source_health AS ({_SOURCE_HEALTH_SQL})
    SELECT
        a.global_album_uid::text AS global_album_uid,
        a.global_artist_uid::text AS global_artist_uid,
        a.canonical_name,
        a.artist_name,
        a.year,
        a.local_album_id,
        a.local_album_entity_uid::text AS local_album_entity_uid,
        a.availability_json,
        a.source_count,
        a.has_local,
        a.has_remote,
        a.has_cover,
        COALESCE(sh.has_healthy_source, false) AS has_healthy_source
    FROM global_catalog_albums a
    LEFT JOIN source_health sh ON sh.global_entity_uid = a.global_album_uid
    WHERE a.search_vector @@ plainto_tsquery('simple', :query)
       OR a.canonical_name ILIKE :pattern ESCAPE '\\'
       OR a.artist_name ILIKE :pattern ESCAPE '\\'
       OR a.normalized_name ILIKE :normalized_pattern ESCAPE '\\'
    ORDER BY a.has_local DESC, COALESCE(sh.has_healthy_source, false) DESC,
             a.source_count DESC, a.artist_name ASC, a.canonical_name ASC
    LIMIT :limit
    """
)


_SEARCH_TRACKS_SQL = text(
    f"""
    WITH source_health AS ({_SOURCE_HEALTH_SQL})
    SELECT
        t.global_track_uid::text AS global_track_uid,
        t.global_album_uid::text AS global_album_uid,
        t.global_artist_uid::text AS global_artist_uid,
        t.canonical_title,
        t.artist_name,
        t.album_name,
        t.duration_seconds,
        t.local_track_id,
        t.local_track_entity_uid::text AS local_track_entity_uid,
        t.availability_json,
        t.source_count,
        t.has_local,
        t.has_remote,
        COALESCE(sh.has_healthy_source, false) AS has_healthy_source
    FROM global_catalog_tracks t
    LEFT JOIN source_health sh ON sh.global_entity_uid = t.global_track_uid
    WHERE t.search_vector @@ plainto_tsquery('simple', :query)
       OR t.canonical_title ILIKE :pattern ESCAPE '\\'
       OR t.artist_name ILIKE :pattern ESCAPE '\\'
       OR t.album_name ILIKE :pattern ESCAPE '\\'
       OR t.normalized_title ILIKE :normalized_pattern ESCAPE '\\'
    ORDER BY t.has_local DESC, COALESCE(sh.has_healthy_source, false) DESC,
             t.source_count DESC, t.artist_name ASC, t.canonical_title ASC
    LIMIT :limit
    """
)


def get_global_catalog_counts() -> dict[str, int]:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM global_catalog_artists) AS artists,
                        (SELECT COUNT(*) FROM global_catalog_albums) AS albums,
                        (SELECT COUNT(*) FROM global_catalog_tracks) AS tracks,
                        (SELECT COUNT(*) FROM global_catalog_sources) AS sources
                    """
                )
            )
            .mappings()
            .one()
        )
    return {
        "artists": int(row["artists"]),
        "albums": int(row["albums"]),
        "tracks": int(row["tracks"]),
        "sources": int(row["sources"]),
    }


def list_global_catalog_genres() -> list[dict]:
    """List core genres with direct and hierarchy-expanded catalog support."""
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    WITH RECURSIVE inherited AS (
                        SELECT
                            membership.entity_type,
                            membership.global_entity_uid,
                            membership.global_genre_uid,
                            membership.global_genre_uid AS direct_genre_uid
                        FROM global_catalog_entity_genres membership
                        WHERE membership.aggregate_score >= 0.700
                        UNION
                        SELECT
                            inherited.entity_type,
                            inherited.global_entity_uid,
                            parent.global_genre_uid,
                            inherited.direct_genre_uid
                        FROM inherited
                        JOIN genre_taxonomy_nodes child
                          ON child.taxonomy_id = 'crate-core'
                         AND child.global_genre_uid = inherited.global_genre_uid
                        JOIN genre_taxonomy_edges edge
                          ON edge.source_genre_id = child.id
                         AND edge.relation_type = 'parent'
                         AND edge.locked
                        JOIN genre_taxonomy_nodes parent ON parent.id = edge.target_genre_id
                    )
                    SELECT
                        taxonomy.global_genre_uid::text AS global_genre_uid,
                        taxonomy.slug AS canonical_slug,
                        taxonomy.name AS canonical_name,
                        COUNT(DISTINCT (
                            inherited.entity_type::text || ':' || inherited.global_entity_uid::text
                        ))::integer AS entity_count,
                        COUNT(DISTINCT inherited.global_entity_uid)
                            FILTER (WHERE inherited.entity_type = 'artist')::integer
                            AS artist_count,
                        COUNT(DISTINCT inherited.global_entity_uid)
                            FILTER (WHERE inherited.entity_type = 'album')::integer
                            AS album_count,
                        COUNT(DISTINCT inherited.global_entity_uid)
                            FILTER (WHERE inherited.entity_type = 'track')::integer
                            AS track_count
                    FROM genre_taxonomy_nodes taxonomy
                    LEFT JOIN inherited
                      ON inherited.global_genre_uid = taxonomy.global_genre_uid
                    WHERE taxonomy.taxonomy_id = 'crate-core'
                      AND taxonomy.origin = 'core'
                    GROUP BY taxonomy.global_genre_uid, taxonomy.slug, taxonomy.name
                    ORDER BY entity_count DESC, taxonomy.name ASC
                    """
                )
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_global_genre_detail(slug: str) -> dict | None:
    """Return canonical genre members, expanding only locked core parents."""
    from crate.genre_taxonomy import (
        get_core_taxonomy_descriptor,
        resolve_genre_slug,
    )

    canonical_slug = resolve_genre_slug(slug) or str(slug or "").strip().lower()
    if not canonical_slug:
        return None
    with read_scope() as session:
        taxonomy = (
            session.execute(
                text(
                    """
                    SELECT
                        global_genre_uid::text AS global_genre_uid,
                        slug,
                        name,
                        description,
                        external_description,
                        cover_path
                    FROM genre_taxonomy_nodes
                    WHERE taxonomy_id = 'crate-core'
                      AND slug = :slug
                      AND origin = 'core'
                    """
                ),
                {"slug": canonical_slug},
            )
            .mappings()
            .first()
        )
        if taxonomy is None:
            return None

        artists = (
            session.execute(
                _GLOBAL_GENRE_ARTISTS_SQL,
                {"global_genre_uid": taxonomy["global_genre_uid"]},
            )
            .mappings()
            .all()
        )
        albums = (
            session.execute(
                _GLOBAL_GENRE_ALBUMS_SQL,
                {"global_genre_uid": taxonomy["global_genre_uid"]},
            )
            .mappings()
            .all()
        )
        related_genres = (
            session.execute(
                _GLOBAL_GENRE_RELATED_SQL,
                {"global_genre_uid": taxonomy["global_genre_uid"]},
            )
            .mappings()
            .all()
        )

    artist_payloads = [dict(row) for row in artists]
    description = taxonomy.get("description") or taxonomy.get("external_description")

    return {
        "id": 0,
        "name": taxonomy["name"],
        "slug": taxonomy["slug"],
        "global_genre_uid": taxonomy["global_genre_uid"],
        "canonical_slug": taxonomy["slug"],
        "canonical_name": taxonomy["name"],
        "description": description,
        "canonical_description": description,
        "cover_url": _global_genre_cover_url(dict(taxonomy)),
        "artist_count": len(artists),
        "album_count": len(albums),
        "track_count": sum(int(row.get("track_count") or 0) for row in albums),
        "taxonomy": {
            "id": get_core_taxonomy_descriptor()["taxonomy_id"],
            "version": get_core_taxonomy_descriptor()["version"],
            "digest": get_core_taxonomy_descriptor()["digest"],
        },
        "artists": artist_payloads,
        "albums": [dict(row) for row in albums],
        "related_genres": [dict(row) for row in related_genres],
        "shows": [],
    }


def _global_genre_cover_url(taxonomy: dict) -> str | None:
    if taxonomy.get("cover_path"):
        return genre_cover_public_url(str(taxonomy["slug"]), size=1280)
    return None


_GLOBAL_GENRE_ARTISTS_SQL = text(
    """
    WITH RECURSIVE inherited AS (
        SELECT
            membership.entity_type,
            membership.global_entity_uid,
            membership.global_genre_uid,
            membership.global_genre_uid AS direct_genre_uid,
            membership.supporting_source_count
        FROM global_catalog_entity_genres membership
        WHERE membership.entity_type = 'artist'
          AND membership.aggregate_score >= 0.700
        UNION
        SELECT
            inherited.entity_type,
            inherited.global_entity_uid,
            parent.global_genre_uid,
            inherited.direct_genre_uid,
            inherited.supporting_source_count
        FROM inherited
        JOIN genre_taxonomy_nodes child
          ON child.taxonomy_id = 'crate-core'
         AND child.global_genre_uid = inherited.global_genre_uid
        JOIN genre_taxonomy_edges edge
          ON edge.source_genre_id = child.id
         AND edge.relation_type = 'parent'
         AND edge.locked
        JOIN genre_taxonomy_nodes parent ON parent.id = edge.target_genre_id
    )
    SELECT DISTINCT ON (artist.global_artist_uid)
        artist.global_artist_uid::text AS global_artist_uid,
        artist.canonical_name AS artist_name,
        artist.local_artist_id AS artist_id,
        artist.local_artist_entity_uid::text AS artist_entity_uid,
        local_artist.slug AS artist_slug,
        COALESCE(album_counts.album_count, 0)::integer AS album_count,
        COALESCE(track_counts.track_count, 0)::integer AS track_count,
        artist.has_photo,
        CASE WHEN artist.has_photo
            THEN '/api/catalog/artists/' || artist.global_artist_uid::text || '/photo'
            ELSE NULL
        END AS photo_url,
        local_artist.listeners,
        CASE
            WHEN inherited.direct_genre_uid = CAST(:global_genre_uid AS uuid)
            THEN 'direct'
            ELSE 'inherited'
        END AS membership,
        inherited.supporting_source_count
    FROM inherited
    JOIN global_catalog_artists artist
      ON artist.global_artist_uid = inherited.global_entity_uid
    LEFT JOIN library_artists local_artist ON local_artist.id = artist.local_artist_id
    LEFT JOIN (
        SELECT global_artist_uid, COUNT(*)::integer AS album_count
        FROM global_catalog_albums
        GROUP BY global_artist_uid
    ) album_counts ON album_counts.global_artist_uid = artist.global_artist_uid
    LEFT JOIN (
        SELECT global_artist_uid, COUNT(*)::integer AS track_count
        FROM global_catalog_tracks
        GROUP BY global_artist_uid
    ) track_counts ON track_counts.global_artist_uid = artist.global_artist_uid
    WHERE inherited.global_genre_uid = CAST(:global_genre_uid AS uuid)
    ORDER BY artist.global_artist_uid,
             (inherited.direct_genre_uid = CAST(:global_genre_uid AS uuid)) DESC,
             inherited.supporting_source_count DESC
    """
)


_GLOBAL_GENRE_ALBUMS_SQL = text(
    """
    WITH RECURSIVE inherited AS (
        SELECT
            membership.entity_type,
            membership.global_entity_uid,
            membership.global_genre_uid,
            membership.global_genre_uid AS direct_genre_uid,
            membership.supporting_source_count
        FROM global_catalog_entity_genres membership
        WHERE membership.entity_type = 'album'
          AND membership.aggregate_score >= 0.700
        UNION
        SELECT
            inherited.entity_type,
            inherited.global_entity_uid,
            parent.global_genre_uid,
            inherited.direct_genre_uid,
            inherited.supporting_source_count
        FROM inherited
        JOIN genre_taxonomy_nodes child
          ON child.taxonomy_id = 'crate-core'
         AND child.global_genre_uid = inherited.global_genre_uid
        JOIN genre_taxonomy_edges edge
          ON edge.source_genre_id = child.id
         AND edge.relation_type = 'parent'
         AND edge.locked
        JOIN genre_taxonomy_nodes parent ON parent.id = edge.target_genre_id
    )
    SELECT DISTINCT ON (album.global_album_uid)
        album.global_album_uid::text AS global_album_uid,
        album.local_album_id AS album_id,
        album.local_album_entity_uid::text AS album_entity_uid,
        local_album.slug AS album_slug,
        album.artist_name AS artist,
        artist.local_artist_id AS artist_id,
        artist.local_artist_entity_uid::text AS artist_entity_uid,
        local_artist.slug AS artist_slug,
        album.canonical_name AS name,
        COALESCE(album.year, '') AS year,
        COALESCE(album.track_count, 0)::integer AS track_count,
        album.has_cover,
        CASE WHEN album.has_cover
            THEN '/api/catalog/albums/' || album.global_album_uid::text || '/cover'
            ELSE NULL
        END AS cover_url,
        CASE
            WHEN inherited.direct_genre_uid = CAST(:global_genre_uid AS uuid)
            THEN 'direct'
            ELSE 'inherited'
        END AS membership,
        inherited.supporting_source_count
    FROM inherited
    JOIN global_catalog_albums album
      ON album.global_album_uid = inherited.global_entity_uid
    JOIN global_catalog_artists artist ON artist.global_artist_uid = album.global_artist_uid
    LEFT JOIN library_albums local_album ON local_album.id = album.local_album_id
    LEFT JOIN library_artists local_artist ON local_artist.id = artist.local_artist_id
    WHERE inherited.global_genre_uid = CAST(:global_genre_uid AS uuid)
    ORDER BY album.global_album_uid,
             (inherited.direct_genre_uid = CAST(:global_genre_uid AS uuid)) DESC,
             inherited.supporting_source_count DESC
    """
)


_GLOBAL_GENRE_RELATED_SQL = text(
    """
    WITH RECURSIVE inherited AS (
        SELECT
            membership.entity_type,
            membership.global_entity_uid,
            membership.global_genre_uid
        FROM global_catalog_entity_genres membership
        WHERE membership.entity_type IN ('artist', 'album')
          AND membership.aggregate_score >= 0.700
        UNION
        SELECT
            inherited.entity_type,
            inherited.global_entity_uid,
            parent.global_genre_uid
        FROM inherited
        JOIN genre_taxonomy_nodes child
          ON child.taxonomy_id = 'crate-core'
         AND child.global_genre_uid = inherited.global_genre_uid
        JOIN genre_taxonomy_edges parent_edge
          ON parent_edge.source_genre_id = child.id
         AND parent_edge.relation_type = 'parent'
         AND parent_edge.locked
        JOIN genre_taxonomy_nodes parent ON parent.id = parent_edge.target_genre_id
    )
    SELECT
        related.slug,
        related.name,
        related.slug AS page_slug,
        edge.relation_type,
        CASE edge.relation_type
            WHEN 'parent' THEN 'Parent genre'
            WHEN 'related' THEN 'Related'
            ELSE edge.relation_type
        END AS relation_label,
        COALESCE(related.description, related.external_description) AS description,
        COALESCE(counts.artist_count, 0)::integer AS artist_count,
        COALESCE(counts.album_count, 0)::integer AS album_count,
        (
            COALESCE(counts.artist_count, 0) * 3
            + COALESCE(counts.album_count, 0)
        )::integer AS content_score,
        CASE
            WHEN NULLIF(related.cover_path, '') IS NOT NULL THEN
                '/api/genres/' || related.slug || '/cover?size=640&format=webp'
            ELSE NULL
        END AS cover_url,
        top_artist.global_artist_uid::text AS top_artist_global_uid,
        top_artist.local_artist_id AS top_artist_id,
        CASE
            WHEN top_artist.global_artist_uid IS NOT NULL THEN
                '/api/catalog/artists/' || top_artist.global_artist_uid::text
                || '/photo?size=640&format=webp'
            ELSE NULL
        END AS top_artist_photo_url
    FROM genre_taxonomy_nodes source
    JOIN genre_taxonomy_edges edge
      ON edge.source_genre_id = source.id
     AND edge.locked
    JOIN genre_taxonomy_nodes related ON related.id = edge.target_genre_id
    LEFT JOIN LATERAL (
        SELECT
            COUNT(DISTINCT inherited.global_entity_uid)
                FILTER (WHERE inherited.entity_type = 'artist') AS artist_count,
            COUNT(DISTINCT inherited.global_entity_uid)
                FILTER (WHERE inherited.entity_type = 'album') AS album_count
        FROM inherited
        WHERE inherited.global_genre_uid = related.global_genre_uid
    ) counts ON TRUE
    LEFT JOIN LATERAL (
        SELECT artist.global_artist_uid, artist.local_artist_id
        FROM global_catalog_artists artist
        WHERE artist.has_photo
          AND EXISTS (
              SELECT 1
              FROM inherited
              WHERE inherited.entity_type = 'artist'
                AND inherited.global_entity_uid = artist.global_artist_uid
                AND inherited.global_genre_uid = related.global_genre_uid
          )
        ORDER BY
            artist.has_local DESC,
            artist.source_count DESC,
            artist.canonical_name ASC
        LIMIT 1
    ) top_artist ON TRUE
    WHERE source.taxonomy_id = 'crate-core'
      AND source.global_genre_uid = CAST(:global_genre_uid AS uuid)
      AND related.taxonomy_id = 'crate-core'
      AND edge.relation_type IN ('parent', 'related')
      AND (
          COALESCE(counts.artist_count, 0) > 0
          OR COALESCE(counts.album_count, 0) > 0
      )
    ORDER BY edge.relation_type, related.name
    """
)


def get_global_track_genres(global_track_uid: str) -> dict | None:
    """Return direct canonical genre assignments for a canonical or local track UID."""
    with read_scope() as session:
        track = (
            session.execute(
                text(
                    """
                    SELECT global_track_uid::text AS global_track_uid
                    FROM global_catalog_tracks
                    WHERE global_track_uid = CAST(:track_uid AS uuid)
                       OR local_track_entity_uid = CAST(:track_uid AS uuid)
                    LIMIT 1
                    """
                ),
                {"track_uid": global_track_uid},
            )
            .mappings()
            .first()
        )
        if track is None:
            return None
        genres = (
            session.execute(
                text(
                    """
                    SELECT
                        membership.global_genre_uid::text AS global_genre_uid,
                        taxonomy.slug AS canonical_slug,
                        'direct' AS membership,
                        membership.supporting_source_count
                    FROM global_catalog_entity_genres membership
                    JOIN genre_taxonomy_nodes taxonomy
                      ON taxonomy.taxonomy_id = 'crate-core'
                     AND taxonomy.global_genre_uid = membership.global_genre_uid
                    WHERE membership.entity_type = 'track'
                      AND membership.global_entity_uid = CAST(:global_track_uid AS uuid)
                    ORDER BY membership.preferred_for_display DESC,
                             membership.aggregate_score DESC,
                             taxonomy.slug ASC
                    """
                ),
                {"global_track_uid": track["global_track_uid"]},
            )
            .mappings()
            .all()
        )
    from crate.genre_taxonomy import get_core_taxonomy_descriptor

    descriptor = get_core_taxonomy_descriptor()
    return {
        "global_track_uid": track["global_track_uid"],
        "taxonomy": {
            "id": descriptor["taxonomy_id"],
            "version": descriptor["version"],
            "digest": descriptor["digest"],
        },
        "genres": [dict(row) for row in genres],
    }


def get_global_decade_artists(
    *,
    decade_start: int,
    decade_end: int,
    page: int = 1,
    per_page: int = 50,
) -> dict:
    safe_page = max(1, int(page or 1))
    safe_per_page = max(1, min(int(per_page or 50), 120))
    params = {
        "decade_start": int(decade_start),
        "decade_end": int(decade_end),
        "limit": safe_per_page,
        "offset": (safe_page - 1) * safe_per_page,
    }
    with read_scope() as session:
        total = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(DISTINCT ar.global_artist_uid)
                    FROM global_catalog_artists ar
                    JOIN global_catalog_albums al
                      ON al.global_artist_uid = ar.global_artist_uid
                    WHERE NULLIF(substring(COALESCE(al.year, '') from '([0-9]{4})'), '')::integer
                          BETWEEN :decade_start AND :decade_end
                      AND (ar.has_local OR ar.has_remote)
                    """
                ),
                params,
            ).scalar()
            or 0
        )
        rows = (
            session.execute(
                text(
                    """
                    WITH matching_artists AS (
                        SELECT DISTINCT
                            ar.global_artist_uid,
                            ar.canonical_name,
                            ar.local_artist_id,
                            ar.local_artist_entity_uid,
                            ar.availability_json,
                            ar.source_count,
                            ar.has_local,
                            ar.has_remote,
                            ar.has_photo
                        FROM global_catalog_artists ar
                        JOIN global_catalog_albums al
                          ON al.global_artist_uid = ar.global_artist_uid
                        WHERE NULLIF(substring(COALESCE(al.year, '') from '([0-9]{4})'), '')::integer
                              BETWEEN :decade_start AND :decade_end
                          AND (ar.has_local OR ar.has_remote)
                    )
                    SELECT
                        m.global_artist_uid::text AS global_artist_uid,
                        m.canonical_name,
                        m.local_artist_id,
                        m.local_artist_entity_uid::text AS local_artist_entity_uid,
                        m.availability_json,
                        m.source_count,
                        m.has_local,
                        m.has_remote,
                        m.has_photo,
                        COUNT(DISTINCT al.global_album_uid) AS album_count,
                        COUNT(DISTINCT t.global_track_uid) AS track_count,
                        true AS has_healthy_source
                    FROM matching_artists m
                    LEFT JOIN global_catalog_albums al
                      ON al.global_artist_uid = m.global_artist_uid
                    LEFT JOIN global_catalog_tracks t
                      ON t.global_artist_uid = m.global_artist_uid
                    GROUP BY
                        m.global_artist_uid,
                        m.canonical_name,
                        m.local_artist_id,
                        m.local_artist_entity_uid,
                        m.availability_json,
                        m.source_count,
                        m.has_local,
                        m.has_remote,
                        m.has_photo
                    ORDER BY
                        m.has_local DESC,
                        m.has_remote DESC,
                        m.source_count DESC,
                        m.canonical_name ASC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )

    items = [
        {
            "id": row["local_artist_id"],
            "entity_uid": row["local_artist_entity_uid"],
            "local_artist_entity_uid": row["local_artist_entity_uid"],
            "global_uid": row["global_artist_uid"],
            "global_artist_uid": row["global_artist_uid"],
            "name": row["canonical_name"],
            "albums": int(row["album_count"] or 0),
            "tracks": int(row["track_count"] or 0),
            "total_size_mb": 0,
            "formats": [],
            "primary_format": None,
            "has_photo": bool(row["has_photo"]),
            "has_issues": False,
            "popularity": None,
            "popularity_score": None,
            "popularity_confidence": None,
            "availability": _availability(row),
        }
        for row in rows
    ]
    return {
        "items": items,
        "total": total,
        "page": safe_page,
        "per_page": safe_per_page,
    }


def get_global_artist_page(
    global_artist_uid: str, *, top_tracks_limit: int = 12
) -> dict | None:
    capped_top_tracks_limit = max(1, min(int(top_tracks_limit or 12), 50))
    with read_scope() as session:
        artist = (
            session.execute(
                text(
                    """
                    SELECT
                        global_artist_uid::text AS global_artist_uid,
                        canonical_name,
                        local_artist_id,
                        local_artist_entity_uid::text AS local_artist_entity_uid,
                        availability_json,
                        source_count,
                        has_local,
                        has_remote,
                        has_photo,
                        (
                            SELECT COUNT(*)::integer
                            FROM global_catalog_tracks track
                            WHERE track.global_artist_uid = global_catalog_artists.global_artist_uid
                        ) AS total_tracks,
                        true AS has_healthy_source
                    FROM global_catalog_artists
                    WHERE global_artist_uid = :global_artist_uid
                    """
                ),
                {"global_artist_uid": global_artist_uid},
            )
            .mappings()
            .first()
        )
        if not artist:
            return None

        albums = [
            _album_payload(row, include_sources=False)
            for row in session.execute(
                text(
                    """
                    SELECT
                        global_album_uid::text AS global_album_uid,
                        global_artist_uid::text AS global_artist_uid,
                        canonical_name,
                        artist_name,
                        year,
                        (
                            SELECT COUNT(*)::integer
                            FROM global_catalog_tracks track
                            WHERE track.global_album_uid = global_catalog_albums.global_album_uid
                        ) AS track_count,
                        local_album_id,
                        local_album_entity_uid::text AS local_album_entity_uid,
                        availability_json,
                        source_count,
                        has_local,
                        has_remote,
                        has_cover,
                        true AS has_healthy_source
                    FROM global_catalog_albums
                    WHERE global_artist_uid = :global_artist_uid
                    ORDER BY COALESCE(year, '') DESC, canonical_name ASC
                    """
                ),
                {"global_artist_uid": global_artist_uid},
            )
            .mappings()
            .all()
        ]
        top_tracks = [
            _artist_top_track_payload(row)
            for row in session.execute(
                text(
                    """
                    SELECT
                        global_track_uid::text AS global_track_uid,
                        global_album_uid::text AS global_album_uid,
                        global_artist_uid::text AS global_artist_uid,
                        canonical_title,
                        artist_name,
                        album_name,
                        disc_number,
                        track_number,
                        duration_seconds,
                        local_track_id,
                        local_track_entity_uid::text AS local_track_entity_uid,
                        NULL::integer AS local_album_id,
                        availability_json,
                        source_count,
                        has_local,
                        has_remote,
                        true AS has_healthy_source
                    FROM global_catalog_tracks
                    WHERE global_artist_uid = :global_artist_uid
                    ORDER BY has_local DESC, source_count DESC, canonical_title ASC
                    LIMIT :top_tracks_limit
                    """
                ),
                {
                    "global_artist_uid": global_artist_uid,
                    "top_tracks_limit": capped_top_tracks_limit,
                },
            )
            .mappings()
            .all()
        ]

    artist_payload = _artist_payload(artist, include_sources=False)
    artist_payload["albums"] = albums
    artist_payload["total_tracks"] = int(artist["total_tracks"] or 0)
    artist_payload.setdefault("total_size_mb", 0)
    artist_payload.setdefault("primary_format", None)
    artist_payload.setdefault("genres", [])
    artist_payload.setdefault("issue_count", 0)
    artist_payload.setdefault("is_v2", False)
    return {
        "artist": artist_payload,
        "info": {
            "bio": "",
            "tags": [],
            "similar": [],
            "listeners": 0,
            "playcount": 0,
            "image_url": None,
            "url": "",
        },
        "top_tracks": top_tracks,
        "shows": {"events": [], "configured": False, "source": "none"},
        "appears_on": [],
        "enrichment": {},
        "artist_hot_rank": None,
    }


def get_global_artist_page_by_public_slug(
    artist_slug: str, *, top_tracks_limit: int = 12
) -> dict | None:
    global_artist_uid = _global_artist_uid_by_public_slug(artist_slug)
    if not global_artist_uid:
        return None
    return get_global_artist_page(global_artist_uid, top_tracks_limit=top_tracks_limit)


def get_global_album_detail(global_album_uid: str) -> dict | None:
    with read_scope() as session:
        album = (
            session.execute(
                text(
                    """
                    SELECT
                        global_album_uid::text AS global_album_uid,
                        global_artist_uid::text AS global_artist_uid,
                        canonical_name,
                        artist_name,
                        year,
                        local_album_id,
                        local_album_entity_uid::text AS local_album_entity_uid,
                        availability_json,
                        source_count,
                        has_local,
                        has_remote,
                        has_cover,
                        true AS has_healthy_source
                    FROM global_catalog_albums
                    WHERE global_album_uid = :global_album_uid
                    """
                ),
                {"global_album_uid": global_album_uid},
            )
            .mappings()
            .first()
        )
        if not album:
            return None
        tracks = [
            _album_track_payload(row)
            for row in session.execute(
                text(
                    """
                    SELECT
                        t.global_track_uid::text AS global_track_uid,
                        t.global_album_uid::text AS global_album_uid,
                        t.global_artist_uid::text AS global_artist_uid,
                        t.canonical_title,
                        t.artist_name,
                        t.album_name,
                        t.disc_number,
                        t.track_number,
                        t.duration_seconds,
                        t.local_track_id,
                        t.local_track_entity_uid::text AS local_track_entity_uid,
                        t.availability_json,
                        t.source_count,
                        t.has_local,
                        t.has_remote,
                        COALESCE(NULLIF(LOWER(lt.format), ''), qs.source_payload_json->>'format') AS format,
                        COALESCE(
                            CASE
                                WHEN lt.bitrate IS NULL THEN NULL
                                ELSE FLOOR(lt.bitrate / 1000.0)::integer
                            END,
                            NULLIF(qs.source_payload_json->>'bitrate', '')::integer
                        ) AS bitrate,
                        COALESCE(lt.sample_rate, NULLIF(qs.source_payload_json->>'sample_rate', '')::integer) AS sample_rate,
                        COALESCE(lt.bit_depth, NULLIF(qs.source_payload_json->>'bit_depth', '')::integer) AS bit_depth,
                        COALESCE(lt.size, NULLIF(qs.source_payload_json->>'size_bytes', '')::bigint) AS size_bytes,
                        true AS has_healthy_source
                    FROM global_catalog_tracks t
                    LEFT JOIN library_tracks lt ON lt.id = t.local_track_id
                    LEFT JOIN LATERAL (
                        SELECT source_payload_json
                        FROM global_catalog_sources s
                        WHERE s.entity_type = 'track'
                          AND s.global_entity_uid = t.global_track_uid
                          AND NOT s.source_stale
                          AND s.source_deleted_at IS NULL
                        ORDER BY
                            (s.source_kind = 'local') DESC,
                            s.preferred_for_playback DESC,
                            s.preferred_for_display DESC,
                            s.updated_at DESC
                        LIMIT 1
                    ) qs ON true
                    WHERE t.global_album_uid = :global_album_uid
                    ORDER BY COALESCE(t.disc_number, 1), COALESCE(t.track_number, 0),
                             t.canonical_title ASC
                    """
                ),
                {"global_album_uid": global_album_uid},
            )
            .mappings()
            .all()
        ]

    payload = _album_payload(album, include_sources=False)
    payload["tracks"] = tracks
    payload["track_count"] = len(tracks)
    payload["display_name"] = payload["name"]
    payload["path"] = ""
    payload["total_size_mb"] = 0
    payload["total_length_sec"] = sum(
        int(track.get("length_sec") or 0) for track in tracks
    )
    payload["cover_file"] = None
    payload["album_tags"] = {
        "artist": payload["artist"],
        "album": payload["name"],
        "year": str(payload.get("year") or ""),
        "genre": "",
        "musicbrainz_albumid": None,
    }
    payload["genres"] = []
    payload["contributors"] = []
    payload["playable_track_count"] = len(
        [track for track in tracks if track.get("is_available") is not False]
    )
    payload["cover_url"] = f"/api/catalog/albums/{global_album_uid}/cover"
    return payload


def get_global_album_detail_by_public_slugs(
    artist_slug: str, album_slug: str
) -> dict | None:
    global_artist_uid = _global_artist_uid_by_public_slug(artist_slug)
    if not global_artist_uid:
        return None

    requested_slug = _public_album_slug(album_slug)
    if not requested_slug:
        return None
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT global_album_uid::text AS global_album_uid
                    FROM global_catalog_album_route_aliases
                    WHERE global_artist_uid = :global_artist_uid
                      AND slug = :public_slug
                    UNION
                    SELECT global_album_uid::text AS global_album_uid
                    FROM global_catalog_albums
                    WHERE global_artist_uid = :global_artist_uid
                      AND public_slug = :public_slug
                    """
                ),
                {
                    "global_artist_uid": global_artist_uid,
                    "public_slug": requested_slug,
                },
            )
            .mappings()
            .all()
        )
    matches = [row["global_album_uid"] for row in rows]
    global_album_uid = _single_public_route_match(
        matches, f"/artists/{_public_artist_slug(artist_slug)}/{requested_slug}"
    )
    if not global_album_uid:
        return None
    return get_global_album_detail(global_album_uid)


def get_global_track_info(global_track_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        global_track_uid::text AS global_track_uid,
                        global_artist_uid::text AS global_artist_uid,
                        global_album_uid::text AS global_album_uid,
                        canonical_title AS title,
                        artist_name AS artist,
                        album_name AS album,
                        local_track_id,
                        local_track_entity_uid::text AS local_track_entity_uid
                    FROM global_catalog_tracks
                    WHERE global_track_uid = :global_track_uid
                    """
                ),
                {"global_track_uid": global_track_uid},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    payload = dict(row)
    payload["entity_uid"] = payload.get("local_track_entity_uid")
    return payload


def get_global_radio_seed_tracks(
    seed_type: str,
    global_uid: str,
    *,
    limit: int = 120,
    session=None,
) -> dict | None:
    """Return a deterministic playable global queue for a radio seed."""
    normalized_type = (seed_type or "").strip().lower()
    capped = max(1, min(int(limit or 120), 5_000))
    if normalized_type not in {"artist", "album", "track"}:
        return None

    with optional_scope(session) as s:
        seed = _global_radio_seed_row(s, normalized_type, global_uid)
        if not seed:
            return None
        rows = (
            s.execute(
                _global_radio_tracks_sql(normalized_type),
                {
                    "global_uid": global_uid,
                    "global_artist_uid": seed.get("global_artist_uid"),
                    "limit": capped,
                },
            )
            .mappings()
            .all()
        )

    tracks = [_global_radio_track_payload(row) for row in rows]
    if not tracks:
        return None
    return {"seed_label": seed["seed_label"], "tracks": tracks}


def _global_radio_seed_row(session, seed_type: str, global_uid: str) -> dict | None:
    if seed_type == "artist":
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        global_artist_uid::text AS global_artist_uid,
                        canonical_name AS seed_label
                    FROM global_catalog_artists
                    WHERE global_artist_uid = :global_uid
                    """
                ),
                {"global_uid": global_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if seed_type == "album":
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        global_artist_uid::text AS global_artist_uid,
                        canonical_name || ' — ' || artist_name AS seed_label
                    FROM global_catalog_albums
                    WHERE global_album_uid = :global_uid
                    """
                ),
                {"global_uid": global_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    row = (
        session.execute(
            text(
                """
                SELECT
                    global_artist_uid::text AS global_artist_uid,
                    canonical_title || ' — ' || artist_name AS seed_label
                FROM global_catalog_tracks
                WHERE global_track_uid = :global_uid
                """
            ),
            {"global_uid": global_uid},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def _global_radio_tracks_sql(seed_type: str):
    if seed_type == "artist":
        where_sql = "t.global_artist_uid = :global_uid"
        order_sql = "COALESCE(a.year, '') DESC, a.canonical_name ASC, COALESCE(t.disc_number, 1), COALESCE(t.track_number, 0), t.canonical_title ASC"
    elif seed_type == "album":
        where_sql = "t.global_album_uid = :global_uid"
        order_sql = "COALESCE(t.disc_number, 1), COALESCE(t.track_number, 0), t.canonical_title ASC"
    else:
        where_sql = "t.global_artist_uid = :global_artist_uid"
        order_sql = "CASE WHEN t.global_track_uid = :global_uid THEN 0 ELSE 1 END, COALESCE(a.year, '') DESC, a.canonical_name ASC, COALESCE(t.disc_number, 1), COALESCE(t.track_number, 0), t.canonical_title ASC"

    return text(
        f"""
        SELECT
            t.global_track_uid::text AS global_track_uid,
            t.global_album_uid::text AS global_album_uid,
            t.global_artist_uid::text AS global_artist_uid,
            t.canonical_title,
            t.artist_name,
            t.album_name,
            t.duration_seconds,
            t.local_track_id,
            t.local_track_entity_uid::text AS local_track_entity_uid,
            t.disc_number,
            t.track_number,
            t.has_local,
            t.has_remote,
            t.availability_json,
            COALESCE(
                taf.bpm,
                lt.bpm,
                NULLIF(preferred_source.source_payload_json->>'bpm', '')::double precision
            ) AS bpm,
            COALESCE(taf.audio_key, lt.audio_key) AS audio_key,
            COALESCE(taf.audio_scale, lt.audio_scale) AS audio_scale,
            COALESCE(
                taf.energy,
                lt.energy,
                NULLIF(preferred_source.source_payload_json->>'energy', '')::double precision
            ) AS energy,
            COALESCE(
                taf.danceability,
                lt.danceability,
                NULLIF(preferred_source.source_payload_json->>'danceability', '')::double precision
            ) AS danceability,
            COALESCE(
                taf.valence,
                lt.valence,
                NULLIF(preferred_source.source_payload_json->>'valence', '')::double precision
            ) AS valence,
            COALESCE(tbe.bliss_vector, lt.bliss_vector) AS bliss_vector,
            COALESCE(genre_sources.genres, '[]'::jsonb) AS genres,
            a.local_album_id,
            a.year,
            a.local_album_entity_uid::text AS local_album_entity_uid,
            ar.local_artist_id,
            ar.local_artist_entity_uid::text AS local_artist_entity_uid
        FROM global_catalog_tracks t
        LEFT JOIN library_tracks lt
          ON lt.id = t.local_track_id
        LEFT JOIN track_analysis_features taf
          ON taf.track_id = lt.id
        LEFT JOIN track_bliss_embeddings tbe
          ON tbe.track_id = lt.id
        LEFT JOIN global_catalog_albums a
          ON a.global_album_uid = t.global_album_uid
        LEFT JOIN global_catalog_artists ar
          ON ar.global_artist_uid = t.global_artist_uid
        LEFT JOIN LATERAL (
            SELECT source_payload_json
            FROM global_catalog_sources source
            WHERE source.entity_type = 'track'
              AND source.global_entity_uid = t.global_track_uid
              AND NOT source.source_stale
              AND source.source_deleted_at IS NULL
            ORDER BY
                (source.source_kind = 'local') DESC,
                source.preferred_for_playback DESC,
                source.preferred_for_display DESC,
                source.updated_at DESC
            LIMIT 1
        ) preferred_source ON TRUE
        LEFT JOIN LATERAL (
            SELECT COALESCE(
                jsonb_agg(DISTINCT taxonomy.name ORDER BY taxonomy.name),
                '[]'::jsonb
            ) AS genres
            FROM global_catalog_entity_genres membership
            JOIN genre_taxonomy_nodes taxonomy
              ON taxonomy.taxonomy_id = 'crate-core'
             AND taxonomy.global_genre_uid = membership.global_genre_uid
            WHERE (
                (membership.entity_type = 'track'
                    AND membership.global_entity_uid = t.global_track_uid)
                OR (membership.entity_type = 'album'
                    AND membership.global_entity_uid = t.global_album_uid)
                OR (membership.entity_type = 'artist'
                    AND membership.global_entity_uid = t.global_artist_uid)
            )
        ) genre_sources ON TRUE
        WHERE {where_sql}
          AND (t.has_local OR t.has_remote)
        ORDER BY {order_sql}
        LIMIT :limit
        """
    )


def _global_radio_track_payload(row) -> dict:
    data = dict(row)
    bliss_vector = data.get("bliss_vector")
    return {
        "track_id": data["local_track_id"],
        "global_track_uid": data["global_track_uid"],
        "global_artist_uid": data["global_artist_uid"],
        "global_album_uid": data["global_album_uid"],
        "entity_uid": data["local_track_entity_uid"],
        "track_entity_uid": data["local_track_entity_uid"],
        "title": data["canonical_title"],
        "artist": data["artist_name"],
        "artist_id": data["local_artist_id"],
        "artist_entity_uid": data["local_artist_entity_uid"],
        "album": data["album_name"],
        "album_id": data["local_album_id"],
        "album_entity_uid": data["local_album_entity_uid"],
        "duration": data["duration_seconds"],
        "year": data.get("year"),
        "bpm": data.get("bpm"),
        "audio_key": data.get("audio_key"),
        "audio_scale": data.get("audio_scale"),
        "energy": data.get("energy"),
        "danceability": data.get("danceability"),
        "valence": data.get("valence"),
        "bliss_vector": list(bliss_vector) if bliss_vector is not None else None,
        "genres": _coerce_genres(data.get("genres")),
        "availability": _availability({**data, "has_healthy_source": True}),
    }


def get_global_catalog_revision() -> str:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT GREATEST(
                        COALESCE((SELECT MAX(updated_at) FROM global_catalog_artists), '-infinity'::timestamptz),
                        COALESCE((SELECT MAX(updated_at) FROM global_catalog_albums), '-infinity'::timestamptz),
                        COALESCE((SELECT MAX(updated_at) FROM global_catalog_tracks), '-infinity'::timestamptz),
                        COALESCE((SELECT MAX(updated_at) FROM global_catalog_sources), '-infinity'::timestamptz)
                    ) AS revision
                    """
                )
            )
            .mappings()
            .one()
        )
    revision = row["revision"]
    return revision.isoformat() if hasattr(revision, "isoformat") else "empty"


def list_global_sources() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        entity_type,
                        source_kind,
                        node_uid::text AS node_uid,
                        remote_entity_uid,
                        local_id,
                        local_entity_uid::text AS local_entity_uid,
                        global_entity_uid::text AS global_entity_uid,
                        source_payload_json,
                        match_key,
                        match_confidence,
                        match_method,
                        preferred_for_display,
                        preferred_for_artwork,
                        preferred_for_playback
                    FROM global_catalog_sources
                    ORDER BY entity_type, id
                    """
                )
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def _artist_payload(row, *, include_sources: bool) -> dict:
    payload = {
        "id": row["local_artist_id"],
        "entity_uid": row["local_artist_entity_uid"],
        "local_artist_entity_uid": row["local_artist_entity_uid"],
        "global_uid": row["global_artist_uid"],
        "global_artist_uid": row["global_artist_uid"],
        "slug": build_artist_slug(row["canonical_name"]),
        "name": row["canonical_name"],
        "has_photo": row["has_photo"],
        "availability": _availability(row),
    }
    return _with_debug_source(payload, row, include_sources=include_sources)


def _album_payload(row, *, include_sources: bool) -> dict:
    payload = {
        "id": row["local_album_id"],
        "entity_uid": row["local_album_entity_uid"],
        "local_album_entity_uid": row["local_album_entity_uid"],
        "global_uid": row["global_album_uid"],
        "global_album_uid": row["global_album_uid"],
        "global_artist_uid": row["global_artist_uid"],
        "artist_entity_uid": None,
        "slug": build_public_album_slug(row["canonical_name"]),
        "artist_slug": build_artist_slug(row["artist_name"]),
        "artist": row["artist_name"],
        "name": row["canonical_name"],
        "display_name": row["canonical_name"],
        "year": row["year"],
        "tracks": int(row["track_count"] or 0) if "track_count" in row else 0,
        "formats": [],
        "size_mb": 0,
        "has_cover": row["has_cover"],
        "availability": _availability(row),
    }
    return _with_debug_source(payload, row, include_sources=include_sources)


def _artist_top_track_payload(row) -> dict:
    payload = _track_payload(row, include_sources=False)
    payload["id"] = row["global_track_uid"]
    payload["track_id"] = row["local_track_id"]
    payload["track_entity_uid"] = row["local_track_entity_uid"]
    payload["globalTrackUid"] = row["global_track_uid"]
    payload["artist_id"] = None
    payload["album_id"] = row["local_album_id"] if "local_album_id" in row else None
    payload["duration"] = row["duration_seconds"] or 0
    payload["track"] = (row["track_number"] if "track_number" in row else None) or 0
    return payload


def _album_track_payload(row) -> dict:
    payload = _track_payload(row, include_sources=False)
    title = row["canonical_title"]
    duration = row["duration_seconds"]
    quality = _track_quality(row)
    payload.update(
        {
            "id": row["local_track_id"] or row["global_track_uid"],
            "entity_uid": row["local_track_entity_uid"],
            "globalTrackUid": row["global_track_uid"],
            "filename": title,
            "format": quality["format"],
            "size_mb": quality["size_mb"],
            "bitrate": quality["bitrate"],
            "sample_rate": quality["sample_rate"],
            "bit_depth": quality["bit_depth"],
            "length_sec": duration or 0,
            "rating": 0,
            "tags": {
                "title": title,
                "artist": row["artist_name"],
                "album": row["album_name"],
                "albumartist": row["artist_name"],
                "tracknumber": str(row["track_number"] or ""),
                "discnumber": str(row["disc_number"] or ""),
                "date": "",
                "genre": "",
                "musicbrainz_albumid": "",
                "musicbrainz_trackid": "",
            },
            "is_available": bool(row["has_healthy_source"]),
            "path": "",
        }
    )
    return payload


def _track_payload(row, *, include_sources: bool) -> dict:
    payload = {
        "id": row["local_track_id"],
        "entity_uid": row["local_track_entity_uid"],
        "global_uid": row["global_track_uid"],
        "global_track_uid": row["global_track_uid"],
        "globalTrackUid": row["global_track_uid"],
        "global_artist_uid": row["global_artist_uid"],
        "global_album_uid": row["global_album_uid"],
        "artist_entity_uid": None,
        "album_entity_uid": None,
        "title": row["canonical_title"],
        "artist": row["artist_name"],
        "album": row["album_name"],
        "duration": row["duration_seconds"],
        "path": None,
        "availability": _availability(row),
    }
    quality = _track_quality(row)
    if quality["format"]:
        payload["format"] = quality["format"]
    if quality["bitrate"] is not None:
        payload["bitrate"] = quality["bitrate"]
    if quality["sample_rate"] is not None:
        payload["sample_rate"] = quality["sample_rate"]
    if quality["bit_depth"] is not None:
        payload["bit_depth"] = quality["bit_depth"]
    if quality["size_mb"]:
        payload["size_mb"] = quality["size_mb"]
    if "disc_number" in row:
        payload["disc_number"] = row["disc_number"]
    if "track_number" in row:
        payload["track_number"] = row["track_number"]
    return _with_debug_source(payload, row, include_sources=include_sources)


def _track_quality(row) -> dict[str, int | str | None]:
    size_bytes = _int_or_none(row.get("size_bytes") if "size_bytes" in row else None)
    return {
        "format": str(row.get("format") or "").strip().lower()
        if "format" in row
        else "",
        "bitrate": _int_or_none(row.get("bitrate") if "bitrate" in row else None),
        "sample_rate": _int_or_none(
            row.get("sample_rate") if "sample_rate" in row else None
        ),
        "bit_depth": _int_or_none(row.get("bit_depth") if "bit_depth" in row else None),
        "size_mb": round(size_bytes / (1024**2)) if size_bytes else 0,
    }


def _int_or_none(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_genres(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        if stripped.startswith("["):
            try:
                return _coerce_genres(json.loads(stripped))
            except json.JSONDecodeError:
                return [stripped]
        return [stripped]
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _availability(row) -> dict:
    value = row["availability_json"]
    availability = dict(value) if isinstance(value, dict) else {}
    availability["local"] = bool(row["has_local"])
    availability["remote"] = bool(row["has_remote"])
    availability["healthy"] = bool(row["has_healthy_source"])
    return availability


def _with_debug_source(payload: dict, row, *, include_sources: bool) -> dict:
    if include_sources:
        payload["source_count"] = row["source_count"]
    return payload


def _public_artist_slug(value: str) -> str | None:
    requested = str(value or "").strip()
    return build_artist_slug(requested) if requested else None


def _public_album_slug(value: str) -> str | None:
    requested = str(value or "").strip()
    return build_public_album_slug(requested) if requested else None


def _global_artist_uid_by_public_slug(artist_slug: str) -> str | None:
    requested_slug = _public_artist_slug(artist_slug)
    if not requested_slug:
        return None
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT global_artist_uid::text AS global_artist_uid
                    FROM global_catalog_artist_route_aliases
                    WHERE slug = :public_slug
                    UNION
                    SELECT global_artist_uid::text AS global_artist_uid
                    FROM global_catalog_artists
                    WHERE public_slug = :public_slug
                    """
                ),
                {"public_slug": requested_slug},
            )
            .mappings()
            .all()
        )
    matches = [row["global_artist_uid"] for row in rows]
    return _single_public_route_match(matches, f"/artists/{requested_slug}")


def _single_public_route_match(matches: list[str], route: str) -> str | None:
    unique_matches = sorted(set(matches))
    if len(unique_matches) > 1:
        raise GlobalCatalogPublicRouteConflict(route)
    return unique_matches[0] if unique_matches else None


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


__all__ = [
    "GlobalCatalogPublicRouteConflict",
    "get_global_catalog_counts",
    "get_global_decade_artists",
    "get_global_artist_page_by_public_slug",
    "get_global_artist_page",
    "get_global_album_detail_by_public_slugs",
    "get_global_album_detail",
    "get_global_radio_seed_tracks",
    "get_global_track_info",
    "get_global_catalog_revision",
    "list_global_sources",
    "search_global_catalog",
]
