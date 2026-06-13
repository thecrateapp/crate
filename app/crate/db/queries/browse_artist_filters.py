from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_browse_filter_genres(
    country: str = "", decade: str = "", format: str = ""
) -> list[dict]:
    where_clauses = ["1=1"]
    params: dict[str, str | int] = {}

    if country:
        where_clauses.append("{artist_alias}.country = :country")
        params["country"] = country

    if decade:
        try:
            decade_start = int(decade.rstrip("s"))
            where_clauses.append(
                "{artist_alias}.formed IS NOT NULL AND length({artist_alias}.formed) >= 4"
            )
            where_clauses.append(
                "CAST(substring({artist_alias}.formed, 1, 4) AS INTEGER) BETWEEN :decade_start AND :decade_end"
            )
            params["decade_start"] = decade_start
            params["decade_end"] = decade_start + 9
        except (ValueError, TypeError):
            pass

    if format:
        where_clauses.append("{artist_alias}.primary_format = :format")
        params["format"] = format

    where_sql = " AND ".join(
        clause.format(artist_alias="la") for clause in where_clauses
    )
    top_artist_where_sql = " AND ".join(
        clause.format(artist_alias="la2") for clause in where_clauses
    )

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                SELECT
                    g.name,
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
                        ARRAY_AGG(ranked.name ORDER BY ranked.listeners_sort DESC, ranked.playcount_sort DESC, ranked.album_count_sort DESC, ranked.name ASC) AS top_artists,
                        (ARRAY_AGG(ranked.id ORDER BY ranked.listeners_sort DESC, ranked.playcount_sort DESC, ranked.album_count_sort DESC, ranked.name ASC))[1] AS top_artist_id
                    FROM (
                        SELECT
                            la2.id,
                            la2.name,
                            COALESCE(la2.listeners, 0) AS listeners_sort,
                            COALESCE(la2.lastfm_playcount, 0) AS playcount_sort,
                            COALESCE(la2.album_count, 0) AS album_count_sort
                        FROM library_artists la2
                        JOIN artist_genres ag2 ON la2.name = ag2.artist_name
                        WHERE ag2.genre_id = g.id
                          AND {top_artist_where_sql}
                        ORDER BY
                            COALESCE(la2.listeners, 0) DESC,
                            COALESCE(la2.lastfm_playcount, 0) DESC,
                            COALESCE(la2.album_count, 0) DESC,
                            la2.name ASC
                        LIMIT 3
                    ) ranked
                ) top_artists ON TRUE
                WHERE {where_sql}
                GROUP BY
                    g.id,
                    g.name,
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
            items.append(
                {
                    "name": item["name"],
                    "cnt": item["cnt"],
                    "count": item["cnt"],
                    "description": item.get("description"),
                    "top_artists": list(top_artists),
                    "cover_url": item.get("cover_url"),
                }
            )
        return items


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
                SELECT DISTINCT formed FROM library_artists
                WHERE formed IS NOT NULL AND formed != '' AND length(formed) >= 4
                """
                )
            )
            .mappings()
            .all()
        )
        decades_set = set()
        for row in rows:
            try:
                decade = f"{int(row['formed'][:4]) // 10 * 10}s"
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
    "get_browse_filter_countries",
    "get_browse_filter_decades",
    "get_browse_filter_formats",
    "get_browse_filter_genres",
]
