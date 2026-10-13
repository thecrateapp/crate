"""Deterministic listening history for stats projection tests and benchmarks."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text

from crate.db.repositories.library_album_upserts import upsert_album
from crate.db.repositories.library_artist_upserts import upsert_artist
from crate.db.repositories.library_track_upserts import upsert_track
from crate.db.tx import read_scope, transaction_scope

_ARTISTS = (
    ("Converge", "Metalcore", ("1998", "2001", "2017")),
    ("Birds In Row", "Post-Hardcore", ("2015", "2022")),
    ("Black Curse", "Black Metal", ("2020", "2024")),
    ("Dredg", "Post-Rock", ("2002", "2005")),
    ("Alcala Norte", "Post-Punk", ("2024",)),
    ("High Vis", "Hardcore", ("2019", "2022")),
)
_TRACKS_PER_ALBUM = 4


@dataclass(frozen=True)
class ListeningHistory:
    user_id: int
    track_ids: list[int]
    event_count: int


def seed_stats_library() -> list[int]:
    for artist_index, (artist, genre, years) in enumerate(_ARTISTS):
        upsert_artist({"name": artist})
        for album_index, year in enumerate(years):
            album_name = f"{artist} Record {album_index + 1}"
            album_path = f"/music/{artist}/{album_name}"
            album_id = upsert_album(
                {
                    "artist": artist,
                    "name": album_name,
                    "path": album_path,
                    "year": year,
                    "genre": genre,
                }
            )
            for track_number in range(1, _TRACKS_PER_ALBUM + 1):
                upsert_track(
                    {
                        "album_id": album_id,
                        "artist": artist,
                        "album": album_name,
                        "filename": f"{track_number:02d}.flac",
                        "title": f"{artist} Song {album_index + 1}.{track_number}",
                        "track_number": track_number,
                        "format": "flac",
                        "genre": genre,
                        "year": year,
                        "duration": 180.0 + track_number * 20 + artist_index * 7,
                        "path": f"{album_path}/{track_number:02d}.flac",
                    }
                )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET energy = ((id * 37) % 100) / 100.0,
                    valence = ((id * 53) % 100) / 100.0,
                    danceability = ((id * 71) % 100) / 100.0,
                    bpm = 90 + (id * 13) % 90
                """
            )
        )
    with read_scope() as session:
        return [
            int(track_id)
            for track_id in session.execute(
                text("SELECT id FROM library_tracks ORDER BY id")
            ).scalars()
        ]


def seed_listening_history(
    *,
    user_id: int = 1,
    events: int = 500,
    days: int = 400,
    end_at: str = "2026-10-06T22:00:00+00:00",
    track_ids: list[int] | None = None,
) -> ListeningHistory:
    """Insert ``events`` plays spread over ``days`` days ending at ``end_at``.

    Distribution is deterministic: plays cluster at night, one track
    dominates, and a share of plays are skips. Inserts are a single
    set-based statement so 100k events seed in seconds.
    """
    track_ids = track_ids or seed_stats_library()
    with transaction_scope() as session:
        session.execute(
            text(
                """
                WITH tracks AS (
                    SELECT
                        lt.id,
                        lt.entity_uid,
                        lt.path,
                        lt.title,
                        lt.artist,
                        lt.album,
                        lt.duration,
                        ROW_NUMBER() OVER (ORDER BY lt.id) - 1 AS idx
                    FROM library_tracks lt
                    WHERE lt.id = ANY(:track_ids)
                ),
                plays AS (
                    SELECT n, ((n::bigint * 2654435761) % 4294967296) AS h
                    FROM generate_series(0, :events - 1) AS n
                ),
                shaped AS (
                    SELECT
                        p.n,
                        CAST(:end_at AS timestamptz)
                          - make_interval(days => (p.h % :days)::int)
                          - make_interval(hours => (
                              CASE WHEN p.h % 10 < 6 THEN (p.h / 7) % 4
                                   ELSE (p.h / 11) % 18 + 4 END
                            )::int)
                          - make_interval(mins => ((p.h / 13) % 60)::int) AS ended_at,
                        CASE WHEN p.h % 5 = 0 THEN 0
                             ELSE (p.h / 17) % :track_count END AS track_idx,
                        p.h % 9 = 0 AS skipped
                    FROM plays p
                )
                INSERT INTO user_play_events (
                    user_id, client_event_id, track_id, track_entity_uid, track_path,
                    title, artist, album, started_at, ended_at, played_seconds,
                    track_duration_seconds, completion_ratio, was_skipped,
                    was_completed, play_source_type, device_type, app_platform,
                    created_at
                )
                SELECT
                    :user_id,
                    'fixture-' || s.n,
                    t.id,
                    t.entity_uid,
                    t.path,
                    t.title,
                    t.artist,
                    t.album,
                    s.ended_at - make_interval(secs => CASE WHEN s.skipped THEN 30 ELSE t.duration END),
                    s.ended_at,
                    CASE WHEN s.skipped THEN 30 ELSE t.duration END,
                    t.duration,
                    CASE WHEN s.skipped THEN 30 / t.duration ELSE 1 END,
                    s.skipped,
                    NOT s.skipped,
                    'album',
                    'web',
                    'listen-web',
                    s.ended_at
                FROM shaped s
                JOIN tracks t ON t.idx = s.track_idx
                """
            ),
            {
                "user_id": user_id,
                "events": events,
                "days": days,
                "end_at": end_at,
                "track_ids": track_ids,
                "track_count": len(track_ids),
            },
        )
    return ListeningHistory(user_id=user_id, track_ids=track_ids, event_count=events)


__all__ = ["ListeningHistory", "seed_listening_history", "seed_stats_library"]
