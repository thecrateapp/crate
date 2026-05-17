from __future__ import annotations

import json
from calendar import month_name
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from crate.db.queries.user_library_shared import _STATS_WINDOWS, normalize_stats_window
from crate.db.queries.user_library_stats_month import month_bounds, month_period_key
from crate.db.tx import read_scope


def _period_bounds(
    window: str, month: str | None
) -> tuple[str, date | None, date | None, datetime | None, datetime | None]:
    if month:
        start, end = month_bounds(month)
        return month_period_key(month), start.date(), end.date(), start, end

    normalized = normalize_stats_window(window)
    days = _STATS_WINDOWS[normalized]
    if days is None:
        return normalized, None, None, None, None

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    return normalized, start.date(), None, start, None


def _period_start(window: str) -> tuple[datetime | None, datetime | None]:
    normalized = normalize_stats_window(window)
    days = _STATS_WINDOWS[normalized]
    if days is None:
        return None, None
    current_start = datetime.now(timezone.utc) - timedelta(days=days)
    return current_start, current_start - timedelta(days=days)


def _json_payload(value: Any) -> list[dict]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return value if isinstance(value, list) else []


def _month_title(month_start: date) -> str:
    return f"{month_name[month_start.month]} {month_start.year}"


def _month_subtitle(top_artists: list[dict]) -> str:
    names = [
        str(item.get("artist_name", "")).strip()
        for item in top_artists[:3]
        if str(item.get("artist_name", "")).strip()
    ]
    if not names:
        return "A snapshot of the whole Crate instance."
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names)} and more"


def get_global_stats_overview(window: str = "30d", month: str | None = None) -> dict:
    period_key, start_day, end_day, start_ts, end_ts = _period_bounds(window, month)
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
                        COUNT(DISTINCT day)::INTEGER AS active_days
                    FROM user_daily_listening
                    WHERE (
                        CAST(:start_day AS DATE) IS NULL
                        OR day >= CAST(:start_day AS DATE)
                    )
                    AND (
                        CAST(:end_day AS DATE) IS NULL
                        OR day < CAST(:end_day AS DATE)
                    )
                    """
                ),
                {"start_day": start_day, "end_day": end_day},
            )
            .mappings()
            .first()
        )
        if month:
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
                        WHERE upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                          AND upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                          AND COALESCE(NULLIF(TRIM(upe.artist), ''), '') <> ''
                        GROUP BY 1, la.id, la.slug
                        ORDER BY play_count DESC, minutes_listened DESC, artist_name
                        LIMIT 1
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts},
                )
                .mappings()
                .first()
            )
        else:
            top_artist_row = (
                session.execute(
                    text(
                        """
                        SELECT
                            uas.artist_name,
                            la.id AS artist_id,
                            la.slug AS artist_slug,
                            SUM(uas.play_count)::integer AS play_count,
                            SUM(uas.minutes_listened) AS minutes_listened
                        FROM user_artist_stats uas
                        LEFT JOIN library_artists la ON lower(la.name) = lower(uas.artist_name)
                        WHERE uas.stat_window = :window
                        GROUP BY uas.artist_name, la.id, la.slug
                        ORDER BY play_count DESC, minutes_listened DESC, uas.artist_name
                        LIMIT 1
                        """
                    ),
                    {"window": normalize_stats_window(window)},
                )
                .mappings()
                .first()
            )

    overview = dict(overview_row or {})
    play_count = int(overview.get("play_count", 0) or 0)
    if play_count == 0:
        with read_scope() as session:
            fallback_overview = (
                session.execute(
                    text(
                        """
                        SELECT
                            COUNT(*)::integer AS play_count,
                            SUM(CASE WHEN was_completed THEN 1 ELSE 0 END)::integer AS complete_play_count,
                            SUM(CASE WHEN was_skipped THEN 1 ELSE 0 END)::integer AS skip_count,
                            COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened,
                            COUNT(DISTINCT ended_at::date)::integer AS active_days
                        FROM user_play_events
                        WHERE (
                            CAST(:start_ts AS TIMESTAMPTZ) IS NULL
                            OR ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                        )
                        AND (
                            CAST(:end_ts AS TIMESTAMPTZ) IS NULL
                            OR ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                        )
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts},
                )
                .mappings()
                .first()
            )
        overview = dict(fallback_overview or {})
        play_count = int(overview.get("play_count", 0) or 0)
    if top_artist_row is None and play_count > 0:
        with read_scope() as session:
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
                        WHERE (
                            CAST(:start_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                        )
                        AND (
                            CAST(:end_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                        )
                        AND COALESCE(NULLIF(TRIM(upe.artist), ''), '') <> ''
                        GROUP BY 1, la.id, la.slug
                        ORDER BY play_count DESC, minutes_listened DESC, artist_name
                        LIMIT 1
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts},
                )
                .mappings()
                .first()
            )
    skip_count = int(overview.get("skip_count", 0) or 0)
    return {
        "window": period_key,
        "play_count": play_count,
        "complete_play_count": int(overview.get("complete_play_count", 0) or 0),
        "skip_count": skip_count,
        "minutes_listened": float(overview.get("minutes_listened", 0) or 0),
        "active_days": int(overview.get("active_days", 0) or 0),
        "skip_rate": (skip_count / play_count) if play_count else 0,
        "top_artist": dict(top_artist_row) if top_artist_row else None,
    }


