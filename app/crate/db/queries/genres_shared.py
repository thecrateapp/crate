from __future__ import annotations

from sqlalchemy import text

from crate.genre_covers import genre_cover_public_url
from crate.genre_taxonomy import (
    get_genre_description,
    get_genre_display_name,
    get_top_level_slug,
    resolve_genre_eq_preset,
)


def _artist_photo_public_url(artist_id: int) -> str:
    return f"/api/artists/{artist_id}/photo?size=640&format=webp"


def invalid_genre_taxonomy_reason(slug: str) -> str | None:
    normalized = (slug or "").strip().lower()
    if not normalized:
        return None
    if normalized in {"wikidata", "other-databases"}:
        return "external-section-marker"
    if normalized.startswith(("http-", "https-")):
        return "external-url"
    if normalized.startswith("q") and normalized[1:].isdigit():
        return "wikidata-entity-id"
    return None


def annotate_genre_mapping(items: list[dict]) -> list[dict]:
    for item in items:
        canonical_slug = item.get("canonical_slug")
        cover_path = item.pop("canonical_cover_path", None)
        item["mapped"] = canonical_slug is not None
        if canonical_slug:
            top_level_slug = get_top_level_slug(canonical_slug) or canonical_slug
            item["top_level_slug"] = top_level_slug
            item["top_level_name"] = get_genre_display_name(top_level_slug)
            item["top_level_description"] = get_genre_description(top_level_slug)
            item["description"] = item.get(
                "canonical_description"
            ) or get_genre_description(canonical_slug)
            item["cover_url"] = (
                genre_cover_public_url(canonical_slug) if cover_path else None
            )
        else:
            item["top_level_slug"] = None
            item["top_level_name"] = None
            item["top_level_description"] = None
            item["description"] = None
            item["cover_url"] = None
            item["external_description"] = None
            item["external_description_source"] = None
            item["musicbrainz_mbid"] = None
            item["wikidata_entity_id"] = None
            item["wikidata_url"] = None
    return items


def annotate_eq_preset(item: dict) -> None:
    canonical_gains = item.pop("canonical_eq_gains", None)
    canonical_slug = item.get("canonical_slug")

    item["eq_gains"] = (
        [float(v) for v in canonical_gains] if canonical_gains is not None else None
    )
    item["eq_preset_resolved"] = (
        resolve_genre_eq_preset(canonical_slug) if canonical_slug else None
    )


def get_genre_summary_by_slug(session, slug: str) -> dict | None:
    row = (
        session.execute(
            text(
                """
            SELECT
                g.id,
                g.entity_uid::text AS entity_uid,
                g.name,
                g.slug,
                COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                COUNT(DISTINCT alg.album_id)::INTEGER AS album_count,
                (
                    WITH matched_albums AS (
                        SELECT DISTINCT a.id, COALESCE(a.track_count, 0) AS track_count
                        FROM library_albums a
                        LEFT JOIN album_genres alg_track
                            ON alg_track.album_id = a.id
                           AND alg_track.genre_id = g.id
                        LEFT JOIN artist_genres ag_track
                            ON ag_track.artist_name = a.artist
                           AND ag_track.genre_id = g.id
                        WHERE alg_track.genre_id IS NOT NULL
                           OR ag_track.genre_id IS NOT NULL
                    ),
                    matched_track_count AS (
                        SELECT COUNT(DISTINCT lt.id)::INTEGER AS count
                        FROM library_tracks lt
                        JOIN matched_albums ma ON ma.id = lt.album_id
                    )
                    SELECT COALESCE(
                        NULLIF((SELECT count FROM matched_track_count), 0),
                        (SELECT COALESCE(SUM(track_count), 0)::INTEGER FROM matched_albums),
                        0
                    )
                ) AS track_count,
                tn.slug AS canonical_slug,
                tn.name AS canonical_name,
                tn.description AS canonical_description,
                tn.external_description,
                tn.external_description_source,
                tn.cover_path AS canonical_cover_path,
                tn.musicbrainz_mbid,
                tn.wikidata_entity_id,
                tn.wikidata_url,
                tn.eq_gains AS canonical_eq_gains,
                tn.eq_reasoning
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
            LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
            WHERE g.slug = :slug
            GROUP BY
                g.id,
                g.entity_uid,
                g.name,
                g.slug,
                tn.slug,
                tn.name,
                tn.description,
                tn.external_description,
                tn.external_description_source,
                tn.cover_path,
                tn.musicbrainz_mbid,
                tn.wikidata_entity_id,
                tn.wikidata_url,
                tn.eq_gains,
                tn.eq_reasoning
            """
            ),
            {"slug": slug},
        )
        .mappings()
        .first()
    )
    if not row:
        return None
    annotated = annotate_genre_mapping([dict(row)])[0]
    annotate_eq_preset(annotated)
    return annotated


