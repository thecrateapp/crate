"""Per-user listening range query behind the Stats explorer.

Reads only the per-day projections (``user_track_daily`` through its primary
key prefix, ``user_entity_firsts``; the instance variant reads
``instance_track_daily`` and ``instance_entity_firsts``); library joins resolve refs for the
returned rows only.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import text

from crate.db.cache_store import get_volatile_cache, set_volatile_cache
from crate.db.queries.instance_listening_status import (
    instance_listening_rollups_incomplete,
)
from crate.db.queries.social_profiles import get_public_user_profile_by_username
from crate.db.queries.user_library_stats_signal import _TRACK_REF_JOINS
from crate.db.queries.user_stats_periods import user_stats_timezone
from crate.db.tx import read_scope

__all__ = [
    "MAX_RANGE_DAYS",
    "MIN_RANGE_LISTENERS",
    "StatsRangeError",
    "get_instance_stats_range",
    "get_public_user_stats_range",
    "get_user_stats_range",
    "instance_stats_today",
    "user_stats_today",
    "validate_stats_range",
]

MAX_RANGE_DAYS = 400
MIN_RANGE_LISTENERS = 3
_DISCOVERY_LIMIT = 10
_INSTANCE_RANGE_CACHE_TTL = 300

_RANGE_LISTENERS_SQL = """
SELECT COUNT(DISTINCT user_id) FROM user_track_daily
WHERE day BETWEEN :start AND :end
"""


def _range_sql(daily_table: str, firsts_table: str, *, scoped: bool) -> str:
    """Range query over one projection pair; ``scoped`` filters by ``:user_id``."""
    daily_scope = "user_id = :user_id AND " if scoped else ""
    firsts_scope = "f.user_id = :user_id AND " if scoped else ""
    return f"""
