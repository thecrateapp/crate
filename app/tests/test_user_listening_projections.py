"""Incremental listening projections must match a full rebuild."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from crate.db.repositories.user_library_aggregate_runner import (
    recompute_user_listening_aggregates,
    refresh_user_listening_aggregates,
)
from crate.db.tx import read_scope, transaction_scope
from tests.conftest import PG_AVAILABLE
from tests.stats_history import seed_listening_history

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

_TABLES = {
    "user_daily_listening": "day",
    "user_hourly_listening": "day, hour",
    "user_track_daily": "day, entity_key, artist, album",
    "user_entity_firsts": "entity_type, entity_key",
    "user_listening_sessions": "started_at",
    "user_track_stats": "stat_window, entity_key",
    "user_artist_stats": "stat_window, artist_name",
    "user_album_stats": "stat_window, entity_key",
    "user_genre_stats": "stat_window, genre_name",
}


def _snapshot(user_id: int = 1) -> dict:
    snapshot = {}
    with read_scope() as session:
        for table, order in _TABLES.items():
            rows = (
                session.execute(
                    text(f"SELECT * FROM {table} WHERE user_id = :u ORDER BY {order}"),
                    {"u": user_id},
                )
                .mappings()
                .all()
            )
            snapshot[table] = [
                {
                    key: round(value, 6) if isinstance(value, float) else value
                    for key, value in row.items()
                }
                for row in rows
            ]
    return snapshot


def _set_timezone(tz: str | None, user_id: int = 1) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE users SET timezone = :tz WHERE id = :u"),
            {"tz": tz, "u": user_id},
        )


def _play(pg_db, track_id: int, ended_at: str, seconds: float = 200.0, n: int = 0):
    from datetime import datetime, timedelta

    ended = datetime.fromisoformat(ended_at)
    with read_scope() as session:
        track = (
            session.execute(
                text("SELECT title, artist, album FROM library_tracks WHERE id = :id"),
                {"id": track_id},
            )
            .mappings()
            .one()
        )
    return pg_db.record_play_event(
        1,
        client_event_id=f"live-{ended_at}-{n}",
        track_id=track_id,
        title=track["title"],
        artist=track["artist"],
        album=track["album"],
        started_at=(ended - timedelta(seconds=seconds)).isoformat(),
        ended_at=ended_at,
        played_seconds=seconds,
        track_duration_seconds=seconds,
        completion_ratio=1.0,
        was_skipped=False,
        was_completed=True,
        play_source_type="album",
        device_type="web",
        app_platform="listen-web",
    )


def test_incremental_refresh_matches_a_full_rebuild(pg_db):
    _set_timezone("Europe/Madrid")
    history = seed_listening_history(events=600, days=90)
    recompute_user_listening_aggregates(1)

    track_a, track_b = history.track_ids[0], history.track_ids[5]
    for n, ended_at in enumerate(
        [
            "2026-10-06T21:40:00+00:00",
            "2026-10-06T22:20:00+00:00",
            "2026-09-12T23:30:00+00:00",
            "2026-07-01T10:00:00+00:00",
        ]
    ):
        _play(pg_db, track_a if n % 2 else track_b, ended_at, n=n)

    result = refresh_user_listening_aggregates(1)
    assert result["mode"] == "incremental"
    assert result["days"] == ["2026-07-01", "2026-09-13", "2026-10-06", "2026-10-07"]
    incremental = _snapshot()

    recompute_user_listening_aggregates(1)
    assert _snapshot() == incremental


def test_days_and_hours_follow_the_user_timezone(pg_db):
    _set_timezone("America/Los_Angeles")
    history = seed_listening_history(events=1, days=1)
    with transaction_scope() as session:
        session.execute(text("DELETE FROM user_play_events WHERE user_id = 1"))
    _play(pg_db, history.track_ids[0], "2026-04-02T05:30:00+00:00")
    recompute_user_listening_aggregates(1)

    with read_scope() as session:
        hourly = session.execute(
            text("SELECT day::text, hour FROM user_hourly_listening WHERE user_id = 1")
        ).all()
    assert [tuple(row) for row in hourly] == [("2026-04-01", 22)]


def test_dst_change_keeps_local_days(pg_db):
    _set_timezone("Europe/Madrid")
    history = seed_listening_history(events=1, days=1)
    with transaction_scope() as session:
        session.execute(text("DELETE FROM user_play_events WHERE user_id = 1"))
    _play(pg_db, history.track_ids[0], "2026-03-28T23:30:00+00:00")
    _play(pg_db, history.track_ids[0], "2026-10-24T22:30:00+00:00", n=1)
    recompute_user_listening_aggregates(1)

    with read_scope() as session:
        rows = session.execute(
            text(
                "SELECT day::text, hour FROM user_hourly_listening WHERE user_id = 1 ORDER BY day"
            )
        ).all()
    assert [tuple(row) for row in rows] == [("2026-03-29", 0), ("2026-10-25", 0)]


def test_changing_the_timezone_triggers_a_rebuild(pg_db):
    seed_listening_history(events=50, days=10)
    assert refresh_user_listening_aggregates(1)["mode"] == "rebuild"
    assert refresh_user_listening_aggregates(1)["mode"] == "incremental"

    _set_timezone("Asia/Tokyo")

    result = refresh_user_listening_aggregates(1)
    assert result == {"mode": "rebuild", "timezone": "Asia/Tokyo", "days": None}


def test_sessions_split_on_thirty_minute_gaps(pg_db):
    history = seed_listening_history(events=1, days=1)
    with transaction_scope() as session:
        session.execute(text("DELETE FROM user_play_events WHERE user_id = 1"))
    track = history.track_ids[0]
    for n, ended_at in enumerate(
        [
            "2026-05-01T10:00:00+00:00",
            "2026-05-01T10:13:00+00:00",
            "2026-05-01T10:35:00+00:00",
            "2026-05-01T12:00:00+00:00",
        ]
    ):
        _play(pg_db, track, ended_at, seconds=180, n=n)
    recompute_user_listening_aggregates(1)

    with read_scope() as session:
        sessions = session.execute(
            text(
                "SELECT track_count FROM user_listening_sessions WHERE user_id = 1 ORDER BY started_at"
            )
        ).scalars()
        assert list(sessions) == [3, 1]


def test_first_plays_track_discovery_days(pg_db):
    _set_timezone("UTC")
    history = seed_listening_history(events=1, days=1)
    with transaction_scope() as session:
        session.execute(text("DELETE FROM user_play_events WHERE user_id = 1"))
    _play(pg_db, history.track_ids[0], "2026-02-03T12:00:00+00:00")
    _play(pg_db, history.track_ids[0], "2026-01-03T12:00:00+00:00", n=1)
    recompute_user_listening_aggregates(1)

    with read_scope() as session:
        first_day = session.execute(
            text(
                "SELECT first_day::text FROM user_entity_firsts "
                "WHERE user_id = 1 AND entity_type = 'artist'"
            )
        ).scalar_one()
    assert first_day == "2026-01-03"


def test_concurrent_first_builds_for_one_user_do_not_collide(pg_db):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from crate.db.repositories.user_library_aggregate_runner import (
        ensure_user_listening_aggregates,
    )

    seed_listening_history(events=600, days=90)
    workers = 4
    barrier = Barrier(workers)

    def _ensure() -> None:
        barrier.wait()
        ensure_user_listening_aggregates(1)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for future in [pool.submit(_ensure) for _ in range(workers)]:
            future.result()

    built = _snapshot()
    recompute_user_listening_aggregates(1)
    assert _snapshot() == built
