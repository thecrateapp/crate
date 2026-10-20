"""Per-user listening range query behind the Stats explorer.

Reads only the per-day projections (``user_track_daily`` through its primary
key prefix, ``user_entity_firsts``); library joins resolve refs for the
returned rows only.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import text

from crate.db.queries.user_library_stats_signal import _TRACK_REF_JOINS
from crate.db.tx import read_scope

__all__ = ["MAX_RANGE_DAYS", "get_user_stats_range", "validate_stats_range"]

MAX_RANGE_DAYS = 400
_DISCOVERY_LIMIT = 10

_RANGE_SQL = f"""
WITH rng AS MATERIALIZED (
    SELECT day, entity_key, artist, album, track_id, track_entity_uid, title,
           play_count, minutes_listened
    FROM user_track_daily
    WHERE user_id = :user_id AND day >= :start AND day <= :end
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
    FROM user_entity_firsts f
    JOIN rng r ON r.artist = f.entity_key
    WHERE f.user_id = :user_id AND f.entity_type = 'artist'
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
    SELECT COALESCE(lt.id, td.track_id) AS track_id,
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

_SECTIONS = {
    "artist": "top_artists",
    "album": "top_albums",
    "track": "top_tracks",
    "discovery": "discoveries",
}


def validate_stats_range(start: date, end: date, *, today: date) -> None:
    """Raise ``ValueError`` for an inverted, future or over-long stretch."""
    if end < start:
        raise ValueError("end must not be before start")
    if end > today:
        raise ValueError("end must not be in the future")
    if (end - start).days > MAX_RANGE_DAYS:
        raise ValueError(f"range must not exceed {MAX_RANGE_DAYS} days")


def get_user_stats_range(
    user_id: int,
    start: date,
    end: date,
    *,
    limit: int = 3,
    session=None,
) -> dict:
    def _impl(current) -> dict:
        rows = current.execute(
            text(_RANGE_SQL),
            {"user_id": user_id, "start": start, "end": end, "limit": limit},
        ).all()
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
