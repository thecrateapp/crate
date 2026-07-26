from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.genres_shared import (
    get_genre_summary_by_slug,
    get_taxonomy_node_stats,
)
from crate.db.tx import read_scope
from crate.genre_taxonomy import (
    get_genre_catalog,
    get_genre_description,
    get_genre_display_name,
    resolve_genre_slug,
    slugify_genre,
)

MIN_GENRE_MEMBERSHIP_SCORE = 0.45
MIN_ARTIST_ROOM_MEMBERSHIP_SCORE = 0.70
ARTIST_ALBUM_FALLBACK_FACTOR = 0.70
RELATED_GENRE_LIMIT = 24

_RELATION_LABELS = {
    "child": "Subgenre",
    "sibling": "Sibling",
    "related": "Related",
    "influenced_by": "Influenced by",
    "influences": "Influences",
    "fusion": "Fusion",
}
_RELATION_PRIORITY = {
    "child": 60,
    "related": 50,
    "sibling": 40,
    "influenced_by": 30,
    "influences": 20,
    "fusion": 10,
}


def _genre_target_cte() -> str:
    return """
        WITH target_genres AS (
            SELECT :genre_id AS id
        ),
        artist_memberships AS (
            SELECT
                ag.artist_name,
                ag.genre_id,
                ag.weight::DOUBLE PRECISION AS weight,
                ag.weight::DOUBLE PRECISION AS membership_score,
                CASE
                    WHEN ag.weight >= 0.90 THEN 'core'
                    WHEN ag.weight >= 0.70 THEN 'strong'
                    WHEN ag.weight >= :min_membership_score THEN 'adjacent'
                    ELSE 'weak'
                END AS membership_tier,
                ag.source
            FROM artist_genres ag
            WHERE ag.genre_id IN (SELECT id FROM target_genres)
        )
    """


def _related_genre_candidates(canonical_slug: str) -> dict[str, str]:
    catalog = get_genre_catalog()
    meta = catalog.get(canonical_slug)
    if not meta:
        return {}

    candidates: dict[str, str] = {}

    def add(slug: str, relation_type: str) -> None:
        if not slug or slug == canonical_slug or slug not in catalog:
            return
        current = candidates.get(slug)
        if (
            current is None
            or _RELATION_PRIORITY[relation_type] > _RELATION_PRIORITY[current]
        ):
            candidates[slug] = relation_type

    for slug, item in catalog.items():
        parents = item.get("parents", [])
        if canonical_slug in parents:
            add(slug, "child")

    parent_slugs = set(meta.get("parents", []))
    if parent_slugs:
        for slug, item in catalog.items():
            if slug != canonical_slug and parent_slugs.intersection(
                item.get("parents", [])
            ):
                add(slug, "sibling")

    for slug in meta.get("related", []):
        add(slug, "related")

    for slug in meta.get("influenced_by", []):
        add(slug, "influenced_by")

    for slug, item in catalog.items():
        if canonical_slug in item.get("influenced_by", []):
            add(slug, "influences")
        if canonical_slug in item.get("fusion_of", []):
            add(slug, "fusion")

    return candidates


def _build_related_genres(session, slug: str | None) -> list[dict]:
    canonical_slug = resolve_genre_slug(slug or "")
    if not canonical_slug:
        return []

    relation_by_slug = _related_genre_candidates(canonical_slug)
    if not relation_by_slug:
        return []

    stats = get_taxonomy_node_stats(session, list(relation_by_slug))
    items: list[dict] = []
    for related_slug, relation_type in relation_by_slug.items():
        item = stats.get(related_slug, {})
        artist_count = int(item.get("artist_count") or 0)
        album_count = int(item.get("album_count") or 0)
        content_score = artist_count * 3 + album_count
        if content_score <= 0:
            continue
        page_slug = item.get("page_slug") or related_slug
        items.append(
            {
                "slug": related_slug,
                "name": item.get("page_name") or item.get("name") or related_slug,
                "page_slug": page_slug,
                "relation_type": relation_type,
                "relation_label": _RELATION_LABELS[relation_type],
                "description": item.get("description")
                or item.get("external_description")
                or "",
                "artist_count": artist_count,
                "album_count": album_count,
                "content_score": content_score,
                "cover_url": item.get("cover_url"),
                "top_artist_id": item.get("top_artist_id"),
                "top_artist_slug": item.get("top_artist_slug"),
                "top_artist_name": item.get("top_artist_name"),
                "top_artist_photo_url": item.get("top_artist_photo_url"),
            }
        )

    items.sort(
        key=lambda item: (
            -item["content_score"],
            -_RELATION_PRIORITY.get(item["relation_type"], 0),
            -item["artist_count"],
            -item["album_count"],
            item["name"],
        )
    )
    return items[:RELATED_GENRE_LIMIT]


