"""Narrative stats (movers, discoveries, rhythm, monthly recaps).

Everything reads the per-day listening projections
(``user_track_daily``, ``user_hourly_listening``, ``user_daily_listening``,
``user_entity_firsts``) so building a story never rescans the raw play log.
"""

from __future__ import annotations

import json
from calendar import month_name
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import text

from crate.db.queries.user_stats_periods import (
    StatsPeriod,
    period_day_filter,
    period_params,
    resolve_stats_period,
    user_stats_timezone,
)
from crate.db.tx import read_scope

_ARTIST_JOIN = "LEFT JOIN library_artists la ON lower(la.name) = lower({column})"


def _artist_delta_rows(session, user_id: int, period: StatsPeriod, limit: int):
    previous = (
        "FALSE"
        if period.previous_start is None
        else "day >= :previous_start AND day < :period_start"
    )
    rows = session.execute(
        text(
            f"""
            WITH current_artists AS (
                SELECT artist AS artist_name,
                       SUM(play_count)::integer AS play_count,
                       SUM(minutes_listened) AS minutes_listened
                FROM user_track_daily
                WHERE user_id = :user_id AND artist != ''
                  AND {period_day_filter(period)}
                GROUP BY artist
            ),
            previous_artists AS (
                SELECT artist AS artist_name,
                       SUM(play_count)::integer AS play_count
                FROM user_track_daily
                WHERE user_id = :user_id AND artist != '' AND {previous}
                GROUP BY artist
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
            {_ARTIST_JOIN.format(column="c.artist_name")}
            ORDER BY
                (c.play_count - COALESCE(p.play_count, 0)) DESC,
                c.play_count DESC,
                c.minutes_listened DESC
            LIMIT :limit
            """
        ),
        {"user_id": user_id, "limit": limit, **period_params(period)},
    )
    return [dict(row) for row in rows.mappings()]


def _discovery_rows(session, user_id: int, period: StatsPeriod, limit: int):
    if period.start is None:
        return []
    rows = session.execute(
        text(
            f"""
            WITH discovered AS (
                SELECT entity_key AS artist_name, first_played_at
                FROM user_entity_firsts
                WHERE user_id = :user_id
                  AND entity_type = 'artist'
                  AND {period_day_filter(period, "first_day")}
            )
            SELECT
                d.artist_name,
                la.id AS artist_id,
                la.slug AS artist_slug,
                SUM(td.play_count)::integer AS play_count,
                SUM(td.minutes_listened) AS minutes_listened,
                d.first_played_at
            FROM discovered d
            JOIN user_track_daily td
              ON td.user_id = :user_id AND td.artist = d.artist_name
             AND {period_day_filter(period, "td.day")}
            {_ARTIST_JOIN.format(column="d.artist_name")}
            GROUP BY d.artist_name, la.id, la.slug, d.first_played_at
            ORDER BY play_count DESC, minutes_listened DESC
            LIMIT :limit
            """
        ),
        {"user_id": user_id, "limit": limit, **period_params(period)},
    )
    return [dict(row) for row in rows.mappings()]


def _comeback_rows(session, user_id: int, period: StatsPeriod, limit: int):
    if period.start is None:
        return []
    comeback_before = period.start - timedelta(days=max(30, period.days or 30))
    rows = session.execute(
        text(
            f"""
            WITH current_artists AS (
                SELECT artist AS artist_name,
                       SUM(play_count)::integer AS play_count,
                       SUM(minutes_listened) AS minutes_listened
                FROM user_track_daily
                WHERE user_id = :user_id AND artist != ''
                  AND {period_day_filter(period)}
                GROUP BY artist
            ),
            prior_artists AS (
                SELECT artist AS artist_name, MAX(last_played_at) AS last_seen_at,
                       MAX(day) AS last_seen_day
                FROM user_track_daily
                WHERE user_id = :user_id AND artist != '' AND day < :period_start
                GROUP BY artist
            )
            SELECT
                c.artist_name,
                la.id AS artist_id,
                la.slug AS artist_slug,
                c.play_count,
                c.minutes_listened,
                p.last_seen_at
            FROM current_artists c
            JOIN prior_artists p ON lower(p.artist_name) = lower(c.artist_name)
            {_ARTIST_JOIN.format(column="c.artist_name")}
            WHERE p.last_seen_day < :comeback_before
            ORDER BY c.play_count DESC, c.minutes_listened DESC, p.last_seen_at ASC
            LIMIT :limit
            """
        ),
        {
            "user_id": user_id,
            "limit": limit,
            "comeback_before": comeback_before,
            **period_params(period),
        },
    )
    return [dict(row) for row in rows.mappings()]


