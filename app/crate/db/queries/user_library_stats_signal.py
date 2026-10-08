"""Signal sections of the stats dashboard (tape, highlights, heatmap, ...).

Built by the dashboard snapshot job from the per-day listening projections;
every query is bounded by ``(user_id, day)``.
"""

from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import text

from crate.db.queries.user_library_stats_genres import (
    format_weighted_genre_rows,
    weighted_genre_split_sql,
)
from crate.db.queries.user_stats_periods import (
    StatsPeriod,
    period_day_filter,
    period_params,
)

METRICS_VERSION = "listening-v1"
_NIGHT_HOURS = (22, 23, 0, 1, 2, 3, 4, 5)
_DAILY_TAPE_MAX_DAYS = 400
_MOOD_DAILY_MAX_DAYS = 120

_TRACK_REF_SQL = """
    COALESCE(lt.id, td.track_id) AS track_id,
    COALESCE(lt.title, td.title) AS title,
    COALESCE(lt.artist, NULLIF(td.artist, '')) AS artist,
    COALESCE(lt.album, NULLIF(td.album, '')) AS album,
    alb.id AS album_id,
    alb.slug AS album_slug,
    gca.global_album_uid::text AS global_album_uid,
    art.id AS artist_id,
    art.slug AS artist_slug
"""
_TRACK_REF_JOINS = """
    LEFT JOIN library_tracks lt
      ON lt.id = td.track_id
      OR (td.track_id IS NULL AND td.track_entity_uid IS NOT NULL
          AND lt.entity_uid = td.track_entity_uid)
    LEFT JOIN library_albums alb
      ON alb.id = lt.album_id
      OR (lt.album_id IS NULL AND alb.artist = td.artist AND alb.name = td.album)
    LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, td.artist)
    LEFT JOIN LATERAL (
        SELECT global_album_uid FROM global_catalog_albums
        WHERE local_album_id = alb.id
        LIMIT 1
    ) gca ON alb.id IS NOT NULL
"""


