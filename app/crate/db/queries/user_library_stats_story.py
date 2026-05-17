from __future__ import annotations

import json
from calendar import month_name
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from crate.db.queries.user_library_stats_month import month_bounds, month_period_key
from crate.db.queries.user_library_shared import _STATS_WINDOWS, normalize_stats_window
from crate.db.tx import read_scope


def _period_bounds(window: str) -> tuple[datetime | None, datetime | None]:
    normalized = normalize_stats_window(window)
    days = _STATS_WINDOWS[normalized]
    if days is None:
        return None, None
    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=days)
    previous_start = current_start - timedelta(days=days)
    return current_start, previous_start


def _artist_delta_rows(
    user_id: int,
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
                        WHERE user_id = :user_id
                          AND (
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
                        WHERE user_id = :user_id
                          AND CAST(:previous_start AS TIMESTAMPTZ) IS NOT NULL
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
                    LEFT JOIN previous_artists p
                      ON lower(p.artist_name) = lower(c.artist_name)
                    LEFT JOIN library_artists la
                      ON lower(la.name) = lower(c.artist_name)
                    WHERE c.artist_name <> 'Unknown artist'
                    ORDER BY
                        (c.play_count - COALESCE(p.play_count, 0)) DESC,
                        c.play_count DESC,
                        c.minutes_listened DESC
                    LIMIT :limit
                    """
                ),
                {
                    "user_id": user_id,
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


def _discovery_rows(
    user_id: int,
    *,
    current_start: datetime | None,
    current_end: datetime | None = None,
    limit: int,
) -> list[dict]:
    if current_start is None:
        return []
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    WITH current_artists AS (
                        SELECT
                            COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS artist_name,
                            COUNT(*)::integer AS play_count,
                            COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened,
                            MIN(ended_at) AS first_played_at
                        FROM user_play_events
                        WHERE user_id = :user_id
                          AND ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                          AND (
                            CAST(:current_end AS TIMESTAMPTZ) IS NULL
                            OR ended_at < CAST(:current_end AS TIMESTAMPTZ)
                          )
                        GROUP BY 1
                    )
                    SELECT
                        c.artist_name,
                        la.id AS artist_id,
                        la.slug AS artist_slug,
                        c.play_count,
                        c.minutes_listened,
                        c.first_played_at
                    FROM current_artists c
                    LEFT JOIN library_artists la
                      ON lower(la.name) = lower(c.artist_name)
                    WHERE c.artist_name <> 'Unknown artist'
                      AND NOT EXISTS (
                        SELECT 1
                        FROM user_play_events prior
                        WHERE prior.user_id = :user_id
                          AND lower(prior.artist) = lower(c.artist_name)
                          AND prior.ended_at < CAST(:current_start AS TIMESTAMPTZ)
                        LIMIT 1
                      )
                    ORDER BY c.play_count DESC, c.minutes_listened DESC
                    LIMIT :limit
                    """
                ),
                {
                    "user_id": user_id,
                    "current_start": current_start,
                    "current_end": current_end,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def _comeback_rows(
    user_id: int,
    *,
    current_start: datetime | None,
    comeback_before: datetime | None,
    current_end: datetime | None = None,
    limit: int,
) -> list[dict]:
    if current_start is None or comeback_before is None:
        return []
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
                        WHERE user_id = :user_id
                          AND ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                          AND (
                            CAST(:current_end AS TIMESTAMPTZ) IS NULL
                            OR ended_at < CAST(:current_end AS TIMESTAMPTZ)
                          )
                        GROUP BY 1
                    ),
                    prior_artists AS (
                        SELECT
                            COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS artist_name,
                            MAX(ended_at) AS last_seen_at
                        FROM user_play_events
                        WHERE user_id = :user_id
                          AND ended_at < CAST(:current_start AS TIMESTAMPTZ)
                        GROUP BY 1
                    )
                    SELECT
                        c.artist_name,
                        la.id AS artist_id,
                        la.slug AS artist_slug,
                        c.play_count,
                        c.minutes_listened,
                        p.last_seen_at
                    FROM current_artists c
                    JOIN prior_artists p
                      ON lower(p.artist_name) = lower(c.artist_name)
                    LEFT JOIN library_artists la
                      ON lower(la.name) = lower(c.artist_name)
                    WHERE c.artist_name <> 'Unknown artist'
                      AND p.last_seen_at < CAST(:comeback_before AS TIMESTAMPTZ)
                    ORDER BY c.play_count DESC, c.minutes_listened DESC, p.last_seen_at ASC
                    LIMIT :limit
                    """
                ),
                {
                    "user_id": user_id,
                    "current_start": current_start,
                    "current_end": current_end,
                    "comeback_before": comeback_before,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def _rhythm_payload(
    user_id: int,
    *,
    current_start: datetime | None,
    current_end: datetime | None = None,
) -> dict:
    with read_scope() as session:
        hour_row = (
            session.execute(
                text(
                    """
                    SELECT
                        EXTRACT(HOUR FROM ended_at)::integer AS peak_hour,
                        COUNT(*)::integer AS play_count,
                        COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened
                    FROM user_play_events
                    WHERE user_id = :user_id
                      AND (
                        CAST(:current_start AS TIMESTAMPTZ) IS NULL
                        OR ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                      )
                      AND (
                        CAST(:current_end AS TIMESTAMPTZ) IS NULL
                        OR ended_at < CAST(:current_end AS TIMESTAMPTZ)
                      )
                    GROUP BY 1
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 1
                    """
                ),
                {
                    "user_id": user_id,
                    "current_start": current_start,
                    "current_end": current_end,
                },
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
                        COUNT(*)::integer AS play_count,
                        COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened
                    FROM user_play_events
                    WHERE user_id = :user_id
                      AND (
                        CAST(:current_start AS TIMESTAMPTZ) IS NULL
                        OR ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                      )
                      AND (
                        CAST(:current_end AS TIMESTAMPTZ) IS NULL
                        OR ended_at < CAST(:current_end AS TIMESTAMPTZ)
                      )
                    GROUP BY 1
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 1
                    """
                ),
                {
                    "user_id": user_id,
                    "current_start": current_start,
                    "current_end": current_end,
                },
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
    user_id: int,
    *,
    current_start: datetime | None,
    current_end: datetime | None = None,
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
                    WHERE upe.user_id = :user_id
                      AND (
                        CAST(:current_start AS TIMESTAMPTZ) IS NULL
                        OR upe.ended_at >= CAST(:current_start AS TIMESTAMPTZ)
                      )
                      AND (
                        CAST(:current_end AS TIMESTAMPTZ) IS NULL
                        OR upe.ended_at < CAST(:current_end AS TIMESTAMPTZ)
                      )
                    """
                ),
                {
                    "user_id": user_id,
                    "current_start": current_start,
                    "current_end": current_end,
                },
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


def _month_start(months_back: int) -> datetime:
    now = datetime.now(timezone.utc)
    month = now.month - months_back
    year = now.year
    while month <= 0:
        month += 12
        year -= 1
    return datetime(year, month, 1, tzinfo=timezone.utc)


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
        return "A monthly snapshot of your listening."
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names)} and more"


def _all_time_snapshot(user_id: int) -> dict | None:
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
                    WHERE user_id = :user_id
                    """
                ),
                {"user_id": user_id},
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
                    WHERE user_id = :user_id
                      AND COALESCE(NULLIF(TRIM(artist), ''), '') <> ''
                    GROUP BY 1
                    ORDER BY play_count DESC, minutes_listened DESC, artist_name
                    LIMIT 4
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
        cover_rows = (
            session.execute(
                text(
                    """
                    WITH ranked AS (
                        SELECT
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
                            COUNT(*)::integer AS play_count
                        FROM user_play_events upe
                        LEFT JOIN library_tracks lt
                          ON lt.id = upe.track_id
                          OR (
                            upe.track_id IS NULL
                            AND upe.track_entity_uid IS NOT NULL
                            AND lt.entity_uid = upe.track_entity_uid
                          )
                        LEFT JOIN library_artists art
                          ON art.name = COALESCE(lt.artist, upe.artist)
                        LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
                        LEFT JOIN library_albums alb_by_name
                          ON alb_by_id.id IS NULL
                         AND alb_by_name.artist = COALESCE(lt.artist, upe.artist)
                         AND alb_by_name.name = COALESCE(lt.album, upe.album)
                        WHERE upe.user_id = :user_id
                        GROUP BY
                            COALESCE(lt.id, upe.track_id),
                            COALESCE(lt.entity_uid::text, upe.track_entity_uid::text),
                            COALESCE(lt.path, upe.track_path),
                            COALESCE(lt.title, upe.title),
                            COALESCE(lt.artist, upe.artist),
                            COALESCE(lt.album, upe.album),
                            art.id,
                            art.slug,
                            COALESCE(alb_by_id.id, alb_by_name.id),
                            COALESCE(alb_by_id.slug, alb_by_name.slug)
                    )
                    SELECT *
                    FROM ranked
                    ORDER BY play_count DESC
                    LIMIT 4
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )

    top_artists = [dict(row) for row in top_artists_rows]
    return {
        "period_kind": "all_time",
        "month_key": "all_time",
        "month_start": "all_time",
        "title": "My Most Listened",
        "subtitle": _month_subtitle(top_artists),
        "play_count": int(totals["play_count"] or 0),
        "minutes_listened": float(totals["minutes_listened"] or 0),
        "active_days": int(totals["active_days"] or 0),
        "top_artists": top_artists,
        "covers": [dict(row) for row in cover_rows],
    }


def _monthly_snapshots(user_id: int, *, months: int = 8) -> list[dict]:
    start_month = _month_start(max(0, months - 1))
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
                        WHERE upe.user_id = :user_id
                          AND upe.ended_at >= CAST(:start_month AS TIMESTAMPTZ)
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
                    ),
                    cover_ranked AS (
                        SELECT
                            f.month_start,
                            COALESCE(lt.id, f.track_id) AS track_id,
                            COALESCE(lt.entity_uid::text, f.track_entity_uid::text) AS track_entity_uid,
                            COALESCE(lt.path, f.track_path) AS track_path,
                            COALESCE(lt.title, f.title) AS title,
                            COALESCE(lt.artist, f.artist_name) AS artist,
                            COALESCE(lt.album, f.album_name) AS album,
                            art.id AS artist_id,
                            art.slug AS artist_slug,
                            COALESCE(alb_by_id.id, alb_by_name.id) AS album_id,
                            COALESCE(alb_by_id.slug, alb_by_name.slug) AS album_slug,
                            COUNT(*)::integer AS play_count,
                            ROW_NUMBER() OVER (
                                PARTITION BY f.month_start
                                ORDER BY COUNT(*) DESC, COALESCE(SUM(f.played_seconds), 0) DESC, MAX(f.ended_at) DESC
                            ) AS rank
                        FROM filtered f
                        LEFT JOIN library_tracks lt
                          ON lt.id = f.track_id
                          OR (
                            f.track_id IS NULL
                            AND f.track_entity_uid IS NOT NULL
                            AND lt.entity_uid = f.track_entity_uid
                          )
                        LEFT JOIN library_artists art
                          ON art.name = COALESCE(lt.artist, f.artist_name)
                        LEFT JOIN library_albums alb_by_id
                          ON alb_by_id.id = lt.album_id
                        LEFT JOIN library_albums alb_by_name
                          ON alb_by_id.id IS NULL
                         AND alb_by_name.artist = COALESCE(lt.artist, f.artist_name)
                         AND alb_by_name.name = COALESCE(lt.album, f.album_name)
                        GROUP BY
                            f.month_start,
                            COALESCE(lt.id, f.track_id),
                            COALESCE(lt.entity_uid::text, f.track_entity_uid::text),
                            COALESCE(lt.path, f.track_path),
                            COALESCE(lt.title, f.title),
                            COALESCE(lt.artist, f.artist_name),
                            COALESCE(lt.album, f.album_name),
                            art.id,
                            art.slug,
                            COALESCE(alb_by_id.id, alb_by_name.id),
                            COALESCE(alb_by_id.slug, alb_by_name.slug)
                    ),
                    cover_payload AS (
                        SELECT
                            month_start,
                            jsonb_agg(
                                jsonb_build_object(
                                    'track_id', track_id,
                                    'track_entity_uid', track_entity_uid,
                                    'track_path', track_path,
                                    'title', title,
                                    'artist', artist,
                                    'artist_id', artist_id,
                                    'artist_slug', artist_slug,
                                    'album', album,
                                    'album_id', album_id,
                                    'album_slug', album_slug
                                )
                                ORDER BY rank
                            ) FILTER (WHERE rank <= 4) AS covers
                        FROM cover_ranked
                        GROUP BY 1
                    )
                    SELECT
                        mt.month_start,
                        to_char(mt.month_start, 'YYYY-MM') AS month_key,
                        mt.play_count,
                        mt.minutes_listened,
                        mt.active_days,
                        COALESCE(ap.top_artists, '[]'::jsonb) AS top_artists,
                        COALESCE(cp.covers, '[]'::jsonb) AS covers
                    FROM month_totals mt
                    LEFT JOIN artist_payload ap ON ap.month_start = mt.month_start
                    LEFT JOIN cover_payload cp ON cp.month_start = mt.month_start
                    ORDER BY mt.month_start DESC
                    LIMIT :months
                    """
                ),
                {"user_id": user_id, "start_month": start_month, "months": months},
            )
            .mappings()
            .all()
        )

    snapshots: list[dict] = []
    all_time = _all_time_snapshot(user_id)
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
        snapshots.append(
            {
                "period_kind": "month",
                "month_key": row["month_key"],
                "month_start": month_start_date.isoformat(),
                "title": _month_title(month_start_date),
                "subtitle": _month_subtitle(top_artists),
                "play_count": int(row["play_count"] or 0),
                "minutes_listened": float(row["minutes_listened"] or 0),
                "active_days": int(row["active_days"] or 0),
                "top_artists": top_artists,
                "covers": _json_payload(row["covers"]),
            }
        )
    return snapshots