def _rhythm_payload(session, user_id: int, period: StatsPeriod) -> dict:
    params = {"user_id": user_id, **period_params(period)}
    hour_row = (
        session.execute(
            text(
                f"""
                SELECT hour::integer AS peak_hour,
                       SUM(play_count)::integer AS play_count,
                       SUM(minutes_listened) AS minutes_listened
                FROM user_hourly_listening
                WHERE user_id = :user_id AND {period_day_filter(period)}
                GROUP BY hour
                ORDER BY play_count DESC, minutes_listened DESC, hour
                LIMIT 1
                """
            ),
            params,
        )
        .mappings()
        .first()
    )
    weekday_row = (
        session.execute(
            text(
                f"""
                SELECT TRIM(TO_CHAR(day, 'Day')) AS peak_weekday,
                       SUM(play_count)::integer AS play_count,
                       SUM(minutes_listened) AS minutes_listened
                FROM user_daily_listening
                WHERE user_id = :user_id AND {period_day_filter(period)}
                GROUP BY 1
                ORDER BY play_count DESC, minutes_listened DESC, 1
                LIMIT 1
                """
            ),
            params,
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


def _audio_profile_payload(session, user_id: int, period: StatsPeriod) -> dict:
    row = (
        session.execute(
            text(
                f"""
                SELECT
                    SUM(lt.energy * td.play_count) / NULLIF(SUM(td.play_count) FILTER (WHERE lt.energy IS NOT NULL), 0) AS energy,
                    SUM(lt.danceability * td.play_count) / NULLIF(SUM(td.play_count) FILTER (WHERE lt.danceability IS NOT NULL), 0) AS danceability,
                    SUM(lt.valence * td.play_count) / NULLIF(SUM(td.play_count) FILTER (WHERE lt.valence IS NOT NULL), 0) AS valence,
                    SUM(lt.bpm * td.play_count) / NULLIF(SUM(td.play_count) FILTER (WHERE lt.bpm IS NOT NULL), 0) AS bpm
                FROM user_track_daily td
                JOIN library_tracks lt
                  ON lt.id = td.track_id
                  OR (td.track_id IS NULL AND td.track_entity_uid IS NOT NULL
                      AND lt.entity_uid = td.track_entity_uid)
                WHERE td.user_id = :user_id AND {period_day_filter(period, "td.day")}
                """
            ),
            {"user_id": user_id, **period_params(period)},
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


_COVER_COLUMNS_SQL = """
    COALESCE(lt.id, td.track_id) AS track_id,
    COALESCE(lt.entity_uid::text, td.track_entity_uid::text) AS track_entity_uid,
    COALESCE(lt.path, td.track_path) AS track_path,
    COALESCE(lt.title, td.title) AS title,
    COALESCE(lt.artist, NULLIF(td.artist, '')) AS artist,
    COALESCE(lt.album, NULLIF(td.album, '')) AS album,
    art.id AS artist_id,
    art.slug AS artist_slug,
    COALESCE(alb_by_id.id, alb_by_name.id) AS album_id,
    COALESCE(alb_by_id.slug, alb_by_name.slug) AS album_slug
"""
_COVER_JOINS_SQL = """
    LEFT JOIN library_tracks lt
      ON lt.id = td.track_id
      OR (td.track_id IS NULL AND td.track_entity_uid IS NOT NULL
          AND lt.entity_uid = td.track_entity_uid)
    LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, td.artist)
    LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
    LEFT JOIN library_albums alb_by_name
      ON alb_by_id.id IS NULL
     AND alb_by_name.artist = COALESCE(lt.artist, td.artist)
     AND alb_by_name.name = COALESCE(lt.album, td.album)
"""


def _all_time_snapshot(session, user_id: int) -> dict | None:
    totals = (
        session.execute(
            text(
                """
                SELECT SUM(play_count)::integer AS play_count,
                       COALESCE(SUM(minutes_listened), 0) AS minutes_listened,
                       COUNT(*)::integer AS active_days
                FROM user_daily_listening
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
    top_artists = [
        dict(row)
        for row in session.execute(
            text(
                """
                SELECT artist_name, play_count, minutes_listened
                FROM user_artist_stats
                WHERE user_id = :user_id AND stat_window = 'all_time'
                ORDER BY play_count DESC, minutes_listened DESC, artist_name
                LIMIT 4
                """
            ),
            {"user_id": user_id},
        ).mappings()
    ]
    covers = [
        dict(row)
        for row in session.execute(
            text(
                f"""
                WITH ranked AS (
                    SELECT entity_key, SUM(play_count)::integer AS play_count
                    FROM user_track_daily
                    WHERE user_id = :user_id AND entity_key != 'unknown-track'
                    GROUP BY entity_key
                    ORDER BY play_count DESC
                    LIMIT 4
                ),
                picked AS (
                    SELECT DISTINCT ON (r.entity_key) r.play_count AS total_plays, td.*
                    FROM ranked r
                    JOIN user_track_daily td
                      ON td.user_id = :user_id AND td.entity_key = r.entity_key
                    ORDER BY r.entity_key, td.day DESC
                )
                SELECT {_COVER_COLUMNS_SQL}, td.total_plays AS play_count
                FROM picked td
                {_COVER_JOINS_SQL}
                ORDER BY td.total_plays DESC
                """
            ),
            {"user_id": user_id},
        ).mappings()
    ]
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
        "covers": covers,
    }


def _monthly_snapshots(
    session, user_id: int, today: date, *, months: int = 8
) -> list[dict]:
    month_index = today.year * 12 + today.month - 1 - max(0, months - 1)
    start_month = date(month_index // 12, month_index % 12 + 1, 1)
    rows = session.execute(
        text(
            f"""
            WITH month_totals AS (
                SELECT date_trunc('month', day)::date AS month_start,
                       SUM(play_count)::integer AS play_count,
                       SUM(minutes_listened) AS minutes_listened,
                       COUNT(*)::integer AS active_days
                FROM user_daily_listening
                WHERE user_id = :user_id AND day >= :start_month
                GROUP BY 1
            ),
            artist_ranked AS (
                SELECT date_trunc('month', day)::date AS month_start,
                       artist AS artist_name,
                       SUM(play_count)::integer AS play_count,
                       SUM(minutes_listened) AS minutes_listened,
                       ROW_NUMBER() OVER (
                           PARTITION BY date_trunc('month', day)::date
                           ORDER BY SUM(play_count) DESC, SUM(minutes_listened) DESC, artist
                       ) AS rank
                FROM user_track_daily
                WHERE user_id = :user_id AND day >= :start_month AND artist != ''
                GROUP BY 1, 2
            ),
            artist_payload AS (
                SELECT month_start,
                       jsonb_agg(
                           jsonb_build_object(
                               'artist_name', artist_name,
                               'play_count', play_count,
                               'minutes_listened', minutes_listened
                           ) ORDER BY rank
                       ) FILTER (WHERE rank <= 4) AS top_artists
                FROM artist_ranked
                GROUP BY 1
            ),
            track_ranked AS (
                SELECT date_trunc('month', day)::date AS month_start,
                       entity_key,
                       MAX(track_id) AS track_id,
                       MAX(track_entity_uid::text)::uuid AS track_entity_uid,
                       MAX(track_path) AS track_path,
                       MAX(title) AS title,
                       MAX(artist) AS artist,
                       MAX(album) AS album,
                       ROW_NUMBER() OVER (
                           PARTITION BY date_trunc('month', day)::date
                           ORDER BY SUM(play_count) DESC, SUM(minutes_listened) DESC, MAX(last_played_at) DESC
                       ) AS rank
                FROM user_track_daily
                WHERE user_id = :user_id AND day >= :start_month
                GROUP BY 1, 2
            ),
            cover_payload AS (
                SELECT td.month_start,
                       jsonb_agg(
                           jsonb_build_object(
                               'track_id', COALESCE(lt.id, td.track_id),
                               'track_entity_uid', COALESCE(lt.entity_uid::text, td.track_entity_uid::text),
                               'track_path', COALESCE(lt.path, td.track_path),
                               'title', COALESCE(lt.title, td.title),
                               'artist', COALESCE(lt.artist, NULLIF(td.artist, '')),
                               'artist_id', art.id,
                               'artist_slug', art.slug,
                               'album', COALESCE(lt.album, NULLIF(td.album, '')),
                               'album_id', COALESCE(alb_by_id.id, alb_by_name.id),
                               'album_slug', COALESCE(alb_by_id.slug, alb_by_name.slug)
                           ) ORDER BY td.rank
                       ) AS covers
                FROM track_ranked td
                {_COVER_JOINS_SQL}
                WHERE td.rank <= 4
                GROUP BY td.month_start
            )
            SELECT mt.month_start,
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
    ).mappings()

    snapshots: list[dict] = []
    all_time = _all_time_snapshot(session, user_id)
    if all_time:
        snapshots.append(all_time)
    for row in rows:
        month_start = row["month_start"]
        if isinstance(month_start, datetime):
            month_start = month_start.date()
        top_artists = _json_payload(row["top_artists"])
        snapshots.append(
            {
                "period_kind": "month",
                "month_key": row["month_key"],
                "month_start": month_start.isoformat(),
                "title": _month_title(month_start),
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
    user_id: int,
    window: str = "30d",
    month: str | None = None,
    year: int | None = None,
) -> dict:
    with read_scope() as session:
        period = resolve_stats_period(
            user_stats_timezone(user_id, session=session),
            window=window,
            month=month,
            year=year,
        )
        return {
            "window": period.key,
            "movers": _artist_delta_rows(session, user_id, period, limit=5),
            "discoveries": _discovery_rows(session, user_id, period, limit=5),
            "comebacks": _comeback_rows(session, user_id, period, limit=5),
            "rhythm": _rhythm_payload(session, user_id, period),
            "audio_profile": _audio_profile_payload(session, user_id, period),
            "monthly_snapshots": _monthly_snapshots(session, user_id, period.today),
        }


__all__ = ["get_stats_story"]
