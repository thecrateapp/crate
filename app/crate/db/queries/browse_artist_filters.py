from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope
from crate.genre_taxonomy import resolve_genre_slug, slugify_genre

MIN_GENRE_MEMBERSHIP_SCORE = 0.45


def artist_decade_filter_sql(artist_alias: str) -> str:
    return f"""
        (
            (
                {artist_alias}.formed IS NOT NULL
                AND substring({artist_alias}.formed, 1, 4) ~ '^[0-9]{{4}}$'
                AND CAST(substring({artist_alias}.formed, 1, 4) AS INTEGER)
                    BETWEEN :decade_start AND :decade_end
            )
            OR EXISTS (
                SELECT 1
                FROM library_albums decade_albums
                WHERE LOWER(decade_albums.artist) = LOWER({artist_alias}.name)
                  AND substring(COALESCE(decade_albums.year, ''), 1, 4) ~ '^[0-9]{{4}}$'
                  AND CAST(substring(decade_albums.year, 1, 4) AS INTEGER)
                    BETWEEN :decade_start AND :decade_end
            )
        )
    """


def get_browse_filter_genres(
    country: str = "", decade: str = "", format: str = ""
) -> list[dict]:
    where_clauses = ["1=1"]
    params: dict[str, str | int | float] = {
        "min_membership_score": MIN_GENRE_MEMBERSHIP_SCORE
    }

    if country:
        where_clauses.append("{artist_alias}.country = :country")
        params["country"] = country

    if decade:
        try:
            decade_start = int(decade.rstrip("s"))
            where_clauses.append("{artist_decade_filter}")
            params["decade_start"] = decade_start
            params["decade_end"] = decade_start + 9
        except (ValueError, TypeError):
            pass

    if format:
        where_clauses.append("{artist_alias}.primary_format = :format")
        params["format"] = format

    where_sql = " AND ".join(
        clause.format(
            artist_alias="la", artist_decade_filter=artist_decade_filter_sql("la")
        )
        for clause in where_clauses
    )
    top_artist_where_sql = " AND ".join(
        clause.format(
            artist_alias="la2",
            artist_decade_filter=artist_decade_filter_sql("la2"),
        )
        for clause in where_clauses
    )

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                SELECT
                    g.name,
                    g.slug AS genre_slug,
                    COUNT(DISTINCT la.name) AS cnt,
                    COALESCE(
                        NULLIF(tn.description, ''),
                        NULLIF(tn.external_description, '')
                    ) AS description,
                    top_artists.top_artists,
                    CASE
                        WHEN NULLIF(tn.cover_path, '') IS NOT NULL THEN
                            '/api/genres/' || tn.slug || '/cover?size=640&format=webp'
                        WHEN top_artists.top_artist_id IS NOT NULL THEN
                            '/api/artists/' || top_artists.top_artist_id::text || '/background?size=640&format=webp'
                        ELSE NULL
                    END AS cover_url
                FROM library_artists la
                JOIN artist_genres ag ON la.name = ag.artist_name
                JOIN genres g ON g.id = ag.genre_id
                LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
                LEFT JOIN LATERAL (
                    SELECT
                        ARRAY_AGG(ranked.name ORDER BY ranked.weight_sort DESC, ranked.listeners_sort DESC, ranked.playcount_sort DESC, ranked.album_count_sort DESC, ranked.name ASC) AS top_artists,
                        (ARRAY_AGG(ranked.id ORDER BY ranked.weight_sort DESC, ranked.listeners_sort DESC, ranked.playcount_sort DESC, ranked.album_count_sort DESC, ranked.name ASC))[1] AS top_artist_id
                    FROM (
                        SELECT
                            la2.id,
                            la2.name,
                            COALESCE(la2.listeners, 0) AS listeners_sort,
                            COALESCE(la2.lastfm_playcount, 0) AS playcount_sort,
                            COALESCE(la2.album_count, 0) AS album_count_sort,
                            COALESCE(ag2.weight, 0) AS weight_sort
                        FROM library_artists la2
                        JOIN artist_genres ag2 ON la2.name = ag2.artist_name
                        WHERE ag2.genre_id = g.id
                          AND COALESCE(ag2.weight, 0) >= :min_membership_score
                          AND {top_artist_where_sql}
                        ORDER BY
                            COALESCE(ag2.weight, 0) DESC,
                            COALESCE(la2.listeners, 0) DESC,
                            COALESCE(la2.lastfm_playcount, 0) DESC,
                            COALESCE(la2.album_count, 0) DESC,
                            la2.name ASC
                        LIMIT 3
                    ) ranked
                ) top_artists ON TRUE
                WHERE {where_sql}
                  AND COALESCE(ag.weight, 0) >= :min_membership_score
                GROUP BY
                    g.id,
                    g.name,
                    g.slug,
                    tn.slug,
                    tn.description,
                    tn.external_description,
                    tn.cover_path,
                    top_artists.top_artists,
                    top_artists.top_artist_id
                HAVING COUNT(DISTINCT la.name) >= 1
                ORDER BY cnt DESC, g.name ASC
                LIMIT 200
                """
                ),
                params,
            )
            .mappings()
            .all()
        )
        items = []
        for row in rows:
            item = dict(row)
            top_artists = item.get("top_artists") or []
            genre_name = str(item["name"])
            genre_slug = (
                item.get("genre_slug")
                or item.get("slug")
                or resolve_genre_slug(genre_name)
                or slugify_genre(genre_name)
            )
            items.append(
                {
                    "name": genre_name,
                    "slug": genre_slug,
                    "cnt": item["cnt"],
                    "count": item["cnt"],
                    "description": item.get("description"),
                    "top_artists": list(top_artists),
                    "cover_url": item.get("cover_url"),
                }
            )
        _merge_remote_global_genres(
            session,
            items,
            country=country,
            decade=decade,
            format=format,
            decade_start=int(params["decade_start"])
            if "decade_start" in params
            else None,
            decade_end=int(params["decade_end"]) if "decade_end" in params else None,
        )
        return sorted(items, key=lambda item: (-int(item["count"] or 0), item["name"]))


def _merge_remote_global_genres(
    session,
    items: list[dict],
    *,
    country: str,
    decade: str,
    format: str,
    decade_start: int | None,
    decade_end: int | None,
) -> None:
    if country or format:
        return

    decade_sql = ""
    params: dict[str, int] = {}
    if decade:
        if decade_start is None or decade_end is None:
            return
        decade_sql = """
            AND EXISTS (
                SELECT 1
                FROM global_catalog_albums decade_albums
                WHERE decade_albums.global_artist_uid = a.global_artist_uid
                  AND substring(COALESCE(decade_albums.year, ''), 1, 4) ~ '^[0-9]{4}$'
                  AND CAST(substring(decade_albums.year, 1, 4) AS INTEGER)
                    BETWEEN :decade_start AND :decade_end
            )
        """
        params["decade_start"] = decade_start
        params["decade_end"] = decade_end

    rows = (
        session.execute(
            text(
                f"""
                SELECT DISTINCT
                    LOWER(TRIM(genre.value)) AS genre_name,
                    a.canonical_name AS artist_name,
                    a.global_artist_uid::text AS global_artist_uid,
                    a.has_photo,
                    a.source_count
                FROM global_catalog_sources src
                JOIN global_catalog_artists a
                  ON a.global_artist_uid = src.global_entity_uid
                CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                        WHEN jsonb_typeof(src.source_payload_json->'genres') = 'array'
                        THEN src.source_payload_json->'genres'
                        ELSE '[]'::jsonb
                    END
                ) AS genre(value)
                WHERE src.entity_type = 'artist'
                  AND src.source_kind = 'federated'
                  AND src.source_deleted_at IS NULL
                  AND NOT src.source_stale
                  AND NOT a.has_local
                  AND TRIM(genre.value) != ''
                  {decade_sql}
                ORDER BY
                    LOWER(TRIM(genre.value)) ASC,
                    a.source_count DESC,
                    a.canonical_name ASC
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    if not rows:
        return

    by_name = {str(item["name"]).casefold(): item for item in items}
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        genre_name = str(row["genre_name"] or "").strip()
        if not genre_name:
            continue
        grouped.setdefault(genre_name.casefold(), []).append(dict(row))

    for genre_key, genre_rows in grouped.items():
        genre_name = str(genre_rows[0]["genre_name"])
        existing = by_name.get(genre_key)
        top_artists = []
        cover_url = None
        for row in genre_rows:
            artist_name = str(row["artist_name"] or "").strip()
            if artist_name and artist_name not in top_artists and len(top_artists) < 3:
                top_artists.append(artist_name)
            if cover_url is None and row.get("has_photo"):
                cover_url = (
                    f"/api/catalog/artists/{row['global_artist_uid']}"
                    "/background?size=640&format=webp"
                )

        remote_count = len(
            {
                str(row.get("artist_name") or "").strip().casefold()
                for row in genre_rows
                if row.get("artist_name")
            }
        )
        if existing is not None:
            existing["cnt"] = int(existing.get("cnt") or 0) + remote_count
            existing["count"] = int(existing.get("count") or 0) + remote_count
            current_top = list(existing.get("top_artists") or [])
            for artist_name in top_artists:
                if artist_name not in current_top and len(current_top) < 3:
                    current_top.append(artist_name)
            existing["top_artists"] = current_top
            if not existing.get("cover_url") and cover_url:
                existing["cover_url"] = cover_url
            continue

        slug = resolve_genre_slug(genre_name) or slugify_genre(genre_name)
        item = {
            "name": genre_name,
            "slug": slug,
            "cnt": remote_count,
            "count": remote_count,
            "description": None,
            "top_artists": top_artists,
            "cover_url": cover_url,
        }
        items.append(item)
        by_name[genre_key] = item