def get_genre_detail(slug: str, *, include_global_entities: bool = True) -> dict | None:
    with read_scope() as session:
        genre = get_genre_summary_by_slug(session, slug)
        if not genre:
            return (
                _build_global_only_genre_detail(session, slug)
                if include_global_entities
                else None
            )
        if not genre.get("description") and not genre.get("mapped"):
            genre["description"] = (
                "raw library tag detected in your collection but not yet linked into the curated taxonomy."
            )

        rows = (
            session.execute(
                text(
                    _genre_target_cte()
                    + """
                SELECT
                    ag.artist_name,
                    la.id AS artist_id,
                    la.slug AS artist_slug,
                    ag.weight,
                    ag.source,
                    la.album_count,
                    la.track_count,
                    la.has_photo,
                    la.spotify_popularity,
                    la.listeners,
                    ag.membership_score,
                    ag.membership_tier
                FROM artist_memberships ag
                JOIN library_artists la ON ag.artist_name = la.name
                WHERE ag.membership_score >= :min_membership_score
                ORDER BY
                    CASE ag.membership_tier
                        WHEN 'core' THEN 3
                        WHEN 'strong' THEN 2
                        WHEN 'adjacent' THEN 1
                        ELSE 0
                    END DESC,
                    ag.weight DESC NULLS LAST,
                    la.listeners DESC NULLS LAST,
                    la.spotify_popularity DESC NULLS LAST,
                    la.album_count DESC NULLS LAST,
                    ag.artist_name ASC
                """
                ),
                {
                    "genre_id": genre["id"],
                    "min_membership_score": MIN_ARTIST_ROOM_MEMBERSHIP_SCORE,
                },
            )
            .mappings()
            .all()
        )
        genre["artists"] = [dict(r) for r in rows]

        rows = (
            session.execute(
                text(
                    _genre_target_cte()
                    + """
                ,
                album_genre_weights AS (
                    SELECT album_id, MAX(weight) AS weight
                    FROM album_genres
                    WHERE genre_id IN (SELECT id FROM target_genres)
                    GROUP BY album_id
                ),
                album_memberships AS (
                    SELECT
                        a.id AS album_id,
                        a.slug AS album_slug,
                        a.artist,
                        ar.id AS artist_id,
                        ar.slug AS artist_slug,
                        a.name,
                        a.year,
                        a.track_count,
                        a.has_cover,
                        a.popularity,
                        a.lastfm_playcount,
                        ar.listeners,
                        ar.spotify_popularity,
                        GREATEST(
                            COALESCE(alg.weight, 0.0),
                            COALESCE(pa.membership_score, 0.0) * :artist_album_fallback_factor
                        )::DOUBLE PRECISION AS membership_score,
                        (alg.album_id IS NOT NULL) AS direct_genre_match
                    FROM library_albums a
                    LEFT JOIN artist_memberships pa ON pa.artist_name = a.artist
                    LEFT JOIN library_artists ar ON ar.name = a.artist
                    LEFT JOIN album_genre_weights alg ON alg.album_id = a.id
                    WHERE alg.album_id IS NOT NULL
                       OR pa.membership_score >= :min_membership_score
                )
                SELECT
                    album_id,
                    album_slug,
                    artist,
                    artist_id,
                    artist_slug,
                    name,
                    year,
                    track_count,
                    has_cover,
                    membership_score AS weight,
                    membership_score,
                    CASE
                        WHEN membership_score >= 0.90 THEN 'core'
                        WHEN membership_score >= 0.70 THEN 'strong'
                        WHEN membership_score >= :min_membership_score THEN 'adjacent'
                        ELSE 'weak'
                    END AS membership_tier,
                    direct_genre_match
                FROM album_memberships
                WHERE membership_score >= :min_membership_score
                ORDER BY
                    CASE
                        WHEN membership_score >= 0.90 THEN 3
                        WHEN membership_score >= 0.70 THEN 2
                        WHEN membership_score >= :min_membership_score THEN 1
                        ELSE 0
                    END DESC,
                    direct_genre_match DESC,
                    membership_score DESC NULLS LAST,
                    COALESCE(popularity, 0) DESC NULLS LAST,
                    COALESCE(lastfm_playcount, 0) DESC NULLS LAST,
                    listeners DESC NULLS LAST,
                    spotify_popularity DESC NULLS LAST,
                    year DESC NULLS LAST,
                    name ASC
                """
                ),
                {
                    "genre_id": genre["id"],
                    "min_membership_score": MIN_GENRE_MEMBERSHIP_SCORE,
                    "artist_album_fallback_factor": ARTIST_ALBUM_FALLBACK_FACTOR,
                },
            )
            .mappings()
            .all()
        )
        genre["albums"] = [dict(r) for r in rows]
        if include_global_entities:
            _augment_global_genre_entities(session, genre)
        genre["artist_count"] = len(genre["artists"])
        genre["album_count"] = len(genre["albums"])
        genre["track_count"] = sum(
            int(album.get("track_count") or 0) for album in genre["albums"]
        )
        genre["related_genres"] = _build_related_genres(
            session,
            genre.get("canonical_slug") or genre.get("slug"),
        )

        return genre