def _iso(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat() if value.tzinfo is None else value.isoformat()
    return value.isoformat()


def _range(
    session, user_id: int | None, period: StatsPeriod
) -> tuple[date, date] | None:
    start = period.start
    end = period.end or period.today + timedelta(days=1)
    if start is None:
        start = session.execute(
            text(
                "SELECT MIN(day) FROM user_daily_listening WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id)"
            ),
            {"user_id": user_id},
        ).scalar_one_or_none()
        if start is None:
            return None
    return start, end


def _tape(session, user_id: int | None, period: StatsPeriod) -> dict | None:
    bounds = _range(session, user_id, period)
    if bounds is None:
        return None
    start, end = bounds
    weekly = (end - start).days > _DAILY_TAPE_MAX_DAYS
    granularity = "week" if weekly else "day"
    bucket_sql = "date_trunc('week', {col})::date" if weekly else "{col}"
    step = "1 week" if weekly else "1 day"
    params = {"user_id": user_id, "start": start, "last": end - timedelta(days=1)}
    points = [
        {
            "bucket": row.bucket.isoformat(),
            "minutes": float(row.minutes or 0),
            "plays": int(row.plays or 0),
        }
        for row in session.execute(
            text(
                f"""
                WITH buckets AS (
                    SELECT generate_series(
                        {bucket_sql.format(col="CAST(:start AS date)")},
                        {bucket_sql.format(col="CAST(:last AS date)")},
                        CAST('{step}' AS interval)
                    )::date AS bucket
                ),
                listened AS (
                    SELECT {bucket_sql.format(col="day")} AS bucket,
                           SUM(minutes_listened) AS minutes,
                           SUM(play_count) AS plays
                    FROM user_daily_listening
                    WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND day >= :start AND day <= :last
                    GROUP BY 1
                )
                SELECT b.bucket, l.minutes, l.plays
                FROM buckets b
                LEFT JOIN listened l ON l.bucket = b.bucket
                ORDER BY b.bucket
                """
            ),
            params,
        )
    ]
    mood_weekly = (end - start).days > _MOOD_DAILY_MAX_DAYS
    mood_bucket = "date_trunc('week', td.day)::date" if mood_weekly else "td.day"
    mood = [
        {
            "bucket": row.bucket.isoformat(),
            "energy": None if row.energy is None else round(float(row.energy), 3),
            "valence": None if row.valence is None else round(float(row.valence), 3),
        }
        for row in session.execute(
            text(
                f"""
                SELECT {mood_bucket} AS bucket,
                       SUM(lt.energy * td.minutes_listened)
                         / NULLIF(SUM(td.minutes_listened) FILTER (WHERE lt.energy IS NOT NULL), 0) AS energy,
                       SUM(lt.valence * td.minutes_listened)
                         / NULLIF(SUM(td.minutes_listened) FILTER (WHERE lt.valence IS NOT NULL), 0) AS valence
                FROM user_track_daily td
                JOIN library_tracks lt ON lt.id = td.track_id
                WHERE (CAST(:user_id AS integer) IS NULL OR td.user_id = :user_id) AND td.day >= :start AND td.day <= :last
                GROUP BY 1
                ORDER BY 1
                """
            ),
            params,
        )
    ]
    months = [
        {
            "month": row.month.isoformat()[:7],
            "minutes": float(row.minutes or 0),
            "plays": int(row.plays or 0),
            "top_artist": row.top_artist,
            "top_album": {
                "album": row.album,
                "artist": row.album_artist,
                "album_id": row.album_id,
                "album_slug": row.album_slug,
                "global_album_uid": row.global_album_uid,
            }
            if row.album
            else None,
        }
        for row in session.execute(
            text(
                """
                WITH monthly AS (
                    SELECT date_trunc('month', day)::date AS month, artist, album,
                           SUM(play_count) AS plays, SUM(minutes_listened) AS minutes
                    FROM user_track_daily
                    WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND day >= :start AND day <= :last
                    GROUP BY 1, 2, 3
                ),
                totals AS (
                    SELECT month, SUM(minutes) AS minutes, SUM(plays) AS plays
                    FROM monthly GROUP BY month
                ),
                top_artist AS (
                    SELECT DISTINCT ON (month) month, artist
                    FROM (
                        SELECT month, artist, SUM(plays) AS plays, SUM(minutes) AS minutes
                        FROM monthly WHERE artist != '' GROUP BY month, artist
                    ) ranked
                    ORDER BY month, plays DESC, minutes DESC, artist
                ),
                top_album AS (
                    SELECT DISTINCT ON (month) month, artist, album
                    FROM monthly WHERE album != ''
                    ORDER BY month, plays DESC, minutes DESC, album
                )
                SELECT t.month, t.minutes, t.plays, ta.artist AS top_artist,
                       tb.album, tb.artist AS album_artist,
                       alb.id AS album_id, alb.slug AS album_slug,
                       gca.global_album_uid::text AS global_album_uid
                FROM totals t
                LEFT JOIN top_artist ta ON ta.month = t.month
                LEFT JOIN top_album tb ON tb.month = t.month
                LEFT JOIN library_albums alb
                  ON alb.artist = tb.artist AND alb.name = tb.album
                LEFT JOIN LATERAL (
                    SELECT global_album_uid FROM global_catalog_albums
                    WHERE local_album_id = alb.id LIMIT 1
                ) gca ON alb.id IS NOT NULL
                ORDER BY t.month
                """
            ),
            params,
        )
    ]
    return {
        "granularity": granularity,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "points": points,
        "mood": mood,
        "peaks": _peaks(session, user_id, params, weekly),
        "months": months,
    }


def _peaks(session, user_id: int | None, params: dict, weekly: bool) -> list[dict]:
    bucket = "date_trunc('week', td.day)::date" if weekly else "td.day"
    peaks: list[dict] = []
    obsession = (
        session.execute(
            text(
                f"""
                SELECT {bucket} AS bucket, td.day, td.play_count AS value, {_TRACK_REF_SQL}
                FROM user_track_daily td
                {_TRACK_REF_JOINS}
                WHERE (CAST(:user_id AS integer) IS NULL OR td.user_id = :user_id) AND td.day >= :start AND td.day <= :last
                  AND td.entity_key != 'unknown-track'
                ORDER BY td.play_count DESC, td.minutes_listened DESC, td.day DESC
                LIMIT 1
                """
            ),
            params,
        )
        .mappings()
        .first()
    )
    if obsession and int(obsession["value"] or 0) > 1:
        peaks.append(_peak("obsession", obsession))
    longest = (
        session.execute(
            text(
                f"""
                SELECT {bucket.replace("td.", "d.")} AS bucket, d.day,
                       SUM(d.minutes_listened) AS value
                FROM user_daily_listening d
                WHERE (CAST(:user_id AS integer) IS NULL OR d.user_id = :user_id) AND d.day >= :start AND d.day <= :last
                GROUP BY d.day
                ORDER BY value DESC, d.day DESC
                LIMIT 1
                """
            ),
            params,
        )
        .mappings()
        .first()
    )
    if longest:
        peaks.append(
            {
                "kind": "longest_day",
                "bucket": longest["bucket"].isoformat(),
                "day": longest["day"].isoformat(),
                "value": round(float(longest["value"] or 0), 1),
            }
        )
    discovery = (
        session.execute(
            text(
                f"""
                SELECT {bucket.replace("td.day", "f.first_day")} AS bucket,
                       f.first_day AS day, f.entity_key AS artist,
                       SUM(td.play_count) AS value
                FROM user_entity_firsts f
                JOIN user_track_daily td
                  ON td.user_id = f.user_id AND td.artist = f.entity_key
                 AND td.day >= :start AND td.day <= :last
                WHERE (CAST(:user_id AS integer) IS NULL OR f.user_id = :user_id) AND f.entity_type = 'artist'
                  AND f.first_day >= :start AND f.first_day <= :last
                GROUP BY f.first_day, f.entity_key
                ORDER BY value DESC, f.first_day
                LIMIT 1
                """
            ),
            params,
        )
        .mappings()
        .first()
    )
    if discovery:
        peaks.append(
            {
                "kind": "discovery",
                "bucket": discovery["bucket"].isoformat(),
                "day": discovery["day"].isoformat(),
                "artist": discovery["artist"],
                "value": int(discovery["value"] or 0),
            }
        )
    return peaks


def _track_ref(row) -> dict:
    return {
        "track_id": row["track_id"],
        "title": row["title"],
        "artist": row["artist"],
        "album": row["album"],
        "album_id": row["album_id"],
        "album_slug": row["album_slug"],
        "global_album_uid": row["global_album_uid"],
        "artist_id": row["artist_id"],
        "artist_slug": row["artist_slug"],
    }


def _peak(kind: str, row) -> dict:
    return {
        "kind": kind,
        "bucket": row["bucket"].isoformat(),
        "day": row["day"].isoformat(),
        "value": int(row["value"] or 0),
        "track": _track_ref(row),
    }


def _streaks(session, user_id: int, period: StatsPeriod) -> tuple[dict | None, dict]:
    longest = (
        session.execute(
            text(
                f"""
                WITH days AS (
                    SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::integer AS run
                    FROM user_daily_listening
                    WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND play_count > 0
                      AND {period_day_filter(period)}
                )
                SELECT MIN(day) AS start, MAX(day) AS end, COUNT(*)::integer AS days
                FROM days
                GROUP BY run
                ORDER BY days DESC, MAX(day) DESC
                LIMIT 1
                """
            ),
            {"user_id": user_id, **period_params(period)},
        )
        .mappings()
        .first()
    )
    current = session.execute(
        text(
            """
            WITH recent AS (
                SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day DESC))::integer * -1 AS run
                FROM user_daily_listening
                WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND play_count > 0 AND day <= :today
            ),
            latest AS (
                SELECT run FROM recent ORDER BY day DESC LIMIT 1
            )
            SELECT COUNT(*)::integer, MAX(day)
            FROM recent WHERE run = (SELECT run FROM latest)
            """
        ),
        {"user_id": user_id, "today": period.today},
    ).one()
    current_days, last_day = int(current[0] or 0), current[1]
    if last_day is None or last_day < period.today - timedelta(days=1):
        current_days = 0
    longest_payload = (
        {
            "days": int(longest["days"]),
            "start": longest["start"].isoformat(),
            "end": longest["end"].isoformat(),
        }
        if longest
        else None
    )
    return longest_payload, {"days": current_days}


def _period_utc_bounds(period: StatsPeriod) -> tuple[datetime | None, datetime | None]:
    zone = ZoneInfo(period.timezone)

    def to_utc(day: date | None) -> datetime | None:
        if day is None:
            return None
        return datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)

    return to_utc(period.start), to_utc(period.end)


