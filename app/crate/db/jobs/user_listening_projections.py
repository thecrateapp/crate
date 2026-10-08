"""Per-day listening projections, rebuilt incrementally from dirty days.

Every play event marks its local day (in the user's timezone) as dirty in
the same transaction that records it. The worker then recomputes only those
days from ``user_play_events`` and derives everything else (window stats,
first plays, sessions) from the per-day projections, so a refresh never
rescans a user's whole history. ``rebuild_user_listening_projections`` keeps
the full recompute as the reference result.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import text

from crate.db.repositories.user_library_shared import _STATS_WINDOWS

SESSION_GAP_MINUTES = 30

_TRACK_KEY_SQL = (
    "COALESCE(upe.global_track_uid::text, upe.track_entity_uid::text, "
    "upe.track_id::text, NULLIF(upe.track_path, ''), 'unknown-track')"
)
_GENRE_SQL = """
    COALESCE(
        (SELECT lt.genre FROM library_tracks lt
          WHERE upe.track_id IS NOT NULL AND lt.id = upe.track_id),
        (SELECT lt.genre FROM library_tracks lt
          WHERE upe.track_id IS NULL AND upe.track_entity_uid IS NOT NULL
            AND lt.entity_uid = upe.track_entity_uid
          LIMIT 1),
        (SELECT lt.genre FROM library_tracks lt
          WHERE upe.track_id IS NULL AND COALESCE(upe.track_path, '') != ''
            AND lt.path = upe.track_path
          LIMIT 1)
    )
