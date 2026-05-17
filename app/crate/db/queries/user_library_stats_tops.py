from __future__ import annotations

from collections import Counter
from datetime import date, datetime

from sqlalchemy import text

from crate.db.queries.user_library_shared import normalize_stats_window
from crate.db.tx import read_scope


def get_top_tracks(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    uts.track_id,
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
                    uts.first_played_at,
                    uts.last_played_at
                FROM user_track_stats uts
                LEFT JOIN library_tracks lt
                  ON lt.id = uts.track_id
                  OR (uts.track_id IS NULL AND uts.track_entity_uid IS NOT NULL AND lt.entity_uid = uts.track_entity_uid)
                LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
                LEFT JOIN library_albums alb_by_name
                  ON alb_by_id.id IS NULL
                 AND alb_by_name.artist = COALESCE(lt.artist, uts.artist)
                 AND alb_by_name.name = COALESCE(lt.album, uts.album)
                LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, uts.artist)
                WHERE uts.user_id = :user_id AND uts.stat_window = :window
                ORDER BY uts.play_count DESC, uts.minutes_listened DESC, uts.last_played_at DESC
                LIMIT :lim
                """
                ),
                {"user_id": user_id, "window": normalized, "lim": limit},
            )
            .mappings()
            .all()
        )
    payload = [dict(row) for row in rows]
    for item in payload:
        if item.get("bliss_vector") is not None:
            item["bliss_vector"] = list(item["bliss_vector"])
    return payload


def get_top_artists(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    uas.artist_name,
                    la.id AS artist_id,
                    la.slug AS artist_slug,
                    play_count,
                    complete_play_count,
                    minutes_listened,
                    first_played_at,
                    last_played_at
                FROM user_artist_stats uas
                LEFT JOIN library_artists la ON la.name = uas.artist_name
                WHERE uas.user_id = :user_id AND uas.stat_window = :window
                ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
                LIMIT :lim
                """
                ),
                {"user_id": user_id, "window": normalized, "lim": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_top_albums(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
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
                    uas.play_count,
                    uas.complete_play_count,
                    uas.minutes_listened,
                    uas.first_played_at,
                    uas.last_played_at
                FROM user_album_stats uas
                LEFT JOIN library_albums alb ON alb.artist = uas.artist AND alb.name = uas.album
                LEFT JOIN library_artists art ON art.name = uas.artist
                WHERE uas.user_id = :user_id AND uas.stat_window = :window
                ORDER BY uas.play_count DESC, uas.minutes_listened DESC, uas.last_played_at DESC
                LIMIT :lim
                """
                ),
                {"user_id": user_id, "window": normalized, "lim": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_top_genres(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    genre_name,
                    play_count,
                    complete_play_count,
                    minutes_listened,
                    first_played_at,
                    last_played_at
                FROM user_genre_stats
                WHERE user_id = :user_id AND stat_window = :window
                ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
                LIMIT :lim
                """
                ),
                {"user_id": user_id, "window": normalized, "lim": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_replay_mix(user_id: int, window: str = "30d", limit: int = 30) -> dict:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                WITH ranked AS (
                    SELECT
                        uts.track_id,
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
                        uts.first_played_at,
                        uts.last_played_at,
                        ROW_NUMBER() OVER (
                            PARTITION BY COALESCE(lt.artist, uts.artist)
                            ORDER BY uts.play_count DESC, uts.minutes_listened DESC, uts.last_played_at DESC
                        ) AS artist_rank
                    FROM user_track_stats uts
                    LEFT JOIN library_tracks lt
                      ON lt.id = uts.track_id
                      OR (uts.track_id IS NULL AND uts.track_entity_uid IS NOT NULL AND lt.entity_uid = uts.track_entity_uid)
                    LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
                    LEFT JOIN library_albums alb_by_name
                      ON alb_by_id.id IS NULL
                     AND alb_by_name.artist = COALESCE(lt.artist, uts.artist)
                     AND alb_by_name.name = COALESCE(lt.album, uts.album)
                    LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, uts.artist)
                    WHERE uts.user_id = :user_id AND uts.stat_window = :window
                )
                SELECT *
                FROM ranked
                WHERE artist_rank <= 4
                ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
                LIMIT :lim
                """
                ),
                {"user_id": user_id, "window": normalized, "lim": limit},
            )
            .mappings()
            .all()
        )

    items = [dict(row) for row in rows]
    for item in items:
        item.pop("artist_rank", None)
        if item.get("bliss_vector") is not None:
            item["bliss_vector"] = list(item["bliss_vector"])

    if normalized == "7d":
        title = "Your last 7 days"
        subtitle = "A quick replay of the week so far."
    elif normalized == "30d":
        title = "Replay this month"
        subtitle = "The tracks that defined your last 30 days."
    elif normalized == "90d":
        title = "Replay this season"
        subtitle = "The songs you've kept coming back to lately."
    elif normalized == "365d":
        title = "Replay this year"
        subtitle = "A long-view mix from your past year."
    else:
        title = "All-time replay"
        subtitle = "Your enduring favorites across the whole library."

    total_minutes = round(
        sum(float(item.get("minutes_listened") or 0) for item in items), 1
    )

    return {
        "window": normalized,
        "title": title,
        "subtitle": subtitle,
        "track_count": len(items),
        "minutes_listened": total_minutes,
        "items": items,
    }


def _coerce_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _history_subtitle(top_artists: list[str]) -> str:
    if not top_artists:
        return "Your most played music from this period."
    if len(top_artists) <= 3:
        return ", ".join(top_artists)
    return f"{top_artists[0]}, {top_artists[1]}, {top_artists[2]} and more"


def _get_all_time_history_card(user_id: int) -> dict | None:
    with read_scope() as session:
        totals = (
            session.execute(
                text(
                    """
                    SELECT
                        COUNT(*)::integer AS play_count,
                        COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened
                    FROM user_play_events
                    WHERE user_id = :user_id
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
        if not totals or int(totals.get("play_count") or 0) <= 0:
            return None

        artist_rows = (
            session.execute(
                text(
                    """
                    SELECT COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS artist_name
                    FROM user_play_events
                    WHERE user_id = :user_id
                      AND COALESCE(NULLIF(TRIM(artist), ''), '') <> ''
                    GROUP BY 1
                    ORDER BY COUNT(*) DESC, COALESCE(SUM(played_seconds), 0) DESC, artist_name
                    LIMIT 5
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
                            art.entity_uid::text AS artist_entity_uid,
                            art.slug AS artist_slug,
                            COALESCE(alb_by_id.id, alb_by_name.id) AS album_id,
                            COALESCE(alb_by_id.entity_uid::text, alb_by_name.entity_uid::text) AS album_entity_uid,
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
                        LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
                        LEFT JOIN library_albums alb_by_name
                          ON alb_by_id.id IS NULL
                         AND alb_by_name.artist = COALESCE(lt.artist, upe.artist)
                         AND alb_by_name.name = COALESCE(lt.album, upe.album)
                        LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, upe.artist)
                        WHERE upe.user_id = :user_id
                          AND COALESCE(NULLIF(TRIM(COALESCE(lt.artist, upe.artist)), ''), '') <> ''
                          AND COALESCE(NULLIF(TRIM(COALESCE(lt.album, upe.album)), ''), '') <> ''
                        GROUP BY
                            COALESCE(lt.id, upe.track_id),
                            COALESCE(lt.entity_uid::text, upe.track_entity_uid::text),
                            COALESCE(lt.path, upe.track_path),
                            COALESCE(lt.title, upe.title),
                            COALESCE(lt.artist, upe.artist),
                            COALESCE(lt.album, upe.album),
                            art.id,
                            art.entity_uid::text,
                            art.slug,
                            COALESCE(alb_by_id.id, alb_by_name.id),
                            COALESCE(alb_by_id.entity_uid::text, alb_by_name.entity_uid::text),
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

    top_artists = [
        str(row.get("artist_name") or "").strip()
        for row in artist_rows
        if str(row.get("artist_name") or "").strip()
    ]
    return {
        "id": "all-time",
        "kind": "all_time",
        "title": "My Most Listened",
        "period_label": "MY MOST LISTENED",
        "period_start": "all_time",
        "subtitle": _history_subtitle(top_artists),
        "top_artists": top_artists,
        "play_count": int(totals.get("play_count") or 0),
        "minutes_listened": round(float(totals.get("minutes_listened") or 0), 1),
        "artwork_tracks": [dict(row) for row in cover_rows],
    }


def get_listening_history_cards(user_id: int, limit: int = 8) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    upe.ended_at,
                    COALESCE(lt.title, upe.title) AS title,
                    COALESCE(lt.artist, upe.artist) AS artist,
                    COALESCE(lt.album, upe.album) AS album,
                    art.id AS artist_id,
                    art.entity_uid::text AS artist_entity_uid,
                    art.slug AS artist_slug,
                    COALESCE(alb_by_id.id, alb_by_name.id) AS album_id,
                    COALESCE(alb_by_id.entity_uid::text, alb_by_name.entity_uid::text) AS album_entity_uid,
                    COALESCE(alb_by_id.slug, alb_by_name.slug) AS album_slug,
                    COALESCE(upe.played_seconds, 0) AS played_seconds
                FROM user_play_events upe
                LEFT JOIN library_tracks lt
                  ON lt.id = upe.track_id
                  OR (upe.track_id IS NULL AND upe.track_entity_uid IS NOT NULL AND lt.entity_uid = upe.track_entity_uid)
                LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
                LEFT JOIN library_albums alb_by_name
                  ON alb_by_id.id IS NULL
                 AND alb_by_name.artist = COALESCE(lt.artist, upe.artist)
                 AND alb_by_name.name = COALESCE(lt.album, upe.album)
                LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, upe.artist)
                WHERE upe.user_id = :user_id
                  AND upe.ended_at >= NOW() - INTERVAL '395 days'
                ORDER BY upe.ended_at DESC
                LIMIT :row_limit
                """
                ),
                {"user_id": user_id, "row_limit": 5000},
            )
            .mappings()
            .all()
        )

    buckets: dict[tuple[int, int], dict] = {}
    for row in rows:
        played_at = _coerce_datetime(row.get("ended_at"))
        if not played_at:
            continue
        key = (played_at.year, played_at.month)
        bucket = buckets.setdefault(
            key,
            {
                "period_start": date(played_at.year, played_at.month, 1),
                "artist_counts": Counter(),
                "play_count": 0,
                "minutes_listened": 0.0,
                "artwork_tracks": [],
                "seen_albums": set(),
            },
        )
        artist = (row.get("artist") or "").strip()
        album = (row.get("album") or "").strip()
        if artist:
            bucket["artist_counts"][artist] += 1
        bucket["play_count"] += 1
        bucket["minutes_listened"] += float(row.get("played_seconds") or 0) / 60
        album_key = row.get("album_id") or (artist.lower(), album.lower())
        if (
            artist
            and album
            and album_key not in bucket["seen_albums"]
            and len(bucket["artwork_tracks"]) < 4
        ):
            bucket["seen_albums"].add(album_key)
            bucket["artwork_tracks"].append(
                {
                    "title": row.get("title") or "",
                    "artist": artist,
                    "artist_id": row.get("artist_id"),
                    "artist_entity_uid": row.get("artist_entity_uid"),
                    "artist_slug": row.get("artist_slug"),
                    "album": album,
                    "album_id": row.get("album_id"),
                    "album_entity_uid": row.get("album_entity_uid"),
                    "album_slug": row.get("album_slug"),
                }
            )

    cards: list[dict] = []
    all_time_card = _get_all_time_history_card(user_id)
    if all_time_card:
        cards.append(all_time_card)
    for (year, month), bucket in sorted(buckets.items(), reverse=True):
        top_artists = [artist for artist, _ in bucket["artist_counts"].most_common(5)]
        period_start = bucket["period_start"]
        month_name = period_start.strftime("%B")
        cards.append(
            {
                "id": f"month-{year}-{month:02d}",
                "kind": "month",
                "title": f"{month_name} {year}",
                "period_label": month_name.upper(),
                "period_start": period_start.isoformat(),
                "subtitle": _history_subtitle(top_artists),
                "top_artists": top_artists,
                "play_count": bucket["play_count"],
                "minutes_listened": round(bucket["minutes_listened"], 1),
                "artwork_tracks": bucket["artwork_tracks"],
            }
        )
        if len(cards) >= limit:
            break
    return cards


__all__ = [
    "get_listening_history_cards",
    "get_replay_mix",
    "get_top_albums",
    "get_top_artists",
    "get_top_genres",
    "get_top_tracks",
]
