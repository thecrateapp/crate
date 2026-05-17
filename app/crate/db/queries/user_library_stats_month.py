from __future__ import annotations

from calendar import month_name
from datetime import date, datetime, timezone

from sqlalchemy import text

from crate.db.tx import read_scope


def month_bounds(month: str) -> tuple[datetime, datetime]:
    try:
        start_date = date.fromisoformat(f"{month}-01")
    except ValueError as exc:
        raise ValueError(f"Unsupported stats month: {month}") from exc
    next_year = start_date.year + (1 if start_date.month == 12 else 0)
    next_month = 1 if start_date.month == 12 else start_date.month + 1
    end_date = date(next_year, next_month, 1)
    return (
        datetime(start_date.year, start_date.month, 1, tzinfo=timezone.utc),
        datetime(end_date.year, end_date.month, 1, tzinfo=timezone.utc),
    )


def month_title(month: str) -> str:
    start, _ = month_bounds(month)
    return f"{month_name[start.month]} {start.year}"


def month_period_key(month: str) -> str:
    month_bounds(month)
    return f"month:{month}"


def get_month_stats_overview(user_id: int, month: str) -> dict:
    start, end = month_bounds(month)
    period_key = month_period_key(month)
    with read_scope() as session:
        overview_row = (
            session.execute(
                text(
                    """
                    SELECT
                        COALESCE(SUM(play_count), 0) AS play_count,
                        COALESCE(SUM(complete_play_count), 0) AS complete_play_count,
                        COALESCE(SUM(skip_count), 0) AS skip_count,
                        COALESCE(SUM(minutes_listened), 0) AS minutes_listened,
                        COUNT(*)::INTEGER AS active_days
                    FROM user_daily_listening
                    WHERE user_id = :user_id
                      AND day >= CAST(:start AS DATE)
                      AND day < CAST(:end AS DATE)
                    """
                ),
                {"user_id": user_id, "start": start.date(), "end": end.date()},
            )
            .mappings()
            .first()
        )
        top_artist_row = (
            session.execute(
                text(
                    """
                    SELECT
                        COALESCE(NULLIF(TRIM(upe.artist), ''), 'Unknown artist') AS artist_name,
                        la.id AS artist_id,
                        la.slug AS artist_slug,
                        COUNT(*)::integer AS play_count,
                        COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened
                    FROM user_play_events upe
                    LEFT JOIN library_artists la ON lower(la.name) = lower(upe.artist)
                    WHERE upe.user_id = :user_id
                      AND upe.ended_at >= CAST(:start AS TIMESTAMPTZ)
                      AND upe.ended_at < CAST(:end AS TIMESTAMPTZ)
                      AND COALESCE(NULLIF(TRIM(upe.artist), ''), '') <> ''
                    GROUP BY 1, la.id, la.slug
                    ORDER BY play_count DESC, minutes_listened DESC, artist_name
                    LIMIT 1
                    """
                ),
                {"user_id": user_id, "start": start, "end": end},
            )
            .mappings()
            .first()
        )

    overview = dict(overview_row or {})
    play_count = overview.get("play_count", 0) or 0
    skip_count = overview.get("skip_count", 0) or 0
    return {
        "window": period_key,
        "play_count": play_count,
        "complete_play_count": overview.get("complete_play_count", 0) or 0,
        "skip_count": skip_count,
        "minutes_listened": overview.get("minutes_listened", 0) or 0,
        "active_days": overview.get("active_days", 0) or 0,
        "skip_rate": (skip_count / play_count) if play_count else 0,
        "top_artist": dict(top_artist_row) if top_artist_row else None,
    }