def get_global_stats_trends(window: str = "30d", month: str | None = None) -> dict:
    period_key, start_day, end_day, start_ts, end_ts = _period_bounds(window, month)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        day,
                        SUM(play_count)::integer AS play_count,
                        SUM(complete_play_count)::integer AS complete_play_count,
                        SUM(skip_count)::integer AS skip_count,
                        SUM(minutes_listened) AS minutes_listened
                    FROM user_daily_listening
                    WHERE (
                        CAST(:start_day AS DATE) IS NULL
                        OR day >= CAST(:start_day AS DATE)
                    )
                    AND (
                        CAST(:end_day AS DATE) IS NULL
                        OR day < CAST(:end_day AS DATE)
                    )
                    GROUP BY day
                    ORDER BY day ASC
                    """
                ),
                {"start_day": start_day, "end_day": end_day},
            )
            .mappings()
            .all()
        )
        if not rows:
            rows = (
                session.execute(
                    text(
                        """
                        SELECT
                            ended_at::date AS day,
                            COUNT(*)::integer AS play_count,
                            SUM(CASE WHEN was_completed THEN 1 ELSE 0 END)::integer AS complete_play_count,
                            SUM(CASE WHEN was_skipped THEN 1 ELSE 0 END)::integer AS skip_count,
                            COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened
                        FROM user_play_events
                        WHERE (
                            CAST(:start_ts AS TIMESTAMPTZ) IS NULL
                            OR ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                        )
                        AND (
                            CAST(:end_ts AS TIMESTAMPTZ) IS NULL
                            OR ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                        )
                        GROUP BY ended_at::date
                        ORDER BY day ASC
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts},
                )
                .mappings()
                .all()
            )
    return {"window": period_key, "points": [dict(row) for row in rows]}