def get_browse_filter_countries() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT country, COUNT(*) AS cnt FROM library_artists
                WHERE country IS NOT NULL AND country != ''
                GROUP BY country ORDER BY cnt DESC
                """
                )
            )
            .mappings()
            .all()
        )
        return [{"name": row["country"], "count": row["cnt"]} for row in rows]


def get_browse_filter_decades() -> list[str]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT DISTINCT substring(formed, 1, 4) AS year
                FROM library_artists
                WHERE substring(COALESCE(formed, ''), 1, 4) ~ '^[0-9]{4}$'
                UNION
                SELECT DISTINCT substring(year, 1, 4) AS year
                FROM library_albums
                WHERE substring(COALESCE(year, ''), 1, 4) ~ '^[0-9]{4}$'
                """
                )
            )
            .mappings()
            .all()
        )
        decades_set = set()
        for row in rows:
            try:
                decade = f"{int(row['year'][:4]) // 10 * 10}s"
                decades_set.add(decade)
            except (ValueError, TypeError):
                pass
        return sorted(decades_set)


def get_browse_filter_formats() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT format, COUNT(*) AS cnt FROM library_tracks
                WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
                """
                )
            )
            .mappings()
            .all()
        )
        return [{"name": row["format"], "count": row["cnt"]} for row in rows]


__all__ = [
    "artist_decade_filter_sql",
    "get_browse_filter_countries",
    "get_browse_filter_decades",
    "get_browse_filter_formats",
    "get_browse_filter_genres",
]
