"""User-signal and feedback queries for the shaped radio engine."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.playable_media_filters import (
    playable_album_clause,
    playable_media_params,
    playable_track_clause,
)
from crate.db.tx import optional_scope

_FEEDBACK_SAMPLE_PER_ACTION = 25


def _vectors_from_rows(rows) -> list[list[float]]:
    return [list(row["bliss_vector"]) for row in rows]


def get_recent_liked_seed_rows(
    user_id: int, limit: int = 10, *, session=None
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    f"""
                SELECT t.id AS track_id, t.artist, t.title, t.bliss_vector
                FROM user_liked_tracks lt
                JOIN library_tracks t ON t.id = lt.track_id
                LEFT JOIN library_albums a ON a.id = t.album_id
                WHERE lt.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                  AND {playable_track_clause("t", "a")}
                ORDER BY lt.created_at DESC
                LIMIT :limit
                """
                ),
                {"user_id": user_id, "limit": limit, **playable_media_params()},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_recent_liked_vectors(
    user_id: int, limit: int = 10, *, session=None
) -> list[list[float]]:
    return _vectors_from_rows(
        get_recent_liked_seed_rows(user_id, limit, session=session)
    )


def get_followed_artist_seed_rows(
    user_id: int, limit: int = 30, *, session=None
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    f"""
                SELECT DISTINCT ON (t.id)
                    t.id AS track_id, t.artist, t.title, t.bliss_vector
                FROM user_follows af
                JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
                JOIN library_tracks t ON t.album_id = a.id
                WHERE af.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                  AND {playable_track_clause("t", "a")}
                ORDER BY t.id
                LIMIT :limit
                """
                ),
                {"user_id": user_id, "limit": limit, **playable_media_params()},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_followed_artist_vectors(
    user_id: int, limit: int = 30, *, session=None
) -> list[list[float]]:
    return _vectors_from_rows(
        get_followed_artist_seed_rows(user_id, limit, session=session)
    )


def get_saved_album_seed_rows(
    user_id: int, limit: int = 30, *, session=None
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    f"""
                SELECT t.id AS track_id, t.artist, t.title, t.bliss_vector
                FROM user_saved_albums sa
                JOIN library_albums a ON a.id = sa.album_id
                JOIN library_tracks t ON t.album_id = a.id
                WHERE sa.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                  AND {playable_track_clause("t", "a")}
                LIMIT :limit
                """
                ),
                {"user_id": user_id, "limit": limit, **playable_media_params()},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_saved_album_vectors(
    user_id: int, limit: int = 30, *, session=None
) -> list[list[float]]:
    return _vectors_from_rows(
        get_saved_album_seed_rows(user_id, limit, session=session)
    )


def get_recent_play_seed_rows(
    user_id: int, limit: int = 20, *, session=None
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    f"""
                SELECT t.id AS track_id, t.artist, t.title, t.bliss_vector
                FROM user_play_events pe
                LEFT JOIN library_tracks t
                  ON t.id = pe.track_id
                  OR (pe.track_id IS NULL AND pe.track_entity_uid IS NOT NULL AND t.entity_uid = pe.track_entity_uid)
                LEFT JOIN library_albums a ON a.id = t.album_id
                WHERE pe.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                  AND {playable_track_clause("t", "a")}
                ORDER BY pe.ended_at DESC
                LIMIT :limit
                """
                ),
                {"user_id": user_id, "limit": limit, **playable_media_params()},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_recent_play_vectors(
    user_id: int, limit: int = 20, *, session=None
) -> list[list[float]]:
    return _vectors_from_rows(
        get_recent_play_seed_rows(user_id, limit, session=session)
    )


def count_user_radio_signals(user_id: int, *, session=None) -> dict:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                SELECT
                    (SELECT count(*) FROM user_liked_tracks WHERE user_id = :uid) AS likes,
                    (SELECT count(*) FROM user_follows WHERE user_id = :uid) AS follows,
                    (SELECT count(*) FROM user_saved_albums WHERE user_id = :uid) AS saved_albums
                """
                ),
                {"uid": user_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else {"likes": 0, "follows": 0, "saved_albums": 0}


def get_discovery_seed_sources(user_id: int, *, session=None) -> dict[int, list[dict]]:
    """Fetch discovery seed candidates from all sources in one roundtrip.

    Returns rows grouped by priority:
      1 = recent liked tracks
      2 = followed artist tracks
      3 = saved album tracks
      4 = recent play tracks

    Each group is already limited to a useful size. The caller picks the
    highest-priority group that meets its minimum-vector threshold.
    """
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    f"""
                WITH liked AS (
                    SELECT
                        t.id AS track_id,
                        t.artist,
                        t.title,
                        t.bliss_vector,
                        ROW_NUMBER() OVER (ORDER BY lt.created_at DESC, t.id) AS source_rank
                    FROM user_liked_tracks lt
                    JOIN library_tracks t ON t.id = lt.track_id
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE lt.user_id = :uid
                      AND t.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                    ORDER BY lt.created_at DESC, t.id
                    LIMIT 10
                ),
                followed AS (
                    SELECT
                        t.id AS track_id,
                        t.artist,
                        t.title,
                        t.bliss_vector,
                        ROW_NUMBER() OVER (ORDER BY t.id) AS source_rank
                    FROM user_follows af
                    JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
                    JOIN library_tracks t ON t.album_id = a.id
                    WHERE af.user_id = :uid
                      AND t.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                    ORDER BY t.id
                    LIMIT 30
                ),
                saved AS (
                    SELECT
                        t.id AS track_id,
                        t.artist,
                        t.title,
                        t.bliss_vector,
                        ROW_NUMBER() OVER (ORDER BY sa.created_at DESC, t.id) AS source_rank
                    FROM user_saved_albums sa
                    JOIN library_albums a ON a.id = sa.album_id
                    JOIN library_tracks t ON t.album_id = a.id
                    WHERE sa.user_id = :uid
                      AND t.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                    ORDER BY sa.created_at DESC, t.id
                    LIMIT 30
                ),
                plays AS (
                    SELECT
                        t.id AS track_id,
                        t.artist,
                        t.title,
                        t.bliss_vector,
                        ROW_NUMBER() OVER (ORDER BY pe.ended_at DESC, t.id) AS source_rank
                    FROM user_play_events pe
                    JOIN library_tracks t
                      ON t.id = pe.track_id
                      OR (pe.track_id IS NULL AND pe.track_entity_uid IS NOT NULL
                          AND t.entity_uid = pe.track_entity_uid)
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE pe.user_id = :uid
                      AND t.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                    ORDER BY pe.ended_at DESC, t.id
                    LIMIT 20
                )
                SELECT priority, track_id, artist, title, bliss_vector
                FROM (
                    SELECT 1 AS priority, track_id, artist, title, bliss_vector, source_rank FROM liked
                    UNION ALL
                    SELECT 2 AS priority, track_id, artist, title, bliss_vector, source_rank FROM followed
                    UNION ALL
                    SELECT 3 AS priority, track_id, artist, title, bliss_vector, source_rank FROM saved
                    UNION ALL
                    SELECT 4 AS priority, track_id, artist, title, bliss_vector, source_rank FROM plays
                ) sources
                ORDER BY priority, source_rank
                """
                ),
                {"uid": user_id, **playable_media_params()},
            )
            .mappings()
            .all()
        )

    grouped: dict[int, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["priority"], []).append(dict(row))
    return grouped