def _global_top_tracks_from_events(
    start_ts: datetime | None, end_ts: datetime | None, *, limit: int
) -> list[dict]:
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
                        WHERE (
                            CAST(:start_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                        )
                        AND (
                            CAST(:end_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                        )
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
                {"start_ts": start_ts, "end_ts": end_ts, "limit": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_global_top_tracks(
    window: str = "30d", month: str | None = None, limit: int = 20
) -> list[dict]:
    period_key, _, _, start_ts, end_ts = _period_bounds(window, month)
    with read_scope() as session:
        if month:
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
                            WHERE upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                              AND upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
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
                    {"start_ts": start_ts, "end_ts": end_ts, "limit": limit},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        """
                        WITH resolved AS (
                            SELECT
                                COALESCE(lt.entity_uid::text, uts.track_entity_uid::text, lt.id::text, uts.track_id::text, NULLIF(uts.track_path, ''), CONCAT(uts.artist, '||', uts.title)) AS entity_key,
                                COALESCE(lt.id, uts.track_id) AS track_id,
                                COALESCE(lt.entity_uid::text, uts.track_entity_uid::text) AS track_entity_uid,
                                COALESCE(lt.path, uts.track_path) AS track_path,
                                COALESCE(lt.title, uts.title) AS title,
                                COALESCE(lt.artist, uts.artist) AS artist,
                                COALESCE(lt.album, uts.album) AS album,
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
                                uts.play_count,
                                uts.complete_play_count,
                                uts.minutes_listened,
                                uts.last_played_at
                            FROM user_track_stats uts
                            LEFT JOIN library_tracks lt
                              ON lt.id = uts.track_id
                              OR (
                                uts.track_id IS NULL
                                AND uts.track_entity_uid IS NOT NULL
                                AND lt.entity_uid = uts.track_entity_uid
                              )
                            LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, uts.artist)
                            LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
                            LEFT JOIN library_albums alb_by_name
                              ON alb_by_id.id IS NULL
                             AND alb_by_name.artist = COALESCE(lt.artist, uts.artist)
                             AND alb_by_name.name = COALESCE(lt.album, uts.album)
                            WHERE uts.stat_window = :window
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
                            SUM(play_count)::integer AS play_count,
                            SUM(complete_play_count)::integer AS complete_play_count,
                            SUM(minutes_listened) AS minutes_listened
                        FROM resolved
                        WHERE COALESCE(entity_key, '') <> ''
                        GROUP BY entity_key
                        ORDER BY play_count DESC, minutes_listened DESC, MAX(last_played_at) DESC
                        LIMIT :limit
                        """
                    ),
                    {
                        "window": period_key,
                        "limit": limit,
                    },
                )
                .mappings()
                .all()
            )

    if not rows:
        rows = _global_top_tracks_from_events(start_ts, end_ts, limit=limit)
    payload = [dict(row) for row in rows]
    for item in payload:
        if item.get("bliss_vector") is not None:
            item["bliss_vector"] = list(item["bliss_vector"])
    return payload


def get_global_top_artists(
    window: str = "30d", month: str | None = None, limit: int = 20
) -> list[dict]:
    period_key, _, _, start_ts, end_ts = _period_bounds(window, month)
    with read_scope() as session:
        if month:
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
                        WHERE upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                          AND upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                          AND COALESCE(NULLIF(TRIM(upe.artist), ''), '') <> ''
                        GROUP BY 1, la.id, la.slug
                        ORDER BY play_count DESC, minutes_listened DESC, artist_name
                        LIMIT :limit
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts, "limit": limit},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        """
                        SELECT
                            uas.artist_name,
                            la.id AS artist_id,
                            la.slug AS artist_slug,
                            SUM(uas.play_count)::integer AS play_count,
                            SUM(uas.complete_play_count)::integer AS complete_play_count,
                            SUM(uas.minutes_listened) AS minutes_listened
                        FROM user_artist_stats uas
                        LEFT JOIN library_artists la ON lower(la.name) = lower(uas.artist_name)
                        WHERE uas.stat_window = :window
                        GROUP BY uas.artist_name, la.id, la.slug
                        ORDER BY play_count DESC, minutes_listened DESC, uas.artist_name
                        LIMIT :limit
                        """
                    ),
                    {"window": period_key, "limit": limit},
                )
                .mappings()
                .all()
            )
        if not rows:
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
                        WHERE (
                            CAST(:start_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                        )
                        AND (
                            CAST(:end_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                        )
                        AND COALESCE(NULLIF(TRIM(upe.artist), ''), '') <> ''
                        GROUP BY 1, la.id, la.slug
                        ORDER BY play_count DESC, minutes_listened DESC, artist_name
                        LIMIT :limit
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts, "limit": limit},
                )
                .mappings()
                .all()
            )
    return [dict(row) for row in rows]