def _highlights(session, user_id: int, period: StatsPeriod) -> dict:
    params = {"user_id": user_id, **period_params(period)}
    longest_streak, current_streak = _streaks(session, user_id, period)
    new_artists = None
    if period.start is not None:
        row = session.execute(
            text(
                f"""
                WITH new_artists AS (
                    SELECT entity_key FROM user_entity_firsts
                    WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND entity_type = 'artist'
                      AND {period_day_filter(period, "first_day")}
                ),
                minutes AS (
                    SELECT SUM(minutes_listened) AS total,
                           SUM(minutes_listened) FILTER (
                               WHERE artist IN (SELECT entity_key FROM new_artists)
                           ) AS discovered
                    FROM user_track_daily
                    WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND {period_day_filter(period)}
                )
                SELECT (SELECT COUNT(*) FROM new_artists)::integer AS count,
                       COALESCE(discovered / NULLIF(total, 0), 0) AS share
                FROM minutes
                """
            ),
            params,
        ).one()
        new_artists = {"count": int(row.count), "share": round(float(row.share), 4)}
    artist_count = session.execute(
        text(
            f"""
            SELECT COUNT(DISTINCT artist)::integer
            FROM user_track_daily
            WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND artist != '' AND {period_day_filter(period)}
            """
        ),
        params,
    ).scalar_one()
    start_utc, end_utc = _period_utc_bounds(period)
    session_row = (
        session.execute(
            text(
                """
                SELECT minutes_listened, started_at, ended_at, track_count
                FROM user_listening_sessions
                WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id)
                  AND (CAST(:start_utc AS timestamptz) IS NULL OR started_at >= :start_utc)
                  AND (CAST(:end_utc AS timestamptz) IS NULL OR started_at < :end_utc)
                ORDER BY minutes_listened DESC, started_at DESC
                LIMIT 1
                """
            ),
            {"user_id": user_id, "start_utc": start_utc, "end_utc": end_utc},
        )
        .mappings()
        .first()
    )
    obsession = (
        session.execute(
            text(
                f"""
                SELECT td.day, td.play_count AS plays, td.minutes_listened, {_TRACK_REF_SQL}
                FROM user_track_daily td
                {_TRACK_REF_JOINS}
                WHERE (CAST(:user_id AS integer) IS NULL OR td.user_id = :user_id) AND td.entity_key != 'unknown-track'
                  AND {period_day_filter(period, "td.day")}
                ORDER BY td.play_count DESC, td.minutes_listened DESC, td.day DESC
                LIMIT 1
                """
            ),
            params,
        )
        .mappings()
        .first()
    )
    return {
        "artist_count": int(artist_count or 0),
        "longest_streak": longest_streak,
        "current_streak": current_streak,
        "new_artists": new_artists,
        "longest_session": {
            "minutes": round(float(session_row["minutes_listened"]), 1),
            "started_at": _iso(session_row["started_at"]),
            "ended_at": _iso(session_row["ended_at"]),
            "track_count": int(session_row["track_count"]),
        }
        if session_row
        else None,
        "obsession": {
            "day": obsession["day"].isoformat(),
            "plays": int(obsession["plays"]),
            "minutes": round(float(obsession["minutes_listened"] or 0), 1),
            "track": _track_ref(obsession),
        }
        if obsession and int(obsession["plays"] or 0) > 1
        else None,
    }