WITH rng AS MATERIALIZED (
    SELECT day, entity_key, artist, album, track_id, track_entity_uid, title,
           play_count, minutes_listened
    FROM {daily_table}
    WHERE {daily_scope}day >= :start AND day <= :end
),
total AS (
    SELECT COALESCE(SUM(minutes_listened), 0) AS minutes FROM rng
),
top_artists AS (
    SELECT artist AS name,
           SUM(minutes_listened) AS minutes,
           SUM(play_count)::integer AS plays
    FROM rng
    WHERE artist != ''
    GROUP BY artist
    ORDER BY minutes DESC, plays DESC, artist
    LIMIT :limit
),
top_albums AS (
    SELECT artist, album,
           SUM(minutes_listened) AS minutes,
           SUM(play_count)::integer AS plays
    FROM rng
    WHERE album != ''
    GROUP BY artist, album
    ORDER BY minutes DESC, plays DESC, album, artist
    LIMIT :limit
),
top_tracks AS (
    SELECT entity_key,
           MAX(track_id) AS track_id,
           (ARRAY_AGG(track_entity_uid) FILTER (WHERE track_entity_uid IS NOT NULL))[1]
               AS track_entity_uid,
           MAX(title) AS title,
           MAX(artist) AS artist,
           MAX(album) AS album,
           SUM(minutes_listened) AS minutes,
           SUM(play_count)::integer AS plays
    FROM rng
    WHERE entity_key != 'unknown-track'
    GROUP BY entity_key
    ORDER BY minutes DESC, plays DESC, MAX(title), entity_key
    LIMIT :limit
),
discovered AS (
    SELECT f.entity_key AS name, f.first_day,
           SUM(r.minutes_listened) AS minutes
    FROM {firsts_table} f
    JOIN rng r ON r.artist = f.entity_key
    WHERE {firsts_scope}f.entity_type = 'artist'
      AND f.first_day >= :start AND f.first_day <= :end
    GROUP BY f.entity_key, f.first_day
    ORDER BY minutes DESC, f.entity_key
    LIMIT {_DISCOVERY_LIMIT}
)
SELECT 'artist' AS kind, to_jsonb(x) AS item FROM (
    SELECT a.name AS artist_name, la.id AS artist_id, la.slug AS artist_slug,
           a.minutes, a.plays,
           CASE WHEN t.minutes > 0 THEN a.minutes / t.minutes ELSE 0 END AS share
    FROM top_artists a
    CROSS JOIN total t
    LEFT JOIN LATERAL (
        SELECT id, slug FROM library_artists
        WHERE lower(name) = lower(a.name) ORDER BY id LIMIT 1
    ) la ON TRUE
    ORDER BY a.minutes DESC, a.plays DESC, a.name
) x
UNION ALL
SELECT 'album', to_jsonb(x) FROM (
    SELECT b.album, b.artist, b.plays, b.minutes,
           alb.id AS album_id, alb.slug AS album_slug,
           gca.global_album_uid::text AS global_album_uid
    FROM top_albums b
    LEFT JOIN LATERAL (
        SELECT id, slug FROM library_albums
        WHERE artist = b.artist AND name = b.album ORDER BY id LIMIT 1
    ) alb ON TRUE
    LEFT JOIN LATERAL (
        SELECT global_album_uid FROM global_catalog_albums
        WHERE local_album_id = alb.id LIMIT 1
    ) gca ON alb.id IS NOT NULL
    ORDER BY b.minutes DESC, b.plays DESC, b.album, b.artist
) x
UNION ALL
SELECT 'track', to_jsonb(x) FROM (
    SELECT lt.id AS track_id,
           lt.path AS track_path, lt.entity_uid::text AS track_entity_uid,
           lt.format, lt.bitrate, lt.sample_rate, lt.bit_depth, lt.duration,
           lt.bpm, lt.audio_key, lt.audio_scale,
           COALESCE(lt.title, td.title) AS title,
           COALESCE(lt.artist, NULLIF(td.artist, '')) AS artist,
           COALESCE(lt.album, NULLIF(td.album, '')) AS album,
           alb.id AS album_id,
           alb.slug AS album_slug,
           gca.global_album_uid::text AS global_album_uid,
           art.id AS artist_id,
           art.slug AS artist_slug,
           td.plays, td.minutes
    FROM top_tracks td
    {_TRACK_REF_JOINS}
    ORDER BY td.minutes DESC, td.plays DESC, COALESCE(lt.title, td.title), td.entity_key
) x
UNION ALL
SELECT 'discovery', to_jsonb(x) FROM (
    SELECT d.name AS artist_name, la.id AS artist_id, la.slug AS artist_slug,
           d.first_day, d.minutes
    FROM discovered d
    LEFT JOIN LATERAL (
        SELECT id, slug FROM library_artists
        WHERE lower(name) = lower(d.name) ORDER BY id LIMIT 1
    ) la ON TRUE
    ORDER BY d.minutes DESC, d.name
) x
"""


_USER_RANGE_SQL = _range_sql("user_track_daily", "user_entity_firsts", scoped=True)
_INSTANCE_RANGE_SQL = _range_sql(
    "instance_track_daily", "instance_entity_firsts", scoped=False
)

_SECTIONS = {
    "artist": "top_artists",
    "album": "top_albums",
    "track": "top_tracks",
    "discovery": "discoveries",
}


class StatsRangeError(ValueError):
    """The requested stretch is inverted, in the future or too long."""


def validate_stats_range(start: date, end: date, *, today: date) -> None:
    """Raise ``StatsRangeError`` for an inverted, future or over-long stretch."""
    if end < start:
        raise StatsRangeError("end must not be before start")
    if end > today:
        raise StatsRangeError("end must not be in the future")
    if (end - start).days > MAX_RANGE_DAYS:
        raise StatsRangeError(f"range must not exceed {MAX_RANGE_DAYS} days")


def user_stats_today(user_id: int, *, session=None) -> date:
    """Today's date in the listener's stats timezone."""
    tz = user_stats_timezone(user_id, session=session)
    return datetime.now(ZoneInfo(tz)).date()


def _run_range(sql: str, params: dict, start: date, end: date, *, session=None) -> dict:
    def _impl(current) -> dict:
        rows = current.execute(text(sql), {"start": start, "end": end, **params}).all()
        payload: dict = {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "available": True,
            **{section: [] for section in _SECTIONS.values()},
        }
        for kind, item in rows:
            item = dict(item)
            if kind == "discovery":
                item["first_day"] = str(item["first_day"])
            payload[_SECTIONS[kind]].append(item)
        return payload

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_user_stats_range(
    user_id: int,
    start: date,
    end: date,
    *,
    limit: int = 3,
    session=None,
) -> dict:
    """Range summary for one listener, bounded by today in their timezone.

    Raises ``StatsRangeError`` before running the range query; the timezone
    lookup and the query share one read scope.
    """

    def _impl(current) -> dict:
        validate_stats_range(
            start, end, today=user_stats_today(user_id, session=current)
        )
        return _run_range(
            _USER_RANGE_SQL,
            {"user_id": user_id, "limit": limit},
            start,
            end,
            session=current,
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_public_user_stats_range(
    username: str,
    start: date,
    end: date,
    *,
    limit: int = 3,
    session=None,
) -> dict | None:
    """``get_user_stats_range`` for a public profile; ``None`` for an unknown user.

    The profile lookup uses the same visibility as the profile dashboard and
    runs in the range's read scope.
    """

    def _impl(current) -> dict | None:
        profile = get_public_user_profile_by_username(username, session=current)
        if not profile:
            return None
        return get_user_stats_range(
            int(profile["id"]), start, end, limit=limit, session=current
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def instance_stats_today() -> date:
    """The latest listener-local date anywhere, since instance days are listener-local."""
    return (datetime.now(ZoneInfo("UTC")) + timedelta(hours=14)).date()


def get_instance_stats_range(
    start: date,
    end: date,
    *,
    limit: int = 3,
    session=None,
) -> dict:
    """Same summary over every listener; empty until the rollups are complete.

    Bounded by today in UTC, the instance tape's day boundary; raises
    ``StatsRangeError`` before opening a scope.
    """
    validate_stats_range(start, end, today=instance_stats_today())

    def _empty(**flags) -> dict:
        return {
            "start": start.isoformat(),
            "end": end.isoformat(),
            **flags,
            **{section: [] for section in _SECTIONS.values()},
        }

    def _impl(current) -> dict:
        if instance_listening_rollups_incomplete(current):
            return _empty(available=False)
        listeners = current.execute(
            text(_RANGE_LISTENERS_SQL), {"start": start, "end": end}
        ).scalar_one()
        if listeners < MIN_RANGE_LISTENERS:
            return _empty(available=True, hidden_reason="few_listeners")
        return _run_range(
            _INSTANCE_RANGE_SQL, {"limit": limit}, start, end, session=current
        )

    if session is not None:
        return _impl(session)
    key = f"instance_stats_range:v1:{start.isoformat()}:{end.isoformat()}:{limit}"
    cached = get_volatile_cache(key, _INSTANCE_RANGE_CACHE_TTL)
    if cached is not None:
        return cached
    with read_scope() as current:
        result = _impl(current)
    if result["available"]:
        set_volatile_cache(key, result, _INSTANCE_RANGE_CACHE_TTL)
    return result