def get_global_top_albums(
    window: str = "30d", month: str | None = None, limit: int = 20
) -> list[dict]:
    period_key, _, _, start_ts, end_ts = _period_bounds(window, month)
    with read_scope() as session:
        if month:
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
                        WHERE upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                          AND upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                          AND COALESCE(NULLIF(TRIM(upe.album), ''), '') <> ''
                        GROUP BY 1, art.id, art.slug, 4, alb.id, alb.slug
                        ORDER BY play_count DESC, minutes_listened DESC, album
                        LIMIT :limit
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts, "limit": limit},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        """
                        SELECT
                            uas.artist,
                            art.id AS artist_id,
                            art.slug AS artist_slug,
                            uas.album,
                            alb.id AS album_id,
                            alb.slug AS album_slug,
                            SUM(uas.play_count)::integer AS play_count,
                            SUM(uas.complete_play_count)::integer AS complete_play_count,
                            SUM(uas.minutes_listened) AS minutes_listened
                        FROM user_album_stats uas
                        LEFT JOIN library_artists art ON lower(art.name) = lower(uas.artist)
                        LEFT JOIN library_albums alb
                          ON lower(alb.artist) = lower(uas.artist)
                         AND lower(alb.name) = lower(uas.album)
                        WHERE uas.stat_window = :window
                        GROUP BY uas.artist, art.id, art.slug, uas.album, alb.id, alb.slug
                        ORDER BY play_count DESC, minutes_listened DESC, uas.album
                        LIMIT :limit
                        """
                    ),
                    {"window": period_key, "limit": limit},
                )
                .mappings()
                .all()
            )
        if not rows:
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
                        WHERE (
                            CAST(:start_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                        )
                        AND (
                            CAST(:end_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                        )
                        AND COALESCE(NULLIF(TRIM(upe.album), ''), '') <> ''
                        GROUP BY 1, art.id, art.slug, 4, alb.id, alb.slug
                        ORDER BY play_count DESC, minutes_listened DESC, album
                        LIMIT :limit
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts, "limit": limit},
                )
                .mappings()
                .all()
            )
    return [dict(row) for row in rows]


