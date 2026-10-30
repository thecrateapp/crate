"""Scene-aware candidate queries for Music Paths."""

from __future__ import annotations

from contextlib import nullcontext

from sqlalchemy import text

from crate.genre_taxonomy import resolve_genre_slug, slugify_genre
from crate.db.queries.playable_media_filters import (
    playable_media_params,
    playable_track_clause,
)
from crate.db.tx import optional_scope, read_scope


_ARTIST_GENRES_CTE = """
    artist_genre_metadata AS MATERIALIZED (
        SELECT ag.artist_name,
               ARRAY_AGG(DISTINCT g.slug ORDER BY g.slug) AS artist_genre_slugs
        FROM artist_genres ag
        JOIN candidate_artists candidates ON candidates.artist_name = ag.artist_name
        JOIN genres g ON g.id = ag.genre_id
        GROUP BY ag.artist_name
    )
"""


def _normalize_track_row(row) -> dict | None:
    if not row:
        return None
    data = dict(row)
    data.pop("_artist_metadata_name", None)
    for key in ("entity_uid", "album_entity_uid", "artist_entity_uid"):
        if data.get(key) is not None:
            data[key] = str(data[key])
    if data.get("bliss_vector"):
        data["bliss_vector"] = list(data["bliss_vector"])
    if data.get("artist_genre_slugs"):
        data["artist_genre_slugs"] = list(data["artist_genre_slugs"])
    else:
        data["artist_genre_slugs"] = []
    return data


def _canonical_genre_slug(value: object) -> str:
    raw = str(value or "").strip()
    return resolve_genre_slug(raw) or slugify_genre(raw)


def get_artist_scene_profile(artist_ref: str, *, session=None) -> dict | None:
    """Return an artist profile with canonical genre weights for scene routing."""
    with optional_scope(session) as s:
        artist = (
            s.execute(
                text(
                    """
                    SELECT
                        id,
                        name,
                        entity_uid::text AS entity_uid,
                        country,
                        area,
                        formed
                    FROM library_artists
                    WHERE CAST(id AS text) = :artist_ref
                       OR (entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :artist_ref)
                       OR LOWER(name) = LOWER(:artist_ref)
                       OR slug = :artist_ref
                    ORDER BY
                        CASE
                            WHEN CAST(id AS text) = :artist_ref THEN 0
                            WHEN entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :artist_ref THEN 1
                            WHEN slug = :artist_ref THEN 2
                            ELSE 3
                        END
                    LIMIT 1
                    """
                ),
                {"artist_ref": str(artist_ref)},
            )
            .mappings()
            .first()
        )
        if not artist:
            return None

        rows = (
            s.execute(
                text(
                    """
                    SELECT g.slug AS raw_slug, ag.weight
                    FROM artist_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE ag.artist_name = :artist_name
                    ORDER BY ag.weight DESC NULLS LAST, g.slug ASC
                    LIMIT 12
                    """
                ),
                {"artist_name": artist["name"]},
            )
            .mappings()
            .all()
        )

    genres_by_slug: dict[str, dict] = {}
    for row in rows:
        raw_slug = str(row.get("raw_slug") or "").strip()
        slug = _canonical_genre_slug(raw_slug)
        if not slug:
            continue
        weight = float(row.get("weight") or 0.0)
        current = genres_by_slug.get(slug)
        if current is None or weight > float(current.get("weight") or 0.0):
            genres_by_slug[slug] = {
                "slug": slug,
                "raw_slug": raw_slug,
                "weight": weight,
            }

    genres = [
        item
        for item in sorted(
            genres_by_slug.values(),
            key=lambda item: (-float(item["weight"]), item["slug"]),
        )
    ]
    return {
        "id": artist["id"],
        "name": artist["name"],
        "entity_uid": artist.get("entity_uid"),
        "country": artist.get("country"),
        "area": artist.get("area"),
        "formed": artist.get("formed"),
        "genres": genres,
    }