def get_stats_story(
    user_id: int, window: str = "30d", month: str | None = None
) -> dict:
    if month:
        current_start, current_end = month_bounds(month)
        previous_month = current_start.month - 1
        previous_year = current_start.year
        if previous_month <= 0:
            previous_month = 12
            previous_year -= 1
        previous_start = datetime(previous_year, previous_month, 1, tzinfo=timezone.utc)
        normalized = month_period_key(month)
        days = (current_end - current_start).days
    else:
        normalized = normalize_stats_window(window)
        current_start, previous_start = _period_bounds(normalized)
        current_end = None
        days = _STATS_WINDOWS[normalized]
    comeback_before = (
        current_start - timedelta(days=max(30, days or 30)) if current_start else None
    )
    return {
        "window": normalized,
        "movers": _artist_delta_rows(
            user_id,
            current_start=current_start,
            previous_start=previous_start,
            current_end=current_end,
            limit=5,
        ),
        "discoveries": _discovery_rows(
            user_id,
            current_start=current_start,
            current_end=current_end,
            limit=5,
        ),
        "comebacks": _comeback_rows(
            user_id,
            current_start=current_start,
            comeback_before=comeback_before,
            current_end=current_end,
            limit=5,
        ),
        "rhythm": _rhythm_payload(
            user_id, current_start=current_start, current_end=current_end
        ),
        "audio_profile": _audio_profile_payload(
            user_id, current_start=current_start, current_end=current_end
        ),
        "monthly_snapshots": _monthly_snapshots(user_id),
    }


__all__ = ["get_stats_story"]