def get_month_stats_trends(user_id: int, month: str) -> dict:
    start, end = month_bounds(month)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                    FROM user_daily_listening
                    WHERE user_id = :user_id
                      AND day >= CAST(:start AS DATE)
                      AND day < CAST(:end AS DATE)
                    ORDER BY day ASC
                    """
                ),
                {"user_id": user_id, "start": start.date(), "end": end.date()},
            )
            .mappings()
            .all()
        )
    return {"window": month_period_key(month), "points": [dict(row) for row in rows]}


def get_month_top_tracks(user_id: int, month: str, limit: int = 20) -> list[dict]:
    start, end = month_bounds(month)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    WITH resolved AS (
                        SELECT
                            COALESCE(lt.entity_uid::text, upe.track_entity_uid::text, lt.id::text, upe.track_id::text, NULLIF(upe.track_path, ''), CONCAT(upe.artist, '||', upe.title)) AS entity_key,
                            COALESCE(lt.id, upe.track_id) AS track_id,
                            COALESCE(lt.entity_uid::text, upe.track_entity_uid::text) AS track_entity_uid,
                            COALESCE(lt.path, upe.track_path) AS track_path,
                            COALESCE(lt.title, upe.title) AS title,
                            COALESCE(lt.artist, upe.artist) AS artist,
                            COALESCE(lt.album, upe.album) AS album,
                            art.id AS artist_id,
                            art.slug AS artist_slug,
                            COALESCE(alb_by_id.id, alb_by_name.id) AS album_id,
                            COALESCE(alb_by_id.slug, alb_by_name.slug) AS album_slug,
                            lt.bpm,
                            lt.audio_key,
                            lt.audio_scale,
                            lt.energy,
                            lt.danceability,
                            lt.valence,
                            lt.bliss_vector,
                            upe.was_completed,
                            upe.played_seconds,
                            upe.ended_at
                        FROM user_play_events upe
                        LEFT JOIN library_tracks lt
                          ON lt.id = upe.track_id
                          OR (
                            upe.track_id IS NULL
                            AND upe.track_entity_uid IS NOT NULL
                            AND lt.entity_uid = upe.track_entity_uid
                          )
                          OR (
                            upe.track_id IS NULL
                            AND COALESCE(upe.track_path, '') <> ''
                            AND lt.path = upe.track_path
                          )
                        LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, upe.artist)
                        LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
                        LEFT JOIN library_albums alb_by_name
                          ON alb_by_id.id IS NULL
                         AND alb_by_name.artist = COALESCE(lt.artist, upe.artist)
                         AND alb_by_name.name = COALESCE(lt.album, upe.album)
                        WHERE upe.user_id = :user_id
                          AND upe.ended_at >= CAST(:start AS TIMESTAMPTZ)
                          AND upe.ended_at < CAST(:end AS TIMESTAMPTZ)
                    )
                    SELECT
                        MAX(track_id) AS track_id,
                        MAX(track_entity_uid) AS track_entity_uid,
                        MAX(track_path) AS track_path,
                        MAX(title) AS title,
                        MAX(artist) AS artist,
                        MAX(album) AS album,
                        MAX(artist_id) AS artist_id,
                        MAX(artist_slug) AS artist_slug,
                        MAX(album_id) AS album_id,
                        MAX(album_slug) AS album_slug,
                        MAX(bpm) AS bpm,
                        MAX(audio_key) AS audio_key,
                        MAX(audio_scale) AS audio_scale,
                        MAX(energy) AS energy,
                        MAX(danceability) AS danceability,
                        MAX(valence) AS valence,
                        MAX(bliss_vector) AS bliss_vector,
                        COUNT(*)::integer AS play_count,
                        SUM(CASE WHEN was_completed THEN 1 ELSE 0 END)::integer AS complete_play_count,
                        COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened
                    FROM resolved
                    WHERE COALESCE(entity_key, '') <> ''
                    GROUP BY entity_key
                    ORDER BY play_count DESC, minutes_listened DESC, MAX(ended_at) DESC
                    LIMIT :limit
                    """
                ),
                {"user_id": user_id, "start": start, "end": end, "limit": limit},
            )
            .mappings()
            .all()
        )
    payload = [dict(row) for row in rows]
    for item in payload:
        if item.get("bliss_vector") is not None:
            item["bliss_vector"] = list(item["bliss_vector"])
    return payload