"""
_PROJECTION_TABLES = (
    "user_track_daily",
    "user_daily_listening",
    "user_hourly_listening",
)


def user_listening_timezone(session, user_id: int) -> str:
    value = session.execute(
        text("SELECT NULLIF(timezone, '') FROM users WHERE id = :user_id"),
        {"user_id": user_id},
    ).scalar_one_or_none()
    return value or "UTC"


def mark_listening_day_dirty(session, user_id: int, ended_at) -> date | None:
    day = session.execute(
        text(
            """
            SELECT (CAST(:ended_at AS timestamptz)
                       AT TIME ZONE COALESCE(NULLIF(timezone, ''), 'UTC'))::date
            FROM users
            WHERE id = :user_id
            """
        ),
        {"user_id": user_id, "ended_at": ended_at},
    ).scalar_one_or_none()
    if day is None:
        return None
    session.execute(
        text(
            """
            INSERT INTO user_listening_dirty_days (user_id, day)
            VALUES (:user_id, :day)
            ON CONFLICT (user_id, day) DO NOTHING
            """
        ),
        {"user_id": user_id, "day": day},
    )
    return day


def _day_bounds(days: list[date], tz: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(tz)
    start = datetime.combine(min(days), time.min, tzinfo=zone)
    end = datetime.combine(max(days) + timedelta(days=1), time.min, tzinfo=zone)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _event_filter(user_id: int, tz: str, days: list[date] | None) -> tuple[str, dict]:
    params: dict = {"user_id": user_id, "tz": tz}
    if days is None:
        return "upe.user_id = :user_id", params
    start, end = _day_bounds(days, tz)
    params.update({"days": days, "start": start, "end": end})
    return (
        "upe.user_id = :user_id AND upe.ended_at >= :start AND upe.ended_at < :end "
        "AND (upe.ended_at AT TIME ZONE :tz)::date = ANY(:days)",
        params,
    )


def _rebuild_days(session, user_id: int, tz: str, days: list[date] | None) -> None:
    day_filter = "" if days is None else " AND day = ANY(:days)"
    for table in _PROJECTION_TABLES:
        session.execute(
            text(f"DELETE FROM {table} WHERE user_id = :user_id{day_filter}"),
            {"user_id": user_id, "days": days},
        )
    where_sql, params = _event_filter(user_id, tz, days)
    session.execute(
        text(
            f"""
            INSERT INTO user_track_daily (
                user_id, day, entity_key, artist, album, track_id,
                global_track_uid, track_entity_uid, track_path, title, genre,
                play_count, complete_play_count, skip_count, minutes_listened,
                first_played_at, last_played_at
            )
            SELECT
                :user_id,
                (upe.ended_at AT TIME ZONE :tz)::date,
                {_TRACK_KEY_SQL},
                COALESCE(upe.artist, ''),
                COALESCE(upe.album, ''),
                MAX(upe.track_id),
                MAX(upe.global_track_uid::text)::uuid,
                MAX(upe.track_entity_uid::text)::uuid,
                MAX(upe.track_path),
                MAX(upe.title),
                MAX(track_genre.genre),
                COUNT(*)::INTEGER,
                SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER,
                SUM(CASE WHEN upe.was_skipped THEN 1 ELSE 0 END)::INTEGER,
                COALESCE(SUM(upe.played_seconds), 0) / 60.0,
                MIN(upe.started_at),
                MAX(upe.ended_at)
            FROM user_play_events upe
            LEFT JOIN LATERAL (SELECT {_GENRE_SQL} AS genre) track_genre ON TRUE
            WHERE {where_sql}
            GROUP BY 2, 3, 4, 5
            """
        ),
        params,
    )
    session.execute(
        text(
            f"""
            INSERT INTO user_daily_listening (
                user_id, day, play_count, complete_play_count, skip_count,
                minutes_listened, unique_tracks, unique_artists, unique_albums
            )
            SELECT
                user_id,
                day,
                SUM(play_count)::INTEGER,
                SUM(complete_play_count)::INTEGER,
                SUM(skip_count)::INTEGER,
                SUM(minutes_listened),
                COUNT(DISTINCT entity_key)::INTEGER,
                COUNT(DISTINCT NULLIF(artist, ''))::INTEGER,
                COUNT(DISTINCT NULLIF(CONCAT(artist, '||', album), '||'))::INTEGER
            FROM user_track_daily
            WHERE user_id = :user_id{day_filter}
            GROUP BY user_id, day
            """
        ),
        {"user_id": user_id, "days": days},
    )
    session.execute(
        text(
            f"""
            INSERT INTO user_hourly_listening (
                user_id, day, hour, play_count, minutes_listened
            )
            SELECT
                :user_id,
                (upe.ended_at AT TIME ZONE :tz)::date,
                EXTRACT(HOUR FROM upe.ended_at AT TIME ZONE :tz)::SMALLINT,
                COUNT(*)::INTEGER,
                COALESCE(SUM(upe.played_seconds), 0) / 60.0
            FROM user_play_events upe
            WHERE {where_sql}
            GROUP BY 2, 3
            """
        ),
        params,
    )


def _touched_keys(session, user_id: int, days: list[date]) -> dict[str, list]:
    rows = session.execute(
        text(
            """
            SELECT DISTINCT entity_key, artist, album
            FROM user_track_daily
            WHERE user_id = :user_id AND day = ANY(:days)
            """
        ),
        {"user_id": user_id, "days": days},
    ).all()
    return {
        "track": sorted({row.entity_key for row in rows}),
        "artist": sorted({row.artist for row in rows}),
        "album": sorted({f"{row.artist}||{row.album}" for row in rows}),
    }


_FIRSTS_SQL = {
    "artist": (
        "artist",
        "artist",
        "''",
        "artist != ''",
    ),
    "album": (
        "CONCAT(artist, '||', album)",
        "MAX(artist)",
        "MAX(album)",
        "album != ''",
    ),
    "track": (
        "entity_key",
        "MAX(artist)",
        "MAX(album)",
        "entity_key != 'unknown-track'",
    ),
}


def _rebuild_firsts(session, user_id: int, keys: dict[str, list] | None) -> None:
    for entity_type, (key_sql, artist_sql, album_sql, condition) in _FIRSTS_SQL.items():
        params: dict = {"user_id": user_id, "entity_type": entity_type}
        key_filter = ""
        if keys is not None:
            params["keys"] = keys[entity_type]
            if not params["keys"]:
                continue
            key_filter = f" AND {key_sql} = ANY(:keys)"
        session.execute(
            text(
                "DELETE FROM user_entity_firsts WHERE user_id = :user_id "
                "AND entity_type = :entity_type"
                + ("" if keys is None else " AND entity_key = ANY(:keys)")
            ),
            params,
        )
        session.execute(
            text(
                f"""
                INSERT INTO user_entity_firsts (
                    user_id, entity_type, entity_key, artist, album,
                    first_day, first_played_at
                )
                SELECT
                    :user_id,
                    :entity_type,
                    {key_sql},
                    {artist_sql},
                    {album_sql},
                    MIN(day),
                    MIN(first_played_at)
                FROM user_track_daily
                WHERE user_id = :user_id AND {condition}{key_filter}
                GROUP BY {key_sql}
                """
            ),
            params,
        )


def _rebuild_sessions(
    session, user_id: int, start: datetime | None, end: datetime | None
) -> None:
    gap = timedelta(minutes=SESSION_GAP_MINUTES)
    if start is not None and end is not None:
        bounds = session.execute(
            text(
                """
                SELECT MIN(started_at) AS first_start, MAX(ended_at) AS last_end
                FROM user_listening_sessions
                WHERE user_id = :user_id
                  AND ended_at >= :start - CAST(:gap AS interval)
                  AND started_at < :end + CAST(:gap AS interval)
                """
            ),
            {"user_id": user_id, "start": start, "end": end, "gap": gap},
        ).one()
        if bounds.first_start is not None:
            start = min(start, bounds.first_start)
            end = max(end, bounds.last_end)
    range_filter = (
        "" if start is None else " AND started_at >= :start AND started_at <= :end"
    )
    event_filter = (
        ""
        if start is None
        else " AND upe.started_at >= :start AND upe.started_at <= :end"
    )
    params = {"user_id": user_id, "start": start, "end": end, "gap": gap}
    session.execute(
        text(
            f"DELETE FROM user_listening_sessions WHERE user_id = :user_id{range_filter}"
        ),
        params,
    )
    session.execute(
        text(
            f"""
            WITH events AS (
                SELECT
                    upe.id,
                    upe.started_at,
                    upe.ended_at,
                    upe.played_seconds,
                    MAX(upe.ended_at) OVER (
                        ORDER BY upe.started_at, upe.id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ) AS previous_end
                FROM user_play_events upe
                WHERE upe.user_id = :user_id{event_filter}
            ),
            grouped AS (
                SELECT
                    *,
                    SUM(
                        CASE
                            WHEN previous_end IS NULL
                              OR started_at - previous_end > CAST(:gap AS interval)
                            THEN 1 ELSE 0
                        END
                    ) OVER (ORDER BY started_at, id) AS session_no
                FROM events
            )
            INSERT INTO user_listening_sessions (
                user_id, started_at, ended_at, track_count, minutes_listened
            )
            SELECT
                :user_id,
                MIN(started_at),
                MAX(ended_at),
                COUNT(*)::INTEGER,
                COALESCE(SUM(played_seconds), 0) / 60.0
            FROM grouped
            GROUP BY session_no
            ON CONFLICT (user_id, started_at) DO UPDATE SET
                ended_at = EXCLUDED.ended_at,
                track_count = EXCLUDED.track_count,
                minutes_listened = EXCLUDED.minutes_listened
            """
        ),
        params,
    )


_WINDOW_STATS_SQL = (
    (
        "user_track_stats",
        """
        INSERT INTO user_track_stats (
            user_id, stat_window, entity_key, track_id, global_track_uid,
            track_entity_uid, track_path, title, artist, album, play_count,
            complete_play_count, minutes_listened, first_played_at, last_played_at
        )
        SELECT
            :user_id, :window, entity_key, MAX(track_id),
            MAX(global_track_uid::text)::uuid, MAX(track_entity_uid::text)::uuid,
            MAX(track_path), MAX(title), MAX(NULLIF(artist, '')),
            MAX(NULLIF(album, '')), SUM(play_count)::INTEGER,
            SUM(complete_play_count)::INTEGER, SUM(minutes_listened),
            MIN(first_played_at), MAX(last_played_at)
        FROM user_track_daily
        WHERE user_id = :user_id AND entity_key != 'unknown-track'{cutoff}
        GROUP BY entity_key
        """,
    ),
    (
        "user_artist_stats",
        """
        INSERT INTO user_artist_stats (
            user_id, stat_window, artist_name, play_count, complete_play_count,
            minutes_listened, first_played_at, last_played_at
        )
        SELECT
            :user_id, :window, artist, SUM(play_count)::INTEGER,
            SUM(complete_play_count)::INTEGER, SUM(minutes_listened),
            MIN(first_played_at), MAX(last_played_at)
        FROM user_track_daily
        WHERE user_id = :user_id AND artist != ''{cutoff}
        GROUP BY artist
        """,
    ),
    (
        "user_album_stats",
        """
        INSERT INTO user_album_stats (
            user_id, stat_window, entity_key, artist, album, play_count,
            complete_play_count, minutes_listened, first_played_at, last_played_at
        )
        SELECT
            :user_id, :window, CONCAT(artist, '||', album), MAX(artist),
            MAX(album), SUM(play_count)::INTEGER,
            SUM(complete_play_count)::INTEGER, SUM(minutes_listened),
            MIN(first_played_at), MAX(last_played_at)
        FROM user_track_daily
        WHERE user_id = :user_id AND album != ''{cutoff}
        GROUP BY CONCAT(artist, '||', album)
        """,
    ),
    (
        "user_genre_stats",
        """
        INSERT INTO user_genre_stats (
            user_id, stat_window, genre_name, play_count, complete_play_count,
            minutes_listened, first_played_at, last_played_at
        )
        SELECT
            :user_id, :window, genre, SUM(play_count)::INTEGER,
            SUM(complete_play_count)::INTEGER, SUM(minutes_listened),
            MIN(first_played_at), MAX(last_played_at)
        FROM user_track_daily
        WHERE user_id = :user_id AND COALESCE(genre, '') != ''{cutoff}
        GROUP BY genre
        """,
    ),
)


def local_today(tz: str) -> date:
    return datetime.now(ZoneInfo(tz)).date()


def window_start_day(days: int | None, tz: str) -> date | None:
    if days is None:
        return None
    return local_today(tz) - timedelta(days=days - 1)


def stat_window_specs(tz: str) -> list[tuple[str, date | None, date | None]]:
    today = local_today(tz)
    specs: list[tuple[str, date | None, date | None]] = [
        (window, window_start_day(days, tz), None)
        for window, days in _STATS_WINDOWS.items()
    ]
    for year in (today.year, today.year - 1):
        specs.append((f"year:{year}", date(year, 1, 1), date(year + 1, 1, 1)))
    return specs


def _rebuild_window_stats(session, user_id: int, tz: str) -> None:
    specs = stat_window_specs(tz)
    for table, _insert_sql in _WINDOW_STATS_SQL:
        session.execute(
            text(
                f"DELETE FROM {table} WHERE user_id = :user_id "
                "AND stat_window LIKE 'year:%' AND stat_window != ALL(:windows)"
            ),
            {"user_id": user_id, "windows": [spec[0] for spec in specs]},
        )
    for window, start_day, end_day in specs:
        clauses = []
        if start_day is not None:
            clauses.append(" AND day >= :start_day")
        if end_day is not None:
            clauses.append(" AND day < :end_day")
        params = {
            "user_id": user_id,
            "window": window,
            "start_day": start_day,
            "end_day": end_day,
        }
        for table, insert_sql in _WINDOW_STATS_SQL:
            session.execute(
                text(
                    f"DELETE FROM {table} WHERE user_id = :user_id AND stat_window = :window"
                ),
                params,
            )
            session.execute(text(insert_sql.format(cutoff="".join(clauses))), params)


def _save_state(session, user_id: int, tz: str, *, rebuilt: bool) -> None:
    session.execute(
        text(
            f"""
            INSERT INTO user_listening_projection_state (
                user_id, timezone, built_at, refreshed_at
            )
            VALUES (:user_id, :tz, NOW(), NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                timezone = EXCLUDED.timezone,
                {"built_at = EXCLUDED.built_at," if rebuilt else ""}
                refreshed_at = EXCLUDED.refreshed_at
            """
        ),
        {"user_id": user_id, "tz": tz},
    )


def _lock_user_projections(session, user_id: int) -> None:
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"user-listening-projections:{user_id}"},
    )


def rebuild_user_listening_projections(session, user_id: int) -> dict:
    _lock_user_projections(session, user_id)
    tz = user_listening_timezone(session, user_id)
    session.execute(
        text("DELETE FROM user_listening_dirty_days WHERE user_id = :user_id"),
        {"user_id": user_id},
    )
    _rebuild_days(session, user_id, tz, None)
    _rebuild_firsts(session, user_id, None)
    _rebuild_sessions(session, user_id, None, None)
    _rebuild_window_stats(session, user_id, tz)
    _save_state(session, user_id, tz, rebuilt=True)
    return {"mode": "rebuild", "timezone": tz, "days": None}


def refresh_user_listening_projections(session, user_id: int) -> dict:
    _lock_user_projections(session, user_id)
    tz = user_listening_timezone(session, user_id)
    state_tz = session.execute(
        text(
            """
            SELECT timezone FROM user_listening_projection_state
            WHERE user_id = :user_id
            FOR UPDATE
            """
        ),
        {"user_id": user_id},
    ).scalar_one_or_none()
    if state_tz != tz:
        return rebuild_user_listening_projections(session, user_id)
    days = sorted(
        session.execute(
            text(
                """
                DELETE FROM user_listening_dirty_days
                WHERE user_id = :user_id
                RETURNING day
                """
            ),
            {"user_id": user_id},
        ).scalars()
    )
    if days:
        before = _touched_keys(session, user_id, days)
        _rebuild_days(session, user_id, tz, days)
        after = _touched_keys(session, user_id, days)
        keys = {
            entity: sorted(set(before[entity]) | set(after[entity]))
            for entity in before
        }
        _rebuild_firsts(session, user_id, keys)
        start, end = _day_bounds(days, tz)
        _rebuild_sessions(session, user_id, start, end)
    _rebuild_window_stats(session, user_id, tz)
    _save_state(session, user_id, tz, rebuilt=False)
    return {"mode": "incremental", "timezone": tz, "days": [str(day) for day in days]}


def user_listening_projections_pending(session, user_id: int) -> bool:
    return bool(
        session.execute(
            text(
                """
                SELECT
                    NOT EXISTS (
                        SELECT 1 FROM user_listening_projection_state state
                        JOIN users u ON u.id = state.user_id
                        WHERE state.user_id = :user_id
                          AND state.timezone = COALESCE(NULLIF(u.timezone, ''), 'UTC')
                    )
                    OR EXISTS (
                        SELECT 1 FROM user_listening_dirty_days
                        WHERE user_id = :user_id
                    )
                """
            ),
            {"user_id": user_id},
        ).scalar()
    )


__all__ = [
    "SESSION_GAP_MINUTES",
    "local_today",
    "mark_listening_day_dirty",
    "rebuild_user_listening_projections",
    "stat_window_specs",
    "refresh_user_listening_projections",
    "user_listening_projections_pending",
    "user_listening_timezone",
    "window_start_day",
]