def get_taxonomy_node_stats(session, slugs: list[str]) -> dict[str, dict]:
    if not slugs:
        return {}
    rows = (
        session.execute(
            text(
                """
            SELECT
                n.slug,
                n.name,
                n.description,
                n.external_description,
                n.cover_path,
                n.is_top_level,
                COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
            FROM genre_taxonomy_nodes n
            LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
            LEFT JOIN genres g ON g.slug = gta.alias_slug
            LEFT JOIN artist_genres ag ON ag.genre_id = g.id
            LEFT JOIN album_genres alg ON alg.genre_id = g.id
            WHERE n.slug = ANY(:slugs)
            GROUP BY n.id, n.slug, n.name, n.description, n.external_description, n.cover_path, n.is_top_level
            """
            ),
            {"slugs": slugs},
        )
        .mappings()
        .all()
    )
    stats = {}
    for row in rows:
        item = dict(row)
        cover_path = item.pop("cover_path", None)
        item["cover_url"] = genre_cover_public_url(row["slug"]) if cover_path else None
        stats[row["slug"]] = item

    rows = (
        session.execute(
            text(
                """
            WITH alias_counts AS (
                SELECT
                    n.slug AS taxonomy_slug,
                    g.slug AS genre_slug,
                    g.name AS genre_name,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
                FROM genre_taxonomy_nodes n
                LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
                LEFT JOIN genres g ON g.slug = gta.alias_slug
                LEFT JOIN artist_genres ag ON ag.genre_id = g.id
                LEFT JOIN album_genres alg ON alg.genre_id = g.id
                WHERE n.slug = ANY(:slugs)
                GROUP BY n.id, n.slug, g.id, g.slug, g.name
            )
            SELECT DISTINCT ON (taxonomy_slug)
                taxonomy_slug,
                genre_slug,
                genre_name
            FROM alias_counts
            WHERE genre_slug IS NOT NULL
            ORDER BY taxonomy_slug, artist_count DESC, album_count DESC, genre_slug ASC
            """
            ),
            {"slugs": slugs},
        )
        .mappings()
        .all()
    )
    for row in rows:
        bucket = stats.get(row["taxonomy_slug"])
        if not bucket:
            continue
        bucket["page_slug"] = row["genre_slug"]
        bucket["page_name"] = row["genre_name"]

    rows = (
        session.execute(
            text(
                """
            WITH top_artists AS (
                SELECT
                    n.slug AS taxonomy_slug,
                    la.id AS artist_id,
                    la.slug AS artist_slug,
                    la.name AS artist_name,
                    ag.weight,
                    la.listeners,
                    la.album_count
                FROM genre_taxonomy_nodes n
                JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
                JOIN genres g ON g.slug = gta.alias_slug
                JOIN artist_genres ag ON ag.genre_id = g.id
                JOIN library_artists la ON la.name = ag.artist_name
                WHERE n.slug = ANY(:slugs)
                  AND COALESCE(la.has_photo, 0) <> 0
            )
            SELECT DISTINCT ON (taxonomy_slug)
                taxonomy_slug,
                artist_id,
                artist_slug,
                artist_name
            FROM top_artists
            ORDER BY
                taxonomy_slug,
                weight DESC NULLS LAST,
                listeners DESC NULLS LAST,
                album_count DESC NULLS LAST,
                artist_name ASC
            """
            ),
            {"slugs": slugs},
        )
        .mappings()
        .all()
    )
    for row in rows:
        bucket = stats.get(row["taxonomy_slug"])
        if not bucket:
            continue
        bucket["top_artist_id"] = row["artist_id"]
        bucket["top_artist_slug"] = row["artist_slug"]
        bucket["top_artist_name"] = row["artist_name"]
        bucket["top_artist_photo_url"] = _artist_photo_public_url(row["artist_id"])

    for slug in slugs:
        bucket = stats.setdefault(
            slug,
            {
                "slug": slug,
                "name": get_genre_display_name(slug),
                "description": get_genre_description(slug),
                "external_description": "",
                "is_top_level": False,
                "artist_count": 0,
                "album_count": 0,
                "cover_url": None,
                "top_artist_id": None,
                "top_artist_slug": None,
                "top_artist_name": None,
                "top_artist_photo_url": None,
            },
        )
        bucket.setdefault("page_slug", None)
        bucket.setdefault("page_name", None)
        bucket.setdefault("top_artist_id", None)
        bucket.setdefault("top_artist_slug", None)
        bucket.setdefault("top_artist_name", None)
        bucket.setdefault("top_artist_photo_url", None)
    return stats


__all__ = [
    "annotate_eq_preset",
    "annotate_genre_mapping",
    "get_genre_summary_by_slug",
    "get_taxonomy_node_stats",
    "invalid_genre_taxonomy_reason",
]
