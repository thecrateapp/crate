"""User-signal and feedback queries for the shaped radio engine."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import optional_scope

_FEEDBACK_SAMPLE_PER_ACTION = 25


def _vectors_from_rows(rows) -> list[list[float]]:
    return [list(row["bliss_vector"]) for row in rows]


def get_recent_liked_seed_rows(user_id: int, limit: int = 10, *, session=None) -> list[dict]:
    with optional_scope(session) as s:
        rows = s.execute(
            text(
                """
                SELECT t.id AS track_id, t.artist, t.bliss_vector
                FROM user_liked_tracks lt
                JOIN library_tracks t ON t.id = lt.track_id
                WHERE lt.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY lt.created_at DESC
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_recent_liked_vectors(user_id: int, limit: int = 10, *, session=None) -> list[list[float]]:
    return _vectors_from_rows(get_recent_liked_seed_rows(user_id, limit, session=session))


def get_followed_artist_seed_rows(user_id: int, limit: int = 30, *, session=None) -> list[dict]:
    with optional_scope(session) as s:
        rows = s.execute(
            text(
                """
                SELECT DISTINCT ON (t.id) t.id AS track_id, t.artist, t.bliss_vector
                FROM user_follows af
                JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
                JOIN library_tracks t ON t.album_id = a.id
                WHERE af.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY t.id
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_followed_artist_vectors(user_id: int, limit: int = 30, *, session=None) -> list[list[float]]:
    return _vectors_from_rows(get_followed_artist_seed_rows(user_id, limit, session=session))


def get_saved_album_seed_rows(user_id: int, limit: int = 30, *, session=None) -> list[dict]:
    with optional_scope(session) as s:
        rows = s.execute(
            text(
                """
                SELECT t.id AS track_id, t.artist, t.bliss_vector
                FROM user_saved_albums sa
                JOIN library_tracks t ON t.album_id = sa.album_id
                WHERE sa.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_saved_album_vectors(user_id: int, limit: int = 30, *, session=None) -> list[list[float]]:
    return _vectors_from_rows(get_saved_album_seed_rows(user_id, limit, session=session))


def get_recent_play_seed_rows(user_id: int, limit: int = 20, *, session=None) -> list[dict]:
    with optional_scope(session) as s:
        rows = s.execute(
            text(
                """
                SELECT t.id AS track_id, t.artist, t.bliss_vector
                FROM user_play_events pe
                LEFT JOIN library_tracks t
                  ON t.id = pe.track_id
                  OR (pe.track_id IS NULL AND pe.track_entity_uid IS NOT NULL AND t.entity_uid = pe.track_entity_uid)
                WHERE pe.user_id = :user_id
                  AND t.bliss_vector IS NOT NULL
                ORDER BY pe.ended_at DESC
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_recent_play_vectors(user_id: int, limit: int = 20, *, session=None) -> list[list[float]]:
    return _vectors_from_rows(get_recent_play_seed_rows(user_id, limit, session=session))


def count_user_radio_signals(user_id: int, *, session=None) -> dict:
    with optional_scope(session) as s:
        row = s.execute(
            text(
                """
                SELECT
                    (SELECT count(*) FROM user_liked_tracks WHERE user_id = :uid) AS likes,
                    (SELECT count(*) FROM user_follows WHERE user_id = :uid) AS follows,
                    (SELECT count(*) FROM user_saved_albums WHERE user_id = :uid) AS saved_albums
                """
            ),
            {"uid": user_id},
        ).mappings().first()
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
        rows = s.execute(
            text(
                """
                WITH liked AS (
                    SELECT
                        t.id AS track_id,
                        t.artist,
                        t.bliss_vector,
                        ROW_NUMBER() OVER (ORDER BY lt.created_at DESC, t.id) AS source_rank
                    FROM user_liked_tracks lt
                    JOIN library_tracks t ON t.id = lt.track_id
                    WHERE lt.user_id = :uid
                      AND t.bliss_vector IS NOT NULL
                    ORDER BY lt.created_at DESC, t.id
                    LIMIT 10
                ),
                followed AS (
                    SELECT
                        t.id AS track_id,
                        t.artist,
                        t.bliss_vector,
                        ROW_NUMBER() OVER (ORDER BY t.id) AS source_rank
                    FROM user_follows af
                    JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
                    JOIN library_tracks t ON t.album_id = a.id
                    WHERE af.user_id = :uid
                      AND t.bliss_vector IS NOT NULL
                    ORDER BY t.id
                    LIMIT 30
                ),
                saved AS (
                    SELECT
                        t.id AS track_id,
                        t.artist,
                        t.bliss_vector,
                        ROW_NUMBER() OVER (ORDER BY sa.created_at DESC, t.id) AS source_rank
                    FROM user_saved_albums sa
                    JOIN library_tracks t ON t.album_id = sa.album_id
                    WHERE sa.user_id = :uid
                      AND t.bliss_vector IS NOT NULL
                    ORDER BY sa.created_at DESC, t.id
                    LIMIT 30
                ),
                plays AS (
                    SELECT
                        t.id AS track_id,
                        t.artist,
                        t.bliss_vector,
                        ROW_NUMBER() OVER (ORDER BY pe.ended_at DESC, t.id) AS source_rank
                    FROM user_play_events pe
                    JOIN library_tracks t
                      ON t.id = pe.track_id
                      OR (pe.track_id IS NULL AND pe.track_entity_uid IS NOT NULL
                          AND t.entity_uid = pe.track_entity_uid)
                    WHERE pe.user_id = :uid
                      AND t.bliss_vector IS NOT NULL
                    ORDER BY pe.ended_at DESC, t.id
                    LIMIT 20
                )
                SELECT priority, track_id, artist, bliss_vector
                FROM (
                    SELECT 1 AS priority, track_id, artist, bliss_vector, source_rank FROM liked
                    UNION ALL
                    SELECT 2 AS priority, track_id, artist, bliss_vector, source_rank FROM followed
                    UNION ALL
                    SELECT 3 AS priority, track_id, artist, bliss_vector, source_rank FROM saved
                    UNION ALL
                    SELECT 4 AS priority, track_id, artist, bliss_vector, source_rank FROM plays
                ) sources
                ORDER BY priority, source_rank
                """
            ),
            {"uid": user_id},
        ).mappings().all()

    grouped: dict[int, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["priority"], []).append(dict(row))
    return grouped


def load_feedback_history(user_id: int, max_age_days: int = 90, *, session=None) -> tuple[list[list[float]], list[list[float]]]:
    with optional_scope(session) as s:
        rows = s.execute(
            text(
                """
                (
                    SELECT action, bliss_vector
                    FROM radio_feedback
                    WHERE user_id = :user_id
                      AND action = 'like'
                      AND bliss_vector IS NOT NULL
                      AND created_at > now() - (:max_age_days * INTERVAL '1 day')
                    ORDER BY random()
                    LIMIT :per_action_limit
                )
                UNION ALL
                (
                    SELECT action, bliss_vector
                    FROM radio_feedback
                    WHERE user_id = :user_id
                      AND action = 'dislike'
                      AND bliss_vector IS NOT NULL
                      AND created_at > now() - (:max_age_days * INTERVAL '1 day')
                    ORDER BY random()
                    LIMIT :per_action_limit
                )
                """
            ),
            {
                "user_id": user_id,
                "max_age_days": int(max_age_days),
                "per_action_limit": _FEEDBACK_SAMPLE_PER_ACTION,
            },
        ).mappings().all()

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