def get_global_top_genres(
    window: str = "30d", month: str | None = None, limit: int = 20
) -> list[dict]:
    period_key, _, _, start_ts, end_ts = _period_bounds(window, month)
    with read_scope() as session:
        if month:
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
                        WHERE upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                          AND upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                          AND COALESCE(NULLIF(TRIM(lt.genre), ''), '') <> ''
                        GROUP BY lt.genre
                        ORDER BY play_count DESC, minutes_listened DESC, genre_name
                        LIMIT :limit
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts, "limit": limit},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        """
                        SELECT
                            genre_name,
                            SUM(play_count)::integer AS play_count,
                            SUM(complete_play_count)::integer AS complete_play_count,
                            SUM(minutes_listened) AS minutes_listened
                        FROM user_genre_stats
                        WHERE stat_window = :window
                        GROUP BY genre_name
                        ORDER BY play_count DESC, minutes_listened DESC, genre_name
                        LIMIT :limit
                        """
                    ),
                    {"window": period_key, "limit": limit},
                )
                .mappings()
                .all()
            )
        if not rows:
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
                        WHERE (
                            CAST(:start_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at >= CAST(:start_ts AS TIMESTAMPTZ)
                        )
                        AND (
                            CAST(:end_ts AS TIMESTAMPTZ) IS NULL
                            OR upe.ended_at < CAST(:end_ts AS TIMESTAMPTZ)
                        )
                        AND COALESCE(NULLIF(TRIM(lt.genre), ''), '') <> ''
                        GROUP BY lt.genre
                        ORDER BY play_count DESC, minutes_listened DESC, genre_name
                        LIMIT :limit
                        """
                    ),
                    {"start_ts": start_ts, "end_ts": end_ts, "limit": limit},
                )
                .mappings()
                .all()
            )
    return [dict(row) for row in rows]


def get_global_replay_mix(
    window: str = "30d", month: str | None = None, limit: int = 30
) -> dict:
    items = get_global_top_tracks(window=window, month=month, limit=min(limit * 2, 100))
    period_key = month_period_key(month) if month else normalize_stats_window(window)
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

    if month:
        title = f"Crate Replay {_month_title(month_bounds(month)[0].date())}"
        subtitle = "The tracks defining the whole instance this month."
    elif period_key == "all_time":
        title = "Crate all-time replay"
        subtitle = "The enduring signal across every listener."
    else:
        title = "Crate replay"
        subtitle = "The tracks currently shaping the instance."

    return {
        "window": period_key,
        "title": title,
        "subtitle": subtitle,
        "track_count": len(selected),
        "minutes_listened": sum(
            float(item.get("minutes_listened") or 0) for item in selected
        ),
        "items": selected,
    }


def _artist_delta_rows(
    *,
    current_start: datetime | None,
    previous_start: datetime | None,
    current_end: datetime | None = None,
    limit: int,
) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    WITH current_artists AS (
                        SELECT
                            COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS artist_name,
                            COUNT(*)::integer AS play_count,
                            COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened
                        FROM user_play_events
                        WHERE (
                            CAST(:current_start AS TIMESTAMPTZ) IS NULL
                            OR ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                        )
                        AND (
                            CAST(:current_end AS TIMESTAMPTZ) IS NULL
                            OR ended_at < CAST(:current_end AS TIMESTAMPTZ)
                        )
                        GROUP BY 1
                    ),
                    previous_artists AS (
                        SELECT
                            COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS artist_name,
                            COUNT(*)::integer AS play_count
                        FROM user_play_events
                        WHERE CAST(:previous_start AS TIMESTAMPTZ) IS NOT NULL
                          AND ended_at >= CAST(:previous_start AS TIMESTAMPTZ)
                          AND ended_at < CAST(:current_start AS TIMESTAMPTZ)
                        GROUP BY 1
                    )
                    SELECT
                        c.artist_name,
                        la.id AS artist_id,
                        la.slug AS artist_slug,
                        c.play_count,
                        COALESCE(p.play_count, 0)::integer AS previous_play_count,
                        (c.play_count - COALESCE(p.play_count, 0))::integer AS delta_play_count,
                        c.minutes_listened
                    FROM current_artists c
                    LEFT JOIN previous_artists p ON lower(p.artist_name) = lower(c.artist_name)
                    LEFT JOIN library_artists la ON lower(la.name) = lower(c.artist_name)
                    WHERE c.artist_name <> 'Unknown artist'
                    ORDER BY delta_play_count DESC, c.play_count DESC, c.minutes_listened DESC
                    LIMIT :limit
                    """
                ),
                {
                    "current_start": current_start,
                    "current_end": current_end,
                    "previous_start": previous_start,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def _rhythm_payload(
    *, current_start: datetime | None, current_end: datetime | None = None
) -> dict:
    with read_scope() as session:
        hour_row = (
            session.execute(
                text(
                    """
                    SELECT
                        EXTRACT(HOUR FROM ended_at)::integer AS peak_hour,
                        COUNT(*)::integer AS play_count
                    FROM user_play_events
                    WHERE (
                        CAST(:current_start AS TIMESTAMPTZ) IS NULL
                        OR ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                    )
                    AND (
                        CAST(:current_end AS TIMESTAMPTZ) IS NULL
                        OR ended_at < CAST(:current_end AS TIMESTAMPTZ)
                    )
                    GROUP BY 1
                    ORDER BY play_count DESC
                    LIMIT 1
                    """
                ),
                {"current_start": current_start, "current_end": current_end},
            )
            .mappings()
            .first()
        )
        weekday_row = (
            session.execute(
                text(
                    """
                    SELECT
                        TRIM(TO_CHAR(ended_at, 'Day')) AS peak_weekday,
                        COUNT(*)::integer AS play_count
                    FROM user_play_events
                    WHERE (
                        CAST(:current_start AS TIMESTAMPTZ) IS NULL
                        OR ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                    )
                    AND (
                        CAST(:current_end AS TIMESTAMPTZ) IS NULL
                        OR ended_at < CAST(:current_end AS TIMESTAMPTZ)
                    )
                    GROUP BY 1
                    ORDER BY play_count DESC
                    LIMIT 1
                    """
                ),
                {"current_start": current_start, "current_end": current_end},
            )
            .mappings()
            .first()
        )
    peak_hour = int(hour_row["peak_hour"]) if hour_row else None
    return {
        "peak_hour": peak_hour,
        "peak_hour_label": f"{peak_hour:02d}:00" if peak_hour is not None else None,
        "peak_weekday": weekday_row["peak_weekday"] if weekday_row else None,
        "peak_hour_play_count": int(hour_row["play_count"]) if hour_row else 0,
        "peak_weekday_play_count": int(weekday_row["play_count"]) if weekday_row else 0,
    }


def _audio_profile_payload(
    *, current_start: datetime | None, current_end: datetime | None = None
) -> dict:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        AVG(lt.energy) AS energy,
                        AVG(lt.danceability) AS danceability,
                        AVG(lt.valence) AS valence,
                        AVG(lt.bpm) AS bpm
                    FROM user_play_events upe
                    LEFT JOIN library_tracks lt
                      ON lt.id = upe.track_id
                      OR (
                        upe.track_id IS NULL
                        AND upe.track_entity_uid IS NOT NULL
                        AND lt.entity_uid = upe.track_entity_uid
                      )
                    WHERE (
                        CAST(:current_start AS TIMESTAMPTZ) IS NULL
                        OR upe.ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                    )
                    AND (
                        CAST(:current_end AS TIMESTAMPTZ) IS NULL
                        OR upe.ended_at < CAST(:current_end AS TIMESTAMPTZ)
                    )
                    """
                ),
                {"current_start": current_start, "current_end": current_end},
            )
            .mappings()
            .first()
        )
    return {
        "energy": float(row["energy"] or 0) if row else 0,
        "danceability": float(row["danceability"] or 0) if row else 0,
        "valence": float(row["valence"] or 0) if row else 0,
        "bpm": round(float(row["bpm"]), 1) if row and row["bpm"] is not None else None,
    }


def _all_time_snapshot() -> dict | None:
    with read_scope() as session:
        totals = (
            session.execute(
                text(
                    """
                    SELECT
                        COUNT(*)::integer AS play_count,
                        COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened,
                        COUNT(DISTINCT ended_at::date)::integer AS active_days
                    FROM user_play_events
                    """
                )
            )
            .mappings()
            .first()
        )
        if not totals or int(totals["play_count"] or 0) <= 0:
            return None
        top_artists_rows = (
            session.execute(
                text(
                    """
                    SELECT
                        COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS artist_name,
                        COUNT(*)::integer AS play_count,
                        COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened
                    FROM user_play_events
                    WHERE COALESCE(NULLIF(TRIM(artist), ''), '') <> ''
                    GROUP BY 1
                    ORDER BY play_count DESC, minutes_listened DESC, artist_name
                    LIMIT 4
                    """
                )
            )
            .mappings()
            .all()
        )
        cover_rows = get_global_top_tracks(window="all_time", limit=4)

    top_artists = [dict(row) for row in top_artists_rows]
    return {
        "period_kind": "all_time",
        "month_key": "all_time",
        "month_start": "all_time",
        "title": "Crate Most Listened",
        "subtitle": _month_subtitle(top_artists),
        "play_count": int(totals["play_count"] or 0),
        "minutes_listened": float(totals["minutes_listened"] or 0),
        "active_days": int(totals["active_days"] or 0),
        "top_artists": top_artists,
        "covers": cover_rows,
    }


def _monthly_snapshots(months: int = 8) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    start_month = date(today.year, today.month, 1)
    month = start_month.month - max(0, months - 1)
    year = start_month.year
    while month <= 0:
        month += 12
        year -= 1
    start_month = date(year, month, 1)

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    WITH filtered AS (
                        SELECT
                            date_trunc('month', upe.ended_at)::date AS month_start,
                            upe.ended_at,
                            upe.track_id,
                            upe.track_entity_uid,
                            upe.track_path,
                            COALESCE(NULLIF(TRIM(upe.title), ''), 'Unknown track') AS title,
                            COALESCE(NULLIF(TRIM(upe.artist), ''), 'Unknown artist') AS artist_name,
                            COALESCE(NULLIF(TRIM(upe.album), ''), 'Unknown album') AS album_name,
                            upe.played_seconds
                        FROM user_play_events upe
                        WHERE upe.ended_at >= CAST(:start_month AS TIMESTAMPTZ)
                    ),
                    month_totals AS (
                        SELECT
                            month_start,
                            COUNT(*)::integer AS play_count,
                            COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened,
                            COUNT(DISTINCT ended_at::date)::integer AS active_days
                        FROM filtered
                        GROUP BY 1
                    ),
                    artist_ranked AS (
                        SELECT
                            month_start,
                            artist_name,
                            COUNT(*)::integer AS play_count,
                            COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened,
                            ROW_NUMBER() OVER (
                                PARTITION BY month_start
                                ORDER BY COUNT(*) DESC, COALESCE(SUM(played_seconds), 0) DESC, artist_name
                            ) AS rank
                        FROM filtered
                        WHERE artist_name <> 'Unknown artist'
                        GROUP BY 1, 2
                    ),
                    artist_payload AS (
                        SELECT
                            month_start,
                            jsonb_agg(
                                jsonb_build_object(
                                    'artist_name', artist_name,
                                    'play_count', play_count,
                                    'minutes_listened', minutes_listened
                                )
                                ORDER BY rank
                            ) FILTER (WHERE rank <= 4) AS top_artists
                        FROM artist_ranked
                        GROUP BY 1
                    )
                    SELECT
                        mt.month_start,
                        to_char(mt.month_start, 'YYYY-MM') AS month_key,
                        mt.play_count,
                        mt.minutes_listened,
                        mt.active_days,
                        COALESCE(ap.top_artists, '[]'::jsonb) AS top_artists
                    FROM month_totals mt
                    LEFT JOIN artist_payload ap ON ap.month_start = mt.month_start
                    ORDER BY mt.month_start DESC
                    LIMIT :months
                    """
                ),
                {"start_month": start_month, "months": months},
            )
            .mappings()
            .all()
        )

    snapshots: list[dict] = []
    all_time = _all_time_snapshot()
    if all_time:
        snapshots.append(all_time)
    for row in rows:
        month_start = row["month_start"]
        if isinstance(month_start, datetime):
            month_start_date = month_start.date()
        elif isinstance(month_start, date):
            month_start_date = month_start
        else:
            month_start_date = datetime.fromisoformat(str(month_start)).date()
        top_artists = _json_payload(row["top_artists"])
        month_key = str(row["month_key"])
        snapshots.append(
            {
                "period_kind": "month",
                "month_key": month_key,
                "month_start": month_start_date.isoformat(),
                "title": _month_title(month_start_date),
                "subtitle": _month_subtitle(top_artists),
                "play_count": int(row["play_count"] or 0),
                "minutes_listened": float(row["minutes_listened"] or 0),
                "active_days": int(row["active_days"] or 0),
                "top_artists": top_artists,
                "covers": get_global_top_tracks(month=month_key, limit=4),
            }
        )
    return snapshots