def get_discovery_excluded_artist_keys(user_id: int, *, session=None) -> list[str]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    f"""
                WITH followed AS (
                    SELECT artist_name
                    FROM user_follows
                    WHERE user_id = :uid
                      AND LOWER(COALESCE(artist_name, '')) <> '.crate-trash'
                ),
                liked AS (
                    SELECT t.artist AS artist_name
                    FROM user_liked_tracks lt
                    JOIN library_tracks t ON t.id = lt.track_id
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE lt.user_id = :uid
                      AND {playable_track_clause("t", "a")}
                ),
                saved AS (
                    SELECT a.artist AS artist_name
                    FROM user_saved_albums sa
                    JOIN library_albums a ON a.id = sa.album_id
                    WHERE sa.user_id = :uid
                      AND {playable_album_clause("a")}
                ),
                recent_plays AS (
                    SELECT COALESCE(NULLIF(TRIM(pe.artist), ''), t.artist) AS artist_name
                    FROM user_play_events pe
                    LEFT JOIN library_tracks t
                      ON t.id = pe.track_id
                      OR (pe.track_id IS NULL AND pe.track_entity_uid IS NOT NULL
                          AND t.entity_uid = pe.track_entity_uid)
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE pe.user_id = :uid
                      AND (
                        t.id IS NULL
                        OR {playable_track_clause("t", "a")}
                      )
                      AND (
                        pe.ended_at IS NULL
                        OR pe.ended_at > now() - INTERVAL '180 days'
                      )
                    ORDER BY pe.ended_at DESC NULLS LAST
                    LIMIT 200
                )
                SELECT DISTINCT LOWER(TRIM(artist_name)) AS artist_key
                FROM (
                    SELECT artist_name FROM followed
                    UNION ALL
                    SELECT artist_name FROM liked
                    UNION ALL
                    SELECT artist_name FROM saved
                    UNION ALL
                    SELECT artist_name FROM recent_plays
                ) known
                WHERE artist_name IS NOT NULL
                  AND TRIM(artist_name) != ''
                  AND LOWER(TRIM(artist_name)) <> '.crate-trash'
                """
                ),
                {"uid": user_id, **playable_media_params()},
            )
            .mappings()
            .all()
        )
    return [str(row["artist_key"]) for row in rows if row.get("artist_key")]


