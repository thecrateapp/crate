"""Per-user listening range query over the daily projections."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from crate.db.repositories.user_library_aggregate_runner import (
    recompute_user_listening_aggregates,
)
from crate.db.tx import read_scope, transaction_scope
from tests.conftest import PG_AVAILABLE
from tests.stats_history import seed_listening_history, seed_stats_library

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


@pytest.fixture
def history(pg_db):
    seed_listening_history(user_id=1, events=500, days=120)
    recompute_user_listening_aggregates(1)


def _range(start: date, end: date, **kwargs) -> dict:
    from crate.db.queries.user_library_stats_range import get_user_stats_range

    return get_user_stats_range(1, start, end, **kwargs)


def _daily_bounds() -> tuple[date, date]:
    with read_scope() as session:
        row = session.execute(
            text("SELECT MIN(day), MAX(day) FROM user_track_daily WHERE user_id = 1")
        ).one()
    return row[0], row[1]


def test_range_tops_are_ordered_and_shares_are_minute_shares(history):
    first, last = _daily_bounds()
    payload = _range(first, last)
    with read_scope() as session:
        total = session.execute(
            text(
                "SELECT SUM(minutes_listened) FROM user_track_daily "
                "WHERE user_id = 1 AND day BETWEEN :a AND :b"
            ),
            {"a": first, "b": last},
        ).scalar_one()

    assert payload["available"] is True
    assert payload["start"] == first.isoformat() and payload["end"] == last.isoformat()
    for key in ("top_artists", "top_albums", "top_tracks"):
        assert 0 < len(payload[key]) <= 3
        minutes = [item["minutes"] for item in payload[key]]
        assert minutes == sorted(minutes, reverse=True)
    top = payload["top_artists"][0]
    assert top["share"] == pytest.approx(top["minutes"] / total)
    assert top["artist_name"] and top["artist_id"] and top["artist_slug"]
    track = payload["top_tracks"][0]
    assert track["track_id"] and track["title"] and track["album_id"]
    assert payload["top_albums"][0]["album_id"]


def test_day_detail_only_contains_that_day(history):
    with read_scope() as session:
        day = session.execute(
            text(
                "SELECT day FROM user_track_daily WHERE user_id = 1 "
                "GROUP BY day ORDER BY COUNT(*) DESC, day LIMIT 1"
            )
        ).scalar_one()
        on_day = set(
            session.execute(
                text(
                    "SELECT track_id FROM user_track_daily "
                    "WHERE user_id = 1 AND day = :d"
                ),
                {"d": day},
            ).scalars()
        )

    payload = _range(day, day, limit=20)

    assert payload["top_tracks"]
    assert {item["track_id"] for item in payload["top_tracks"]} <= on_day


def test_discoveries_are_artists_first_heard_inside_the_range(history):
    first, last = _daily_bounds()
    start = first + timedelta(days=30)
    payload = _range(start, last)
    with read_scope() as session:
        expected = set(
            session.execute(
                text(
                    "SELECT entity_key FROM user_entity_firsts WHERE user_id = 1 "
                    "AND entity_type = 'artist' AND first_day BETWEEN :a AND :b"
                ),
                {"a": start, "b": last},
            ).scalars()
        )

    assert len(payload["discoveries"]) <= 10
    assert {item["artist_name"] for item in payload["discoveries"]} <= expected
    for item in payload["discoveries"]:
        assert start.isoformat() <= item["first_day"] <= last.isoformat()
        assert item["minutes"] > 0
    assert _range(first, last)["discoveries"]


def test_validate_rejects_inverted_future_and_too_long_ranges():
    from crate.db.queries.user_library_stats_range import (
        MAX_RANGE_DAYS,
        validate_stats_range,
    )

    today = date(2026, 10, 21)
    validate_stats_range(today - timedelta(days=MAX_RANGE_DAYS), today, today=today)
    validate_stats_range(today, today, today=today)
    with pytest.raises(ValueError):
        validate_stats_range(
            today - timedelta(days=MAX_RANGE_DAYS + 1), today, today=today
        )
    with pytest.raises(ValueError):
        validate_stats_range(today, today - timedelta(days=1), today=today)
    with pytest.raises(ValueError):
        validate_stats_range(today, today + timedelta(days=1), today=today)


def test_empty_range_returns_empty_lists(history):
    payload = _range(date(2000, 1, 1), date(2000, 1, 2))

    assert payload["top_artists"] == [] and payload["discoveries"] == []
    assert payload["top_albums"] == [] and payload["top_tracks"] == []


def test_range_days_follow_user_timezone(pg_db):
    track_id = seed_stats_library()[0]
    with transaction_scope() as session:
        session.execute(
            text("UPDATE users SET timezone = 'Pacific/Kiritimati' WHERE id = 1")
        )
    with read_scope() as session:
        track = (
            session.execute(
                text("SELECT title, artist, album FROM library_tracks WHERE id = :id"),
                {"id": track_id},
            )
            .mappings()
            .one()
        )
    ended = datetime(2026, 10, 6, 23, 30, tzinfo=timezone.utc)
    pg_db.record_play_event(
        1,
        client_event_id="tz-1",
        track_id=track_id,
        title=track["title"],
        artist=track["artist"],
        album=track["album"],
        started_at=(ended - timedelta(seconds=200)).isoformat(),
        ended_at=ended.isoformat(),
        played_seconds=200.0,
        track_duration_seconds=200.0,
        completion_ratio=1.0,
        was_skipped=False,
        was_completed=True,
        play_source_type="album",
        device_type="web",
        app_platform="listen-web",
    )
    recompute_user_listening_aggregates(1)

    utc_day = _range(date(2026, 10, 6), date(2026, 10, 6))
    local_day = _range(date(2026, 10, 7), date(2026, 10, 7))

    assert utc_day["top_tracks"] == []
    assert [item["track_id"] for item in local_day["top_tracks"]] == [track_id]
