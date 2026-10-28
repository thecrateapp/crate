from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_genre_taxonomy_admin_stats(
    slugs: list[str], *, session=None
) -> dict[str, dict]:
    """Return direct catalog and 90-day listening metrics for taxonomy nodes.

    Catalog membership follows the genre detail surface: direct artist and album
    assignments contribute, and an artist assignment includes that artist's
    albums. Track totals use the precomputed ``library_albums.track_count`` field;
    this query never scans ``library_tracks``.
    """
    if not slugs:
        return {}
    if session is None:
        with read_scope() as current_session:
            return get_genre_taxonomy_admin_stats(slugs, session=current_session)

    rows = (
        session.execute(
            text(
                """
                WITH target_nodes AS (
                    SELECT id, slug
                    FROM genre_taxonomy_nodes
                    WHERE slug = ANY(:slugs)
                ),
                alias_genres AS (
                    SELECT DISTINCT
                        node.id AS taxonomy_id,
                        node.slug AS taxonomy_slug,
                        genre.id AS genre_id,
                        genre.name AS raw_tag
                    FROM target_nodes node
                    LEFT JOIN genre_taxonomy_aliases alias
                      ON alias.genre_id = node.id
                    LEFT JOIN genres genre
                      ON genre.slug = alias.alias_slug
                ),
                direct_artists AS (
                    SELECT DISTINCT alias.taxonomy_id, assignment.artist_name
                    FROM alias_genres alias
                    JOIN artist_genres assignment
                      ON assignment.genre_id = alias.genre_id
                    WHERE alias.genre_id IS NOT NULL
                ),
                direct_albums AS (
                    SELECT DISTINCT alias.taxonomy_id, assignment.album_id
                    FROM alias_genres alias
                    JOIN album_genres assignment
                      ON assignment.genre_id = alias.genre_id
                    WHERE alias.genre_id IS NOT NULL
                ),
                artist_albums AS (
                    SELECT DISTINCT artist.taxonomy_id, album.id AS album_id
                    FROM direct_artists artist
                    JOIN library_albums album
                      ON album.artist = artist.artist_name
                ),
                node_albums AS (
                    SELECT taxonomy_id, album_id FROM direct_albums
                    UNION
                    SELECT taxonomy_id, album_id FROM artist_albums
                ),
                node_artists AS (
                    SELECT taxonomy_id, artist_name FROM direct_artists
                    UNION
                    SELECT albums.taxonomy_id, album.artist AS artist_name
                    FROM node_albums albums
                    JOIN library_albums album ON album.id = albums.album_id
                ),
                artist_counts AS (
                    SELECT taxonomy_id, COUNT(*)::integer AS artist_count
                    FROM node_artists
                    GROUP BY taxonomy_id
                ),
                album_counts AS (
                    SELECT taxonomy_id, COUNT(*)::integer AS album_count
                    FROM node_albums
                    GROUP BY taxonomy_id
                ),
                track_counts AS (
                    SELECT
                        node_albums.taxonomy_id,
                        SUM(COALESCE(album.track_count, 0))::bigint AS track_count
                    FROM node_albums
                    JOIN library_albums album ON album.id = node_albums.album_id
                    GROUP BY node_albums.taxonomy_id
                ),
                raw_tags AS (
                    SELECT
                        alias.taxonomy_id,
                        COUNT(DISTINCT alias.genre_id)::integer AS raw_tag_count,
                        ARRAY_AGG(DISTINCT alias.raw_tag ORDER BY alias.raw_tag)
                            FILTER (WHERE alias.raw_tag IS NOT NULL) AS mapped_raw_tags
                    FROM alias_genres alias
                    GROUP BY alias.taxonomy_id
                ),
                catalog_total AS (
                    SELECT COALESCE(SUM(track_count), 0)::bigint AS track_count
                    FROM library_albums
                ),
                listening_genres AS (
                    SELECT genre_name, SUM(play_count)::numeric AS play_count
                    FROM user_genre_stats
                    WHERE stat_window = '90d' AND play_count > 0
                    GROUP BY genre_name
                ),
                listening_tokens AS (
                    SELECT DISTINCT
                        genre.genre_name,
                        genre.play_count,
                        trim(both '-' FROM regexp_replace(
                            lower(trim(token.value)), '[^a-z0-9]+', '-', 'g'
                        )) AS token_slug
                    FROM listening_genres genre
                    CROSS JOIN LATERAL regexp_split_to_table(
                        genre.genre_name, '[,;]'
                    ) AS token(value)
                ),
                tokens_with_count AS (
                    SELECT
                        genre_name,
                        play_count,
                        token_slug,
                        COUNT(*) OVER (PARTITION BY genre_name) AS token_count
                    FROM listening_tokens
                    WHERE token_slug <> ''
                ),
                alias_lookup AS (
                    SELECT DISTINCT alias.taxonomy_id, token.token_slug
                    FROM alias_genres alias
                    CROSS JOIN LATERAL (
                        VALUES (
                            trim(both '-' FROM regexp_replace(
                                lower(alias.raw_tag), '[^a-z0-9]+', '-', 'g'
                            ))
                        )
                    ) AS token(token_slug)
                    WHERE alias.raw_tag IS NOT NULL
                    UNION
                    SELECT DISTINCT node.id AS taxonomy_id, alias.alias_slug
                    FROM target_nodes node
                    JOIN genre_taxonomy_aliases alias ON alias.genre_id = node.id
                ),
                listening_by_node AS (
                    SELECT
                        lookup.taxonomy_id,
                        SUM(tokens.play_count / tokens.token_count)::numeric
                            AS mapped_play_count
                    FROM tokens_with_count tokens
                    JOIN alias_lookup lookup
                      ON lookup.token_slug = tokens.token_slug
                    GROUP BY lookup.taxonomy_id
                ),
                listening_total AS (
                    SELECT COALESCE(SUM(play_count), 0)::numeric AS play_count
                    FROM listening_genres
                )
                SELECT
                    node.slug,
                    COALESCE(artist_counts.artist_count, 0) AS artist_count,
                    COALESCE(album_counts.album_count, 0) AS album_count,
                    COALESCE(track_counts.track_count, 0) AS track_count,
                    COALESCE(raw_tags.raw_tag_count, 0) AS raw_tag_count,
                    COALESCE(raw_tags.mapped_raw_tags, ARRAY[]::text[]) AS mapped_raw_tags,
                    catalog_total.track_count AS catalog_track_count,
                    CASE
                        WHEN catalog_total.track_count > 0 THEN
                            100.0 * COALESCE(track_counts.track_count, 0)
                                / catalog_total.track_count
                        ELSE 0
                    END AS catalog_track_share_pct,
                    CASE
                        WHEN listening_total.play_count > 0 THEN
                            100.0 * COALESCE(listening_by_node.mapped_play_count, 0)
                                / listening_total.play_count
                        ELSE NULL
                    END AS listening_share_90d_pct
                FROM target_nodes node
                CROSS JOIN catalog_total
                CROSS JOIN listening_total
                LEFT JOIN artist_counts ON artist_counts.taxonomy_id = node.id
                LEFT JOIN album_counts ON album_counts.taxonomy_id = node.id
                LEFT JOIN track_counts ON track_counts.taxonomy_id = node.id
                LEFT JOIN raw_tags ON raw_tags.taxonomy_id = node.id
                LEFT JOIN listening_by_node
                  ON listening_by_node.taxonomy_id = node.id
                """
            ),
            {"slugs": list(dict.fromkeys(slugs))},
        )
        .mappings()
        .all()
    )

    stats = {
        row["slug"]: {
            "artist_count": int(row["artist_count"] or 0),
            "album_count": int(row["album_count"] or 0),
            "track_count": int(row["track_count"] or 0),
            "raw_tag_count": int(row["raw_tag_count"] or 0),
            "mapped_raw_tags": list(row["mapped_raw_tags"] or []),
            "catalog_track_count": int(row["catalog_track_count"] or 0),
            "catalog_track_share_pct": float(row["catalog_track_share_pct"] or 0),
            "listening_share_90d_pct": (
                float(row["listening_share_90d_pct"])
                if row["listening_share_90d_pct"] is not None
                else None
            ),
        }
        for row in rows
    }
    for slug in slugs:
        stats.setdefault(
            slug,
            {
                "artist_count": 0,
                "album_count": 0,
                "track_count": 0,
                "raw_tag_count": 0,
                "mapped_raw_tags": [],
                "catalog_track_count": 0,
                "catalog_track_share_pct": 0.0,
                "listening_share_90d_pct": None,
            },
        )
    return stats


__all__ = ["get_genre_taxonomy_admin_stats"]