def _build_global_only_genre_detail(session, slug: str) -> dict | None:
    genre_name = _remote_global_genre_name_for_slug(session, slug)
    if not genre_name:
        return None

    canonical_slug = resolve_genre_slug(genre_name)
    page_slug = canonical_slug or slugify_genre(genre_name)
    genre = {
        "id": None,
        "entity_uid": None,
        "name": genre_name,
        "slug": page_slug,
        "artist_count": 0,
        "album_count": 0,
        "track_count": 0,
        "mapped": canonical_slug is not None,
        "canonical_slug": canonical_slug,
        "canonical_name": get_genre_display_name(canonical_slug)
        if canonical_slug
        else None,
        "canonical_description": get_genre_description(canonical_slug)
        if canonical_slug
        else None,
        "top_level_slug": canonical_slug,
        "top_level_name": get_genre_display_name(canonical_slug)
        if canonical_slug
        else None,
        "top_level_description": get_genre_description(canonical_slug)
        if canonical_slug
        else None,
        "description": get_genre_description(canonical_slug)
        if canonical_slug
        else None,
        "cover_url": None,
        "external_description": None,
        "external_description_source": None,
        "musicbrainz_mbid": None,
        "wikidata_entity_id": None,
        "wikidata_url": None,
        "eq_gains": None,
        "eq_preset_resolved": None,
        "artists": [],
        "albums": [],
        "related_genres": _build_related_genres(session, canonical_slug or page_slug),
    }
    _augment_global_genre_entities(session, genre)
    if not genre["artists"] and not genre["albums"]:
        return None

    genre["artist_count"] = len(genre["artists"])
    genre["album_count"] = len(genre["albums"])
    genre["track_count"] = sum(
        int(album.get("track_count") or 0) for album in genre["albums"]
    )
    genre["cover_url"] = _global_genre_cover_url(genre)
    return genre