def _artist_of_period(session, user_id: int | None, period: StatsPeriod) -> dict | None:
    params = {"user_id": user_id, **period_params(period)}
    row = (
        session.execute(
            text(
                f"""
                WITH artists AS (
                    SELECT artist, SUM(play_count) AS plays,
                           SUM(minutes_listened) AS minutes,
                           MIN(day) AS first_day_in_period,
                           COUNT(DISTINCT day) AS active_days
                    FROM user_track_daily
                    WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND artist != ''
                      AND {period_day_filter(period)}
                    GROUP BY artist
                    ORDER BY plays DESC, minutes DESC, artist
                    LIMIT 1
                ),
                albums AS (
                    SELECT td.album, SUM(td.play_count) AS plays
                    FROM user_track_daily td
                    JOIN artists a ON a.artist = td.artist
                    WHERE (CAST(:user_id AS integer) IS NULL OR td.user_id = :user_id) AND td.album != ''
                      AND {period_day_filter(period, "td.day")}
                    GROUP BY td.album
                    ORDER BY plays DESC, td.album
                    LIMIT 1
                )
                SELECT a.artist, a.plays, a.minutes, a.first_day_in_period,
                       a.active_days, f.first_day AS first_ever_day,
                       la.id AS artist_id, la.slug AS artist_slug,
                       gcart.global_artist_uid::text AS global_artist_uid,
                       al.album, al.plays AS album_plays,
                       alb.id AS album_id, alb.slug AS album_slug,
                       gcalb.global_album_uid::text AS global_album_uid
                FROM artists a
                LEFT JOIN LATERAL (
                    SELECT MIN(first_day) AS first_day
                    FROM user_entity_firsts
                    WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id)
                      AND entity_type = 'artist' AND entity_key = a.artist
                ) f ON TRUE
                LEFT JOIN library_artists la ON la.name = a.artist
                LEFT JOIN LATERAL (
                    SELECT global_artist_uid FROM global_catalog_artists
                    WHERE local_artist_id = la.id LIMIT 1
                ) gcart ON la.id IS NOT NULL
                LEFT JOIN albums al ON TRUE
                LEFT JOIN library_albums alb
                  ON alb.artist = a.artist AND alb.name = al.album
                LEFT JOIN LATERAL (
                    SELECT global_album_uid FROM global_catalog_albums
                    WHERE local_album_id = alb.id LIMIT 1
                ) gcalb ON alb.id IS NOT NULL
                """
            ),
            params,
        )
        .mappings()
        .first()
    )
    if not row:
        return None
    standing = (
        _listener_standing(session, row["artist"], int(row["plays"]), period)
        if user_id is not None
        else None
    )
    return {
        "listener_count": standing["listeners"] if standing else None,
        "listener_top_percent": standing["top_percent"] if standing else None,
        "artist_name": row["artist"],
        "artist_id": row["artist_id"],
        "artist_slug": row["artist_slug"],
        "global_artist_uid": row["global_artist_uid"],
        "plays": int(row["plays"]),
        "minutes": round(float(row["minutes"] or 0), 1),
        "active_days": int(row["active_days"]),
        "first_day_in_period": row["first_day_in_period"].isoformat(),
        "first_ever_day": _iso(row["first_ever_day"]),
        "top_album": {
            "album": row["album"],
            "plays": int(row["album_plays"] or 0),
            "album_id": row["album_id"],
            "album_slug": row["album_slug"],
            "global_album_uid": row["global_album_uid"],
        }
        if row["album"]
        else None,
    }


