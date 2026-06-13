from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_recent_global_artist_rows(limit: int = 10) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    la.id,
                    la.slug,
                    la.name,
                    la.album_count,
                    la.track_count,
                    la.has_photo,
                    COALESCE(
                        MIN(
                            COALESCE(
                                alb.dir_mtime,
                                EXTRACT(EPOCH FROM alb.updated_at)::double precision
                            )
                        ),
                        COALESCE(
                            la.dir_mtime,
                            EXTRACT(EPOCH FROM la.updated_at)::double precision
                        ),
                        0
                    ) AS first_added_sort
                FROM library_artists la
                LEFT JOIN library_albums alb ON alb.artist = la.name
                WHERE la.name NOT LIKE '.%'
                  AND COALESCE(la.folder_name, '') NOT LIKE '.%'
                GROUP BY
                    la.id,
                    la.slug,
                    la.name,
                    la.album_count,
                    la.track_count,
                    la.has_photo,
                    la.dir_mtime,
                    la.updated_at
                ORDER BY first_added_sort DESC, la.name ASC
                LIMIT :limit
                """
                ),
                {"limit": max(limit, 1)},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_home_hero_rows(
    *,
    user_id: int | None = None,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
    limit: int = 40,
) -> list[dict]:
    row_limit = min(max(limit, 1), 80)
    with read_scope() as session:
        rows_result = (
            session.execute(
                text(
                    """
                SELECT
                    la.id,
                    la.slug,
                    la.name,
                    COALESCE(la.listeners, 0) AS listeners,
                    COALESCE(la.lastfm_playcount, 0) AS scrobbles,
                    COALESCE(la.album_count, 0) AS album_count,
                    COALESCE(la.track_count, 0) AS track_count,
                    COALESCE(la.bio, '') AS bio,
                    COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) AS genre_hits,
                    MAX(CASE WHEN LOWER(sim.similar_name) = ANY(:similar_targets) THEN 1 ELSE 0 END) AS similar_hits,
                    COALESCE((
                        SELECT SUM(ure.shown_count)
                        FROM user_recommendation_exposures ure
                        WHERE ure.user_id = :user_id
                          AND ure.surface = 'home.hero'
                          AND ure.entity_type = 'artist'
                          AND ure.entity_key = 'artist:' || la.slug
                          AND ure.shown_on >= CURRENT_DATE - INTERVAL '14 days'
                          AND (ure.expires_at IS NULL OR ure.expires_at > NOW())
                    ), 0)::INTEGER AS recent_exposure_count,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM user_recommendation_feedback urf_positive
                        WHERE urf_positive.user_id = :user_id
                          AND urf_positive.surface = 'home.hero'
                          AND urf_positive.entity_type = 'artist'
                          AND urf_positive.entity_key = 'artist:' || la.slug
                          AND urf_positive.action = ANY(:positive_actions)
                          AND (urf_positive.expires_at IS NULL OR urf_positive.expires_at > NOW())
                    ), 0)::INTEGER AS positive_feedback_count
                FROM library_artists la
                LEFT JOIN artist_genres ag ON ag.artist_name = la.name
                LEFT JOIN genres g ON g.id = ag.genre_id
                LEFT JOIN artist_similarities sim ON sim.artist_name = la.name AND sim.in_library = TRUE
                WHERE la.has_photo = 1
                  AND la.name NOT LIKE '.%'
                  AND COALESCE(la.folder_name, '') NOT LIKE '.%'
                  AND COALESCE(la.bio, '') <> ''
                  AND NOT (LOWER(la.name) = ANY(:followed))
                  AND (
                    :user_id IS NULL
                    OR NOT EXISTS (
                        SELECT 1
                        FROM user_recommendation_feedback urf
                        WHERE urf.user_id = :user_id
                          AND urf.surface = 'home.hero'
                          AND urf.entity_type = 'artist'
                          AND urf.entity_key = 'artist:' || la.slug
                          AND urf.action = ANY(:negative_actions)
                          AND (urf.expires_at IS NULL OR urf.expires_at > NOW())
                    )
                  )
                GROUP BY la.id, la.slug, la.name, la.listeners, la.lastfm_playcount, la.album_count, la.track_count, la.bio
                HAVING COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) > 0
                ORDER BY
                    MAX(CASE WHEN LOWER(sim.similar_name) = ANY(:similar_targets) THEN 1 ELSE 0 END) DESC,
                    COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) DESC,
                    COALESCE(la.listeners, 0) DESC,
                    COALESCE(la.lastfm_playcount, 0) DESC
                LIMIT :limit
                """
                ),
                {
                    "top_genres": top_genres_lower,
                    "similar_targets": similar_target_names_lower,
                    "followed": followed_names_lower,
                    "user_id": user_id,
                    "negative_actions": [
                        "dismiss",
                        "not_interested",
                        "ignored_cooldown",
                    ],
                    "positive_actions": [
                        "opened",
                        "played",
                        "followed",
                    ],
                    "limit": row_limit,
                },
            )
            .mappings()
            .all()
        )

        if not rows_result:
            rows_result = (
                session.execute(
                    text(
                        """
                    SELECT
                        id,
                        slug,
                        name,
                        COALESCE(listeners, 0) AS listeners,
                        COALESCE(lastfm_playcount, 0) AS scrobbles,
                        COALESCE(album_count, 0) AS album_count,
                        COALESCE(track_count, 0) AS track_count,
                        COALESCE(bio, '') AS bio,
                        0::INTEGER AS genre_hits,
                        0::INTEGER AS similar_hits,
                        COALESCE((
                            SELECT SUM(ure.shown_count)
                            FROM user_recommendation_exposures ure
                            WHERE ure.user_id = :user_id
                              AND ure.surface = 'home.hero'
                              AND ure.entity_type = 'artist'
                              AND ure.entity_key = 'artist:' || library_artists.slug
                              AND ure.shown_on >= CURRENT_DATE - INTERVAL '14 days'
                              AND (ure.expires_at IS NULL OR ure.expires_at > NOW())
                        ), 0)::INTEGER AS recent_exposure_count,
                        COALESCE((
                            SELECT COUNT(*)
                            FROM user_recommendation_feedback urf_positive
                            WHERE urf_positive.user_id = :user_id
                              AND urf_positive.surface = 'home.hero'
                              AND urf_positive.entity_type = 'artist'
                              AND urf_positive.entity_key = 'artist:' || library_artists.slug
                              AND urf_positive.action = ANY(:positive_actions)
                              AND (urf_positive.expires_at IS NULL OR urf_positive.expires_at > NOW())
                        ), 0)::INTEGER AS positive_feedback_count
                    FROM library_artists
                    WHERE has_photo = 1
                      AND name NOT LIKE '.%'
                      AND COALESCE(folder_name, '') NOT LIKE '.%'
                      AND COALESCE(bio, '') <> ''
                      AND NOT (LOWER(name) = ANY(:followed))
                      AND (
                        :user_id IS NULL
                        OR NOT EXISTS (
                            SELECT 1
                            FROM user_recommendation_feedback urf
                            WHERE urf.user_id = :user_id
                              AND urf.surface = 'home.hero'
                              AND urf.entity_type = 'artist'
                              AND urf.entity_key = 'artist:' || library_artists.slug
                              AND urf.action = ANY(:negative_actions)
                              AND (urf.expires_at IS NULL OR urf.expires_at > NOW())
                        )
                      )
                    ORDER BY COALESCE(listeners, 0) DESC, COALESCE(lastfm_playcount, 0) DESC
                    LIMIT :limit
                    """
                    ),
                    {
                        "followed": followed_names_lower,
                        "user_id": user_id,
                        "negative_actions": [
                            "dismiss",
                            "not_interested",
                            "ignored_cooldown",
                        ],
                        "positive_actions": [
                            "opened",
                            "played",
                            "followed",
                        ],
                        "limit": row_limit,
                    },
                )
                .mappings()
                .all()
            )

    return [dict(item) for item in rows_result]


def get_artist_genres_map(artist_names: list[str]) -> dict[str, list[str]]:
    if not artist_names:
        return {}
    with read_scope() as session:
        genre_rows = (
            session.execute(
                text(
                    """
                SELECT ag.artist_name, g.name
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.artist_name = ANY(:names)
                ORDER BY ag.artist_name
                """
                ),
                {"names": artist_names},
            )
            .mappings()
            .all()
        )

    genre_map: dict[str, list[str]] = {}
    for row in genre_rows:
        genre_map.setdefault(row["artist_name"], []).append(row["name"])
    return genre_map


def get_library_artist_by_id(artist_id: int) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text("SELECT id, slug, name FROM library_artists WHERE id = :id"),
                {"id": artist_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_followed_artist_genre_names(names: list[str], limit: int) -> list[str]:
    if not names:
        return []
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT g.name, COUNT(*) AS cnt
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE LOWER(ag.artist_name) = ANY(:names)
                GROUP BY g.name
                ORDER BY cnt DESC
                LIMIT :lim
                """
                ),
                {"names": names, "lim": limit},
            )
            .mappings()
            .all()
        )
    return [row["name"].lower() for row in rows]


__all__ = [
    "get_artist_genres_map",
    "get_followed_artist_genre_names",
    "get_home_hero_rows",
    "get_library_artist_by_id",
    "get_recent_global_artist_rows",
]