def _remote_global_genre_name_for_slug(session, slug: str) -> str | None:
    target = str(slug or "").strip().lower()
    if not target:
        return None

    rows = (
        session.execute(
            text(
                """
                SELECT DISTINCT LOWER(TRIM(genre.value)) AS genre_name
                FROM global_catalog_sources src
                CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                        WHEN jsonb_typeof(src.source_payload_json->'genres') = 'array'
                        THEN src.source_payload_json->'genres'
                        ELSE '[]'::jsonb
                    END
                ) AS genre(value)
                WHERE src.entity_type IN ('artist', 'album')
                  AND src.source_deleted_at IS NULL
                  AND NOT src.source_stale
                  AND TRIM(genre.value) != ''
                ORDER BY genre_name ASC
                """
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        genre_name = str(row.get("genre_name") or "").strip()
        if not genre_name:
            continue
        if target in {
            genre_name,
            slugify_genre(genre_name),
            resolve_genre_slug(genre_name) or "",
        }:
            return genre_name
    return None


def _global_genre_cover_url(genre: dict) -> str | None:
    for album in genre.get("albums") or []:
        cover_url = album.get("cover_url")
        if cover_url:
            return cover_url
    for artist in genre.get("artists") or []:
        photo_url = artist.get("photo_url")
        if photo_url:
            return str(photo_url).replace("/photo", "/background")
    return None


def _augment_global_genre_entities(session, genre: dict) -> None:
    genre_name = str(genre.get("name") or "").strip()
    if not genre_name:
        return
    params = {
        "genre_name": genre_name.casefold(),
        "limit": 48,
    }
    existing_artist_keys = {
        str(artist.get("artist_name") or "").strip().casefold()
        for artist in genre.get("artists", [])
    }
    global_artists = [
        dict(row)
        for row in session.execute(
            text(
                """
                SELECT DISTINCT ON (a.global_artist_uid)
                    a.canonical_name AS artist_name,
                    a.local_artist_id AS artist_id,
                    a.global_artist_uid::text AS global_artist_uid,
                    a.local_artist_entity_uid::text AS artist_entity_uid,
                    la.slug AS artist_slug,
                    COALESCE(album_counts.album_count, 0) AS album_count,
                    COALESCE(track_counts.track_count, 0) AS track_count,
                    a.has_photo,
                    0::BIGINT AS listeners,
                    CASE WHEN a.has_photo THEN
                        '/api/catalog/artists/' || a.global_artist_uid::text || '/photo'
                    ELSE NULL END AS photo_url,
                    0.65::DOUBLE PRECISION AS membership_score,
                    'adjacent' AS membership_tier
                FROM global_catalog_artists a
                JOIN global_catalog_sources src
                  ON src.entity_type = 'artist'
                 AND src.global_entity_uid = a.global_artist_uid
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
                WHERE src.source_deleted_at IS NULL
                  AND NOT src.source_stale
                  AND NOT a.has_local
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(
                        CASE
                            WHEN jsonb_typeof(src.source_payload_json->'genres') = 'array'
                            THEN src.source_payload_json->'genres'
                            ELSE '[]'::jsonb
                        END
                    ) AS genre(value)
                    WHERE LOWER(TRIM(genre.value)) = :genre_name
                  )
                ORDER BY a.global_artist_uid, a.has_local DESC,
                         a.source_count DESC, a.canonical_name ASC
                LIMIT :limit
                """
            ),
            params,
        )
        .mappings()
        .all()
        if str(row.get("artist_name") or "").strip().casefold()
        not in existing_artist_keys
    ]
    genre["artists"].extend(global_artists)

    existing_album_keys = {
        (
            str(album.get("artist") or "").strip().casefold(),
            str(album.get("name") or "").strip().casefold(),
        )
        for album in genre.get("albums", [])
    }
    global_albums = [
        dict(row)
        for row in session.execute(
            text(
                """
                SELECT DISTINCT ON (a.global_album_uid)
                    a.local_album_id AS album_id,
                    a.global_album_uid::text AS global_album_uid,
                    a.global_artist_uid::text AS global_artist_uid,
                    a.local_album_entity_uid::text AS album_entity_uid,
                    la.slug AS album_slug,
                    a.artist_name AS artist,
                    art.local_artist_id AS artist_id,
                    art.local_artist_entity_uid::text AS artist_entity_uid,
                    lar.slug AS artist_slug,
                    a.canonical_name AS name,
                    a.year,
                    COALESCE(a.track_count, 0) AS track_count,
                    a.has_cover,
                    CASE WHEN a.has_cover THEN
                        '/api/catalog/albums/' || a.global_album_uid::text || '/cover'
                    ELSE NULL END AS cover_url,
                    0.65::DOUBLE PRECISION AS weight,
                    0.65::DOUBLE PRECISION AS membership_score,
                    'adjacent' AS membership_tier,
                    false AS direct_genre_match
                FROM global_catalog_albums a
                JOIN global_catalog_sources src
                  ON src.entity_type = 'album'
                 AND src.global_entity_uid = a.global_album_uid
                LEFT JOIN library_albums la ON la.id = a.local_album_id
                LEFT JOIN global_catalog_artists art
                  ON art.global_artist_uid = a.global_artist_uid
                LEFT JOIN library_artists lar ON lar.id = art.local_artist_id
                WHERE src.source_deleted_at IS NULL
                  AND NOT src.source_stale
                  AND NOT a.has_local
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(
                        CASE
                            WHEN jsonb_typeof(src.source_payload_json->'genres') = 'array'
                            THEN src.source_payload_json->'genres'
                            ELSE '[]'::jsonb
                        END
                    ) AS genre(value)
                    WHERE LOWER(TRIM(genre.value)) = :genre_name
                  )
                ORDER BY a.global_album_uid, a.has_local DESC,
                         a.source_count DESC, a.artist_name ASC, a.canonical_name ASC
                LIMIT :limit
                """
            ),
            params,
        )
        .mappings()
        .all()
        if (
            str(row.get("artist") or "").strip().casefold(),
            str(row.get("name") or "").strip().casefold(),
        )
        not in existing_album_keys
    ]
    genre["albums"].extend(global_albums)


def get_genre_upcoming_shows(
    slug: str,
    *,
    latitude: float,
    longitude: float,
    radius_km: int = 60,
    limit: int = 5,
) -> list[dict]:
    with read_scope() as session:
        genre = get_genre_summary_by_slug(session, slug)
        if not genre:
            return []

        delta = radius_km / 111.0
        rows = (
            session.execute(
                text(
                    _genre_target_cte()
                    + """
                ,
                genre_artists AS (
                    SELECT artist_name, membership_score
                    FROM artist_memberships
                    WHERE membership_score >= :min_membership_score
                ),
                candidate_shows AS (
                    SELECT
                        s.*,
                        la.id AS artist_id,
                        la.slug AS artist_slug,
                        CASE WHEN s.latitude IS NOT NULL AND s.longitude IS NOT NULL THEN
                            6371 * acos(
                                LEAST(1.0, GREATEST(-1.0,
                                    cos(radians(:lat)) * cos(radians(s.latitude))
                                    * cos(radians(s.longitude) - radians(:lon))
                                    + sin(radians(:lat)) * sin(radians(s.latitude))
                                ))
                            )
                        ELSE NULL END AS distance_km,
                        ROW_NUMBER() OVER (
                            PARTITION BY s.artist_name
                            ORDER BY s.date ASC, s.local_time ASC NULLS LAST, s.id ASC
                        ) AS artist_show_rank,
                        ARRAY(
                            SELECT g2.name
                            FROM artist_genres ag2
                            JOIN genres g2 ON g2.id = ag2.genre_id
                            WHERE ag2.artist_name = s.artist_name
                            ORDER BY ag2.weight DESC, g2.name ASC
                            LIMIT 3
                        ) AS artist_genres
                    FROM shows s
                    JOIN genre_artists pa ON pa.artist_name = s.artist_name
                    LEFT JOIN library_artists la ON la.name = s.artist_name
                    WHERE s.date >= CURRENT_DATE
                      AND COALESCE(s.status, '') != 'cancelled'
                      AND s.latitude IS NOT NULL
                      AND s.longitude IS NOT NULL
                      AND s.latitude BETWEEN :lat_min AND :lat_max
                      AND s.longitude BETWEEN :lon_min AND :lon_max
                )
                SELECT
                    id,
                    artist_name,
                    artist_id,
                    artist_slug,
                    date,
                    local_time,
                    venue,
                    address_line1,
                    city,
                    region,
                    postal_code,
                    country,
                    country_code,
                    latitude,
                    longitude,
                    url,
                    image_url,
                    lineup,
                    status,
                    source,
                    lastfm_attendance,
                    lastfm_url,
                    tickets_url,
                    artist_genres,
                    distance_km
                FROM candidate_shows
                WHERE artist_show_rank = 1
                  AND distance_km <= :radius_km
                ORDER BY date ASC, local_time ASC NULLS LAST, id ASC
                LIMIT :lim
                """
                ),
                {
                    "genre_id": genre["id"],
                    "min_membership_score": MIN_GENRE_MEMBERSHIP_SCORE,
                    "lat": latitude,
                    "lon": longitude,
                    "lat_min": latitude - delta,
                    "lat_max": latitude + delta,
                    "lon_min": longitude - delta * 1.5,
                    "lon_max": longitude + delta * 1.5,
                    "radius_km": radius_km,
                    "lim": limit,
                },
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_artists_with_tags() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT name, tags_json FROM library_artists WHERE tags_json IS NOT NULL"
                )
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_albums_with_genres() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT a.id, a.artist, a.name, a.genre,
                       array_agg(DISTINCT t.genre) FILTER (WHERE t.genre IS NOT NULL AND t.genre != '') AS track_genres
                FROM library_albums a
                LEFT JOIN library_tracks t ON t.album_id = a.id
                GROUP BY a.id, a.artist, a.name, a.genre
                """
                )
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_artists_missing_genre_mapping() -> list[str]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT DISTINCT a.artist AS name
                FROM library_albums a
                JOIN album_genres ag ON ag.album_id = a.id
                WHERE a.artist NOT IN (SELECT artist_name FROM artist_genres)
                """
                )
            )
            .mappings()
            .all()
        )
    return [r["name"] for r in rows]


def get_artist_album_genres(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT g.name, COALESCE(SUM(ag.weight), 0)::FLOAT AS score
                FROM album_genres ag
                JOIN genres g ON ag.genre_id = g.id
                JOIN library_albums a ON ag.album_id = a.id
                WHERE a.artist = :artist
                GROUP BY g.name
                ORDER BY score DESC, g.name ASC
                """
                ),
                {"artist": artist_name},
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


__all__ = [
    "get_albums_with_genres",
    "get_artist_album_genres",
    "get_artists_missing_genre_mapping",
    "get_artists_with_tags",
    "get_genre_detail",
    "get_genre_upcoming_shows",
]