def get_global_stats_story(window: str = "30d", month: str | None = None) -> dict:
    if month:
        current_start, current_end = month_bounds(month)
        previous_month = current_start.month - 1
        previous_year = current_start.year
        if previous_month <= 0:
            previous_month = 12
            previous_year -= 1
        previous_start = datetime(previous_year, previous_month, 1, tzinfo=timezone.utc)
        normalized = month_period_key(month)
    else:
        normalized = normalize_stats_window(window)
        current_start, previous_start = _period_start(normalized)
        current_end = None

    return {
        "window": normalized,
        "movers": _artist_delta_rows(
            current_start=current_start,
            previous_start=previous_start,
            current_end=current_end,
            limit=5,
        ),
        "discoveries": [],
        "comebacks": [],
        "rhythm": _rhythm_payload(
            current_start=current_start,
            current_end=current_end,
        ),
        "audio_profile": _audio_profile_payload(
            current_start=current_start,
            current_end=current_end,
        ),
        "monthly_snapshots": _monthly_snapshots(),
    }


__all__ = [
    "get_global_replay_mix",
    "get_global_stats_overview",
    "get_global_stats_story",
    "get_global_stats_trends",
    "get_global_top_albums",
    "get_global_top_artists",
    "get_global_top_genres",
    "get_global_top_tracks",
]