def list_artist_scene_anchor_candidates(
    artist_ref: str,
    *,
    user_id: int | None = None,
    limit: int = 24,
    session=None,
) -> list[dict]:
    """Return candidate endpoint tracks for one artist with user and canonical signals."""
    effective_user_id = int(user_id or 0)
    with nullcontext(session) if session is not None else read_scope() as s:
        rows = (
            s.execute(
                text(
                    f"""
                    WITH target_artist AS (
                        SELECT id, name, entity_uid, listeners, spotify_popularity,
                               popularity_score, album_count, track_count,
                               country, area, formed
                        FROM library_artists
                        WHERE CAST(id AS text) = :artist_ref
                           OR (entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :artist_ref)
                           OR LOWER(name) = LOWER(:artist_ref)
                           OR slug = :artist_ref
                        ORDER BY
                            CASE
                                WHEN CAST(id AS text) = :artist_ref THEN 0
                                WHEN entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :artist_ref THEN 1
                                WHEN slug = :artist_ref THEN 2
                                ELSE 3
                            END
                        LIMIT 1
                    ),
                    primary_genre AS (
                        SELECT g.slug, ag.weight
                        FROM artist_genres ag
                        JOIN genres g ON g.id = ag.genre_id
                        JOIN target_artist ta ON ta.name = ag.artist_name
                        ORDER BY ag.weight DESC NULLS LAST, g.slug ASC
                        LIMIT 1
                    ),
                    artist_relation_counts AS (
                        SELECT LOWER(artist_name) AS artist_name, COUNT(*)::DOUBLE PRECISION AS relation_count
                        FROM (
                            SELECT artist_name, similar_name
                            FROM artist_similarities
                            UNION ALL
                            SELECT similar_name AS artist_name, artist_name AS similar_name
                            FROM artist_similarities
                        ) rel
                        GROUP BY LOWER(artist_name)
                    ),
                    anchor_candidates AS MATERIALIZED (
                        SELECT
                            t.id,
                            t.entity_uid,
                            t.title,
                            t.artist,
                            CASE WHEN performer.id IS NULL THEN ta.name
                                 ELSE performer.name END AS _artist_metadata_name,
                            a.artist AS album_artist,
                            a.name AS album,
                            t.album_id,
                            a.entity_uid::text AS album_entity_uid,
                            CASE WHEN performer.id IS NULL THEN ta.entity_uid::text
                                 ELSE performer.entity_uid::text END AS artist_entity_uid,
                            t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth,
                            t.year,
                            t.bpm,
                            t.audio_key,
                            t.audio_scale,
                            t.energy,
                            t.danceability,
                            t.valence,
                            t.bliss_vector,
                            0.0 AS distance,
                            pg.slug AS genre_slug,
                            1.0::DOUBLE PRECISION AS membership_score,
                            CASE WHEN performer.id IS NULL THEN ta.listeners
                                 ELSE performer.listeners END AS artist_listeners,
                            CASE WHEN performer.id IS NULL THEN ta.spotify_popularity
                                 ELSE performer.spotify_popularity END AS artist_spotify_popularity,
                            CASE WHEN performer.id IS NULL THEN ta.popularity_score
                                 ELSE performer.popularity_score END AS artist_popularity_score,
                            CASE WHEN performer.id IS NULL THEN ta.album_count
                                 ELSE performer.album_count END AS artist_album_count,
                            CASE WHEN performer.id IS NULL THEN ta.track_count
                                 ELSE performer.track_count END AS artist_track_count,
                            CASE WHEN performer.id IS NULL THEN ta.country
                                 ELSE performer.country END AS artist_country,
                            CASE WHEN performer.id IS NULL THEN ta.area
                                 ELSE performer.area END AS artist_area,
                            CASE WHEN performer.id IS NULL THEN ta.formed
                                 ELSE performer.formed END AS artist_formed,
                            LEAST(
                                1.0,
                                COALESCE(arc.relation_count, 0.0) / 20.0
                            ) AS artist_relation_score,
                            t.lastfm_listeners,
                            t.lastfm_playcount,
                            t.lastfm_top_rank,
                            t.spotify_track_popularity,
                            t.spotify_top_rank,
                            t.popularity,
                            t.popularity_score AS track_popularity_score,
                            t.rating,
                            COALESCE(uts.play_count, 0) AS user_play_count,
                            COALESCE(uts.complete_play_count, 0) AS user_complete_play_count,
                            (ult.track_id IS NOT NULL OR global_like.global_track_uid IS NOT NULL) AS is_liked
                        FROM target_artist ta
                        JOIN library_albums a ON a.artist = ta.name
                        JOIN library_tracks t ON t.album_id = a.id
                        LEFT JOIN library_artists performer ON performer.name = t.artist
                        LEFT JOIN primary_genre pg ON TRUE
                        LEFT JOIN artist_relation_counts arc
                          ON arc.artist_name = LOWER(
                              CASE WHEN performer.id IS NULL THEN ta.name ELSE performer.name END
                          )
                        LEFT JOIN user_track_stats uts
                          ON uts.user_id = :user_id
                         AND uts.stat_window = 'all_time'
                         AND (
                             uts.track_id = t.id
                             OR (
                                 uts.track_entity_uid IS NOT NULL
                                 AND t.entity_uid IS NOT NULL
                                 AND uts.track_entity_uid = t.entity_uid
                             )
                         )
                        LEFT JOIN user_liked_tracks ult
                          ON ult.user_id = :user_id
                         AND ult.track_id = t.id
                        LEFT JOIN global_catalog_tracks global_track
                          ON global_track.local_track_id = t.id
                        LEFT JOIN user_global_track_likes global_like
                          ON global_like.user_id = :user_id
                         AND global_like.global_track_uid = global_track.global_track_uid
                        WHERE t.bliss_vector IS NOT NULL
                          AND {playable_track_clause("t", "a")}
                        ORDER BY
                            COALESCE(uts.play_count, 0) DESC,
                            (ult.track_id IS NOT NULL OR global_like.global_track_uid IS NOT NULL) DESC,
                            t.popularity_score DESC NULLS LAST,
                            t.lastfm_top_rank ASC NULLS LAST,
                            t.lastfm_playcount DESC NULLS LAST,
                            t.spotify_track_popularity DESC NULLS LAST,
                            t.rating DESC NULLS LAST,
                            t.id ASC
                        LIMIT :limit
                    ),
                    candidate_artists AS (
                        SELECT DISTINCT _artist_metadata_name AS artist_name
                        FROM anchor_candidates
                    ),
                    {_ARTIST_GENRES_CTE}
                    SELECT candidates.*,
                           COALESCE(ags.artist_genre_slugs, ARRAY[]::TEXT[])
                               AS artist_genre_slugs
                    FROM anchor_candidates candidates
                    LEFT JOIN artist_genre_metadata ags
                      ON ags.artist_name = candidates._artist_metadata_name
                    ORDER BY
                        candidates.user_play_count DESC,
                        candidates.is_liked DESC,
                        candidates.track_popularity_score DESC NULLS LAST,
                        candidates.lastfm_top_rank ASC NULLS LAST,
                        candidates.lastfm_playcount DESC NULLS LAST,
                        candidates.spotify_track_popularity DESC NULLS LAST,
                        candidates.rating DESC NULLS LAST,
                        candidates.id ASC
                    """
                ),
                {
                    "artist_ref": str(artist_ref),
                    "user_id": effective_user_id,
                    "limit": int(limit),
                    **playable_media_params(),
                },
            )
            .mappings()
            .all()
        )

    rows = [
        normalized
        for row in rows
        if (normalized := _normalize_track_row(row)) is not None
    ]
    for row in rows:
        row["genre_slug"] = _canonical_genre_slug(row.get("genre_slug"))
    return rows


