from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.social_shared import user_profile_sql
from crate.db.tx import read_scope


def get_followers(user_id: int, *, limit: int = 100) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    u.id,
                    u.username,
                    u.name AS display_name,
                    u.avatar,
                    ur.created_at AS followed_at
                FROM user_relationships ur
                JOIN users u ON u.id = ur.follower_user_id
                WHERE ur.followed_user_id = :user_id
                ORDER BY ur.created_at DESC
                LIMIT :lim
                """
                ),
                {"user_id": user_id, "lim": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_following(user_id: int, *, limit: int = 100) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    u.id,
                    u.username,
                    u.name AS display_name,
                    u.avatar,
                    ur.created_at AS followed_at
                FROM user_relationships ur
                JOIN users u ON u.id = ur.followed_user_id
                WHERE ur.follower_user_id = :user_id
                ORDER BY ur.created_at DESC
                LIMIT :lim
                """
                ),
                {"user_id": user_id, "lim": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def search_users(query: str, *, limit: int = 20) -> list[dict]:
    if not query.strip():
        return []
    pattern = f"%{query.strip()}%"
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    id,
                    username,
                    name AS display_name,
                    avatar,
                    bio,
                    created_at AS joined_at
                FROM users
                WHERE COALESCE(username, '') ILIKE :pattern
                   OR COALESCE(name, '') ILIKE :pattern
                ORDER BY
                    CASE WHEN COALESCE(username, '') ILIKE :pattern THEN 0 ELSE 1 END,
                    created_at DESC
                LIMIT :lim
                """
                ),
                {"pattern": pattern, "lim": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_public_user_profile(user_id: int) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(user_profile_sql("u.id = :user_id")),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_public_user_profile_by_username(username: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(user_profile_sql("u.username = :username")),
                {"username": username},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_public_playlists_for_user(user_id: int) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT DISTINCT
                    p.id,
                    p.name,
                    p.description,
                    p.cover_data_url,
                    p.cover_path,
                    p.visibility,
                    p.is_collaborative,
                    p.track_count,
                    p.total_duration,
                    p.updated_at
                FROM playlists p
                JOIN playlist_members pm ON pm.playlist_id = p.id
                WHERE pm.user_id = :user_id
                  AND p.scope = 'user'
                  AND p.visibility = 'public'
                ORDER BY p.updated_at DESC
                """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_profile_contributions_preview(user_id: int, *, limit: int = 8) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    lc.id,
                    lc.source,
                    lc.album_id,
                    lc.album_entity_uid::TEXT AS album_entity_uid,
                    la.slug AS album_slug,
                    COALESCE(la.artist, lc.artist_name) AS artist_name,
                    COALESCE(la.name, lc.album_name) AS album_name,
                    la.has_cover,
                    lc.imported_at
                FROM library_contributions lc
                LEFT JOIN library_albums la ON la.id = lc.album_id
                WHERE lc.user_id = :user_id
                  AND lc.status = 'active'
                ORDER BY lc.imported_at DESC, lc.id DESC
                LIMIT :lim
                """
                ),
                {"user_id": user_id, "lim": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_profile_card_summary(user_id: int) -> dict:
    with read_scope() as session:
        top_genre_row = (
            session.execute(
                text(
                    """
                SELECT
                    genre_name AS name,
                    play_count,
                    minutes_listened
                FROM user_genre_stats
                WHERE user_id = :user_id
                  AND stat_window = '90d'
                  AND COALESCE(genre_name, '') <> ''
                ORDER BY play_count DESC, minutes_listened DESC, genre_name ASC
                LIMIT 1
                """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
        stats_row = (
            session.execute(
                text(
                    """
                SELECT
                    COALESCE((
                        SELECT SUM(play_count)
                        FROM user_track_stats
                        WHERE user_id = :user_id
                          AND stat_window = '30d'
                    ), 0)::INTEGER AS plays_30d,
                    COALESCE((
                        SELECT SUM(minutes_listened)
                        FROM user_track_stats
                        WHERE user_id = :user_id
                          AND stat_window = '30d'
                    ), 0)::DOUBLE PRECISION AS minutes_30d,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM library_contributions
                        WHERE user_id = :user_id
                          AND status = 'active'
                    ), 0)::INTEGER AS contributions,
                    COALESCE((
                        SELECT COUNT(DISTINCT p.id)
                        FROM playlists p
                        JOIN playlist_members pm ON pm.playlist_id = p.id
                        WHERE pm.user_id = :user_id
                          AND p.scope = 'user'
                          AND p.visibility = 'public'
                    ), 0)::INTEGER AS public_playlists,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM library_contributions
                        WHERE user_id = :user_id
                          AND status = 'active'
                          AND source = 'bandcamp'
                    ), 0)::INTEGER AS bandcamp_contributions
                """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .one()
        )

    return {
        "top_genre": dict(top_genre_row) if top_genre_row else None,
        "stats": {
            "plays_30d": int(stats_row["plays_30d"] or 0),
            "minutes_30d": float(stats_row["minutes_30d"] or 0),
            "contributions": int(stats_row["contributions"] or 0),
            "public_playlists": int(stats_row["public_playlists"] or 0),
        },
        "bandcamp_contributions": int(stats_row["bandcamp_contributions"] or 0),
    }


__all__ = [
    "get_followers",
    "get_following",
    "get_profile_contributions_preview",
    "get_profile_card_summary",
    "get_public_playlists_for_user",
    "get_public_user_profile",
    "get_public_user_profile_by_username",
    "search_users",
]