def load_feedback_history(
    user_id: int, max_age_days: int = 90, *, session=None
) -> tuple[list[list[float]], list[list[float]]]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    f"""
                (
                    SELECT rf.action, rf.bliss_vector
                    FROM radio_feedback rf
                    JOIN library_tracks t ON t.id = rf.track_id
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE rf.user_id = :user_id
                      AND rf.action = 'like'
                      AND rf.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                      AND rf.created_at > now() - (:max_age_days * INTERVAL '1 day')
                    ORDER BY random()
                    LIMIT :per_action_limit
                )
                UNION ALL
                (
                    SELECT rf.action, rf.bliss_vector
                    FROM radio_feedback rf
                    JOIN library_tracks t ON t.id = rf.track_id
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE rf.user_id = :user_id
                      AND rf.action = 'dislike'
                      AND rf.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                      AND rf.created_at > now() - (:max_age_days * INTERVAL '1 day')
                    ORDER BY random()
                    LIMIT :per_action_limit
                )
                """
                ),
                {
                    "user_id": user_id,
                    "max_age_days": int(max_age_days),
                    "per_action_limit": _FEEDBACK_SAMPLE_PER_ACTION,
                    **playable_media_params(),
                },
            )
            .mappings()
            .all()
        )

    liked: list[list[float]] = []
    disliked: list[list[float]] = []
    for row in rows:
        vec = list(row["bliss_vector"])
        if row["action"] == "like":
            liked.append(vec)
        elif row["action"] == "dislike":
            disliked.append(vec)
    return liked, disliked


__all__ = [
    "count_user_radio_signals",
    "get_discovery_excluded_artist_keys",
    "get_discovery_seed_sources",
    "get_followed_artist_seed_rows",
    "get_followed_artist_vectors",
    "get_recent_liked_seed_rows",
    "get_recent_liked_vectors",
    "get_recent_play_seed_rows",
    "get_recent_play_vectors",
    "get_saved_album_seed_rows",
    "get_saved_album_vectors",
    "load_feedback_history",
]