def list_scene_path_candidates(
    genre_slugs: list[str],
    *,
    user_id: int | None = None,
    limit_per_genre: int = 100,
    session=None,
) -> dict[str, list[dict]]:
    """Return genre-scoped candidates in one read while preserving each pool's ranking."""
    if not genre_slugs:
        return {}

    requested_genres = list(dict.fromkeys(genre_slugs))
    result: dict[str, list[dict]] = {slug: [] for slug in requested_genres}
    with nullcontext(session) if session is not None else read_scope() as s:
        rows = (
            s.execute(
                text(
                    f"""
                    WITH requested_genres AS (
                        SELECT UNNEST(CAST(:genre_slugs AS TEXT[])) AS genre_slug
                    ),
                    target_nodes AS (
                        SELECT n.id, requested.genre_slug
                        FROM requested_genres requested
                        JOIN genre_taxonomy_nodes n ON n.slug = requested.genre_slug
                    ),
                    target_genres AS (
                        SELECT g.id, requested.genre_slug,
                               1.0::DOUBLE PRECISION AS membership_multiplier
                        FROM requested_genres requested
                        JOIN genres g ON g.slug = requested.genre_slug
                        UNION ALL
                        SELECT g.id, target.genre_slug,
                               CAST(:alias_membership_multiplier AS DOUBLE PRECISION)
                        FROM target_nodes target
                        JOIN genre_taxonomy_aliases gta ON gta.genre_id = target.id
                        JOIN genres g ON g.slug = gta.alias_slug
                        WHERE g.slug != target.genre_slug
                    ),
                    artist_memberships AS (
                        SELECT
                            tg.genre_slug,
                            ag.artist_name,
                            MAX(ag.weight * tg.membership_multiplier)::DOUBLE PRECISION AS membership_score
                        FROM artist_genres ag
                        JOIN target_genres tg ON tg.id = ag.genre_id
                        GROUP BY tg.genre_slug, ag.artist_name
                    ),
                    artist_relation_counts AS (
                        SELECT LOWER(artist_name) AS artist_name, COUNT(*)::DOUBLE PRECISION AS relation_count
                        FROM (
                            SELECT artist_name, similar_name
                            FROM artist_similarities
                            UNION ALL
                            SELECT similar_name AS artist_name, artist_name AS similar_name
                            FROM artist_similarities
                        ) rel
                        GROUP BY LOWER(artist_name)
                    ),
                    ranked_candidates AS (
                        SELECT
                            t.id,
                            t.entity_uid,
                            t.title,
                            t.artist,
                            CASE WHEN performer.id IS NULL THEN ar.name
                                 ELSE performer.name END AS _artist_metadata_name,
                            a.artist AS album_artist,
                            a.name AS album,
                            t.album_id,
                            a.entity_uid::text AS album_entity_uid,
                            CASE WHEN performer.id IS NULL THEN ar.entity_uid::text
                                 ELSE performer.entity_uid::text END AS artist_entity_uid,
                            t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth,
                            t.year,
                            t.bpm,
                            t.audio_key,
                            t.audio_scale,
                            t.energy,
                            t.danceability,
                            t.valence,
                            t.bliss_vector,
                            0.0 AS distance,
                            am.genre_slug AS genre_slug,
                            am.membership_score,
                            CASE WHEN performer.id IS NULL THEN ar.listeners
                                 ELSE performer.listeners END AS artist_listeners,
                            CASE WHEN performer.id IS NULL THEN ar.spotify_popularity
                                 ELSE performer.spotify_popularity END AS artist_spotify_popularity,
                            CASE WHEN performer.id IS NULL THEN ar.popularity_score
                                 ELSE performer.popularity_score END AS artist_popularity_score,
                            CASE WHEN performer.id IS NULL THEN ar.album_count
                                 ELSE performer.album_count END AS artist_album_count,
                            CASE WHEN performer.id IS NULL THEN ar.track_count
                                 ELSE performer.track_count END AS artist_track_count,
                            CASE WHEN performer.id IS NULL THEN ar.country
                                 ELSE performer.country END AS artist_country,
                            CASE WHEN performer.id IS NULL THEN ar.area
                                 ELSE performer.area END AS artist_area,
                            CASE WHEN performer.id IS NULL THEN ar.formed
                                 ELSE performer.formed END AS artist_formed,
                            LEAST(
                                1.0,
                                COALESCE(arc.relation_count, 0.0) / 20.0
                            ) AS artist_relation_score,
                            t.lastfm_listeners,
                            t.lastfm_playcount,
                            t.lastfm_top_rank,
                            t.spotify_track_popularity,
                            t.spotify_top_rank,
                            t.popularity,
                            t.popularity_score AS track_popularity_score,
                            t.rating,
                            COALESCE(uts.play_count, 0) AS user_play_count,
                            COALESCE(uts.complete_play_count, 0) AS user_complete_play_count,
                            (ult.track_id IS NOT NULL OR global_like.global_track_uid IS NOT NULL) AS is_liked,
                            ROW_NUMBER() OVER (
                                PARTITION BY am.genre_slug, LOWER(t.artist)
                                ORDER BY
                                    t.popularity_score DESC NULLS LAST,
                                    t.lastfm_top_rank ASC NULLS LAST,
                                    t.lastfm_playcount DESC NULLS LAST,
                                    t.spotify_track_popularity DESC NULLS LAST,
                                    t.rating DESC NULLS LAST,
                                    t.id ASC
                            ) AS artist_track_rank
                        FROM artist_memberships am
                        JOIN library_artists ar ON ar.name = am.artist_name
                        JOIN library_albums a ON a.artist = am.artist_name
                        JOIN library_tracks t ON t.album_id = a.id
                        LEFT JOIN library_artists performer ON performer.name = t.artist
                        LEFT JOIN artist_relation_counts arc
                          ON arc.artist_name = LOWER(
                              CASE WHEN performer.id IS NULL THEN ar.name ELSE performer.name END
                          )
                        LEFT JOIN user_track_stats uts
                          ON uts.user_id = :user_id
                         AND uts.stat_window = 'all_time'
                         AND (
                             uts.track_id = t.id
                             OR (
                                 uts.track_entity_uid IS NOT NULL
                                 AND t.entity_uid IS NOT NULL
                                 AND uts.track_entity_uid = t.entity_uid
                             )
                         )
                        LEFT JOIN user_liked_tracks ult
                          ON ult.user_id = :user_id
                         AND ult.track_id = t.id
                        LEFT JOIN global_catalog_tracks global_track
                          ON global_track.local_track_id = t.id
                        LEFT JOIN user_global_track_likes global_like
                          ON global_like.user_id = :user_id
                         AND global_like.global_track_uid = global_track.global_track_uid
                        WHERE t.bliss_vector IS NOT NULL
                          AND am.membership_score >= :min_membership_score
                          AND {playable_track_clause("t", "a")}
                    ),
                    ranked_pools AS (
                        SELECT *, ROW_NUMBER() OVER (
                            PARTITION BY genre_slug
                            ORDER BY
                                membership_score DESC NULLS LAST,
                                artist_popularity_score DESC NULLS LAST,
                                artist_listeners DESC NULLS LAST,
                                artist_spotify_popularity DESC NULLS LAST,
                                artist_track_rank ASC,
                                track_popularity_score DESC NULLS LAST,
                                lastfm_top_rank ASC NULLS LAST,
                                lastfm_playcount DESC NULLS LAST,
                                rating DESC NULLS LAST,
                                id ASC
                        ) AS _candidate_rank
                        FROM ranked_candidates
                        WHERE artist_track_rank <= :per_artist_limit
                    ),
                    limited_candidates AS MATERIALIZED (
                        SELECT *
                        FROM ranked_pools
                        WHERE _candidate_rank <= :limit
                    ),
                    candidate_artists AS (
                        SELECT DISTINCT _artist_metadata_name AS artist_name
                        FROM limited_candidates
                    ),
                    {_ARTIST_GENRES_CTE}
                    SELECT candidates.*,
                           COALESCE(ags.artist_genre_slugs, ARRAY[]::TEXT[])
                               AS artist_genre_slugs
                    FROM limited_candidates candidates
                    LEFT JOIN artist_genre_metadata ags
                      ON ags.artist_name = candidates._artist_metadata_name
                    ORDER BY genre_slug, _candidate_rank
                    """
                ),
                {
                    "genre_slugs": requested_genres,
                    "user_id": int(user_id or 0),
                    "alias_membership_multiplier": 0.70,
                    "min_membership_score": 0.45,
                    "per_artist_limit": _tracks_per_artist_limit(limit_per_genre),
                    "limit": int(limit_per_genre),
                    **playable_media_params(),
                },
            )
            .mappings()
            .all()
        )

    for row in rows:
        normalized = _normalize_track_row(row)
        if normalized is not None:
            normalized.pop("_candidate_rank", None)
            result[normalized["genre_slug"]].append(normalized)
    return result


def _tracks_per_artist_limit(limit_per_genre: int) -> int:
    limit = max(1, int(limit_per_genre))
    return max(1, min(10, (limit + 11) // 12))


__all__ = [
    "get_artist_scene_profile",
    "list_artist_scene_anchor_candidates",
    "list_scene_path_candidates",
]