_MIN_LISTENERS_FOR_RANK = 5


def _listener_standing(session, artist: str, plays: int, period: StatsPeriod):
    if period.key.startswith("month:"):
        return None
    row = session.execute(
        text(
            """
            SELECT COUNT(*)::integer AS listeners,
                   COUNT(*) FILTER (WHERE play_count > :plays)::integer AS above
            FROM user_artist_stats
            WHERE stat_window = :window AND artist_name = :artist
            """
        ),
        {"window": period.key, "artist": artist, "plays": plays},
    ).one()
    if row.listeners < _MIN_LISTENERS_FOR_RANK:
        return None
    top_percent = max(1, math.ceil((row.above + 1) * 100 / row.listeners))
    return {"listeners": int(row.listeners), "top_percent": int(top_percent)}


def _heatmap(session, user_id: int | None, period: StatsPeriod) -> dict:
    cells = [[0.0] * 24 for _ in range(7)]
    total = 0.0
    night = 0.0
    for row in session.execute(
        text(
            f"""
            SELECT (EXTRACT(ISODOW FROM day)::integer - 1) AS weekday, hour,
                   SUM(minutes_listened) AS minutes
            FROM user_hourly_listening
            WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND {period_day_filter(period)}
            GROUP BY 1, 2
            """
        ),
        {"user_id": user_id, **period_params(period)},
    ):
        minutes = float(row.minutes or 0)
        cells[row.weekday][row.hour] = round(minutes, 1)
        total += minutes
        if row.hour in _NIGHT_HOURS:
            night += minutes
    peak = None
    if total > 0:
        weekday, hour = max(
            ((d, h) for d in range(7) for h in range(24)),
            key=lambda cell: cells[cell[0]][cell[1]],
        )
        peak = {"weekday": weekday, "hour": hour}
    return {
        "cells": cells,
        "peak": peak,
        "night_share": round(night / total, 4) if total else 0,
    }