def get_month_top_artists(user_id: int, month: str, limit: int = 20) -> list[dict]:
    start, end = month_bounds(month)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        COALESCE(NULLIF(TRIM(upe.artist), ''), 'Unknown artist') AS artist_name,
                        la.id AS artist_id,
                        la.slug AS artist_slug,
                        COUNT(*)::integer AS play_count,
                        SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::integer AS complete_play_count,
                        COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened
                    FROM user_play_events upe
                    LEFT JOIN library_artists la ON lower(la.name) = lower(upe.artist)
                    WHERE upe.user_id = :user_id
                      AND upe.ended_at >= CAST(:start AS TIMESTAMPTZ)
                      AND upe.ended_at < CAST(:end AS TIMESTAMPTZ)
                      AND COALESCE(NULLIF(TRIM(upe.artist), ''), '') <> ''
                    GROUP BY 1, la.id, la.slug
                    ORDER BY play_count DESC, minutes_listened DESC, artist_name
                    LIMIT :limit
                    """
                ),
                {"user_id": user_id, "start": start, "end": end, "limit": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_month_top_albums(user_id: int, month: str, limit: int = 20) -> list[dict]:
    start, end = month_bounds(month)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        COALESCE(NULLIF(TRIM(upe.artist), ''), 'Unknown artist') AS artist,
                        art.id AS artist_id,
                        art.slug AS artist_slug,
                        COALESCE(NULLIF(TRIM(upe.album), ''), 'Unknown album') AS album,
                        alb.id AS album_id,
                        alb.slug AS album_slug,
                        COUNT(*)::integer AS play_count,
                        SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::integer AS complete_play_count,
                        COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened
                    FROM user_play_events upe
                    LEFT JOIN library_artists art ON lower(art.name) = lower(upe.artist)
                    LEFT JOIN library_albums alb
                      ON lower(alb.artist) = lower(upe.artist)
                     AND lower(alb.name) = lower(upe.album)
                    WHERE upe.user_id = :user_id
                      AND upe.ended_at >= CAST(:start AS TIMESTAMPTZ)
                      AND upe.ended_at < CAST(:end AS TIMESTAMPTZ)
                      AND COALESCE(NULLIF(TRIM(upe.album), ''), '') <> ''
                    GROUP BY 1, art.id, art.slug, 4, alb.id, alb.slug
                    ORDER BY play_count DESC, minutes_listened DESC, album
                    LIMIT :limit
                    """
                ),
                {"user_id": user_id, "start": start, "end": end, "limit": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_month_top_genres(user_id: int, month: str, limit: int = 20) -> list[dict]:
    start, end = month_bounds(month)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        lt.genre AS genre_name,
                        COUNT(*)::integer AS play_count,
                        SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::integer AS complete_play_count,
                        COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened
                    FROM user_play_events upe
                    LEFT JOIN library_tracks lt
                      ON lt.id = upe.track_id
                      OR (
                        upe.track_id IS NULL
                        AND upe.track_entity_uid IS NOT NULL
                        AND lt.entity_uid = upe.track_entity_uid
                      )
                      OR (
                        upe.track_id IS NULL
                        AND COALESCE(upe.track_path, '') <> ''
                        AND lt.path = upe.track_path
                      )
                    WHERE upe.user_id = :user_id
                      AND upe.ended_at >= CAST(:start AS TIMESTAMPTZ)
                      AND upe.ended_at < CAST(:end AS TIMESTAMPTZ)
                      AND COALESCE(NULLIF(TRIM(lt.genre), ''), '') <> ''
                    GROUP BY lt.genre
                    ORDER BY play_count DESC, minutes_listened DESC, genre_name
                    LIMIT :limit
                    """
                ),
                {"user_id": user_id, "start": start, "end": end, "limit": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_month_replay_mix(user_id: int, month: str, limit: int = 30) -> dict:
    items = get_month_top_tracks(user_id, month, limit=min(limit * 2, 100))
    artist_counts: dict[str, int] = {}
    selected: list[dict] = []
    for item in items:
        artist = str(item.get("artist") or "").lower()
        if artist_counts.get(artist, 0) >= 4:
            continue
        artist_counts[artist] = artist_counts.get(artist, 0) + 1
        selected.append(item)
        if len(selected) >= limit:
            break
    return {
        "window": month_period_key(month),
        "title": f"Replay {month_title(month)}",
        "subtitle": f"The tracks that defined {month_title(month)}.",
        "track_count": len(selected),
        "minutes_listened": sum(
            float(item.get("minutes_listened") or 0) for item in selected
        ),
        "items": selected,
    }


__all__ = [
    "get_month_replay_mix",
    "get_month_stats_overview",
    "get_month_stats_trends",
    "get_month_top_albums",
    "get_month_top_artists",
    "get_month_top_genres",
    "get_month_top_tracks",
    "month_bounds",
    "month_period_key",
    "month_title",
]