def _music_age(session, user_id: int | None, period: StatsPeriod) -> dict | None:
    rows = session.execute(
        text(
            f"""
            SELECT CAST(SUBSTRING(COALESCE(alb.year, lt.year) FROM '^[0-9]{{4}}') AS integer) AS year,
                   SUM(td.minutes_listened) AS minutes
            FROM user_track_daily td
            JOIN library_tracks lt ON lt.id = td.track_id
            LEFT JOIN library_albums alb ON alb.id = lt.album_id
            WHERE (CAST(:user_id AS integer) IS NULL OR td.user_id = :user_id) AND {period_day_filter(period, "td.day")}
              AND COALESCE(alb.year, lt.year) ~ '^[0-9]{{4}}'
            GROUP BY 1
            ORDER BY 1
            """
        ),
        {"user_id": user_id, **period_params(period)},
    ).all()
    total = sum(float(row.minutes or 0) for row in rows)
    if total <= 0:
        return None
    running = 0.0
    median_year = rows[-1].year
    for row in rows:
        running += float(row.minutes or 0)
        if running >= total / 2:
            median_year = row.year
            break
    decades: dict[int, float] = {}
    for row in rows:
        decade = (row.year // 10) * 10
        decades[decade] = decades.get(decade, 0.0) + float(row.minutes or 0)
    oldest = (
        session.execute(
            text(
                f"""
                SELECT alb.name AS album, alb.artist, alb.id AS album_id,
                       alb.slug AS album_slug,
                       CAST(SUBSTRING(alb.year FROM '^[0-9]{{4}}') AS integer) AS year
                FROM user_track_daily td
                JOIN library_tracks lt ON lt.id = td.track_id
                JOIN library_albums alb ON alb.id = lt.album_id
                WHERE (CAST(:user_id AS integer) IS NULL OR td.user_id = :user_id) AND {period_day_filter(period, "td.day")}
                  AND alb.year ~ '^[0-9]{{4}}'
                ORDER BY year, alb.name
                LIMIT 1
                """
            ),
            {"user_id": user_id, **period_params(period)},
        )
        .mappings()
        .first()
    )
    return {
        "median_year": int(median_year),
        "decades": [
            {"decade": decade, "share": round(minutes / total, 4)}
            for decade, minutes in sorted(decades.items())
        ],
        "oldest_album": dict(oldest) if oldest else None,
    }


def _genre_shares(
    session, user_id: int | None, filter_sql: str, params: dict
) -> list[dict]:
    rows = session.execute(
        text(
            weighted_genre_split_sql(
                f"""
                SELECT genre AS genre_name,
                       SUM(play_count) AS play_count,
                       SUM(complete_play_count) AS complete_play_count,
                       SUM(minutes_listened) AS minutes_listened,
                       MIN(first_played_at) AS first_played_at,
                       MAX(last_played_at) AS last_played_at
                FROM user_track_daily
                WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id) AND COALESCE(genre, '') != ''
                  AND {filter_sql}
                GROUP BY genre
                """
            )
        ),
        {"user_id": user_id, "lim": 12, **params},
    ).mappings()
    return format_weighted_genre_rows(list(rows))


def _genre_trend(session, user_id: int | None, period: StatsPeriod) -> list[dict]:
    params = period_params(period)
    current = _genre_shares(session, user_id, period_day_filter(period), params)
    previous: dict[str, float] = {}
    if period.previous_start is not None and period.start is not None:
        previous = {
            item["genre_name"].lower(): item["share"]
            for item in _genre_shares(
                session,
                user_id,
                "day >= :previous_start AND day < :period_start",
                params,
            )
        }
    return [
        {
            "genre_name": item["genre_name"],
            "slug": item["slug"],
            "share": round(item["share"], 4),
            "delta_vs_previous": None
            if not previous
            else round(
                item["share"] - previous.get(item["genre_name"].lower(), 0.0), 4
            ),
        }
        for item in current[:6]
    ]


def _computed_until(session, user_id: int | None) -> str | None:
    value = session.execute(
        text(
            "SELECT MAX(refreshed_at) FROM user_listening_projection_state "
            "WHERE (CAST(:user_id AS integer) IS NULL OR user_id = :user_id)"
        ),
        {"user_id": user_id},
    ).scalar_one_or_none()
    return _iso(value)


def get_stats_signal(session, user_id: int | None, period: StatsPeriod) -> dict:
    """Signal sections for one user, or for the whole instance when ``user_id`` is None."""
    return {
        "timezone": period.timezone,
        "provisional": period.provisional,
        "computed_until": _computed_until(session, user_id),
        "metrics_version": METRICS_VERSION,
        "tape": _tape(session, user_id, period),
        "highlights": None
        if user_id is None
        else _highlights(session, user_id, period),
        "artist_of_period": _artist_of_period(session, user_id, period),
        "heatmap": _heatmap(session, user_id, period),
        "music_age": _music_age(session, user_id, period),
        "genre_trend": _genre_trend(session, user_id, period),
    }


__all__ = ["METRICS_VERSION", "get_stats_signal"]
