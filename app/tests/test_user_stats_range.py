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


def test_range_preserves_live_source_quality_and_analysis(history):
    from crate.api.schemas.me import StatsRangeResponse

    first, last = _daily_bounds()
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET format='flac', bit_depth=24, sample_rate=96000, bitrate=1200, duration=191"
            )
        )
    payload = _range(first, last)
    track = StatsRangeResponse.model_validate(payload).top_tracks[0]
    assert track.format == "flac"
    assert (track.bit_depth, track.sample_rate, track.bitrate, track.duration) == (
        24,
        96000,
        1200,
        191,
    )
    assert track.bpm is not None
    assert track.track_path and track.track_entity_uid


@pytest.mark.parametrize(
    "kind", ["user", "month", "global", "global_month", "global_365d", "replay"]
)
def test_ranked_tracks_preserve_source_quality_in_each_period(history, kind):
    from crate.db.queries.user_library_stats_tops import get_top_tracks
    from crate.db.queries.user_library_stats_month import get_month_top_tracks
    from crate.db.queries.user_library_stats_global import get_global_top_tracks
    from crate.api.schemas.me import StatsTrackResponse

    _, last = _daily_bounds()
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET format='flac', bit_depth=24, sample_rate=96000, bitrate=1200, duration=191"
            )
        )
    if kind == "replay":
        from crate.db.queries.user_library_stats_tops import get_replay_mix

        tracks = get_replay_mix(1, window="all_time")["items"]
    elif kind == "user":
        tracks = get_top_tracks(1, window="all_time")
    elif kind == "month":
        tracks = get_month_top_tracks(1, last.strftime("%Y-%m"))
    elif kind == "global_month":
        tracks = get_global_top_tracks(month=last.strftime("%Y-%m"))
    elif kind == "global_365d":
        tracks = get_global_top_tracks(window="365d")
    else:
        tracks = get_global_top_tracks(window="all_time")
    assert tracks
    for row in tracks:
        track = StatsTrackResponse.model_validate(row)
        assert track.format == "flac"
        assert (track.bit_depth, track.sample_rate, track.bitrate, track.duration) == (
            24,
            96000,
            1200,
            191,
        )


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


@pytest.fixture
def opened_scopes(monkeypatch):
    """Count every read or write scope opened through ``crate.db.tx``."""
    from crate.db import tx

    real_factory = tx.get_session_factory
    opened: list[int] = []

    def counting_factory():
        opened.append(1)
        return real_factory()

    monkeypatch.setattr(tx, "get_session_factory", counting_factory)
    return opened


def _username(user_id: int) -> str:
    with read_scope() as session:
        return session.execute(
            text("SELECT username FROM users WHERE id = :id"), {"id": user_id}
        ).scalar_one()


@pytest.mark.parametrize(
    "route",
    ["/api/me/stats/range", "/api/users/{username}/stats/range", "/api/stats/range"],
)
def test_range_routes_open_one_read_scope(history, test_app, opened_scopes, route):
    path = route.format(username=_username(1))
    opened_scopes.clear()

    response = test_app.get(f"{path}?start=2026-09-01&end=2026-10-06&limit=5")

    assert response.status_code == 200, response.text[:300]
    assert len(opened_scopes) == 1


def test_user_range_validates_against_the_listeners_today(pg_db, monkeypatch):
    from crate.db.queries import user_library_stats_range as mod

    seen: list[int] = []

    def today_for(user_id, *, session=None):
        assert session is not None, "today must reuse the range scope"
        seen.append(user_id)
        return date(2026, 10, 21)

    monkeypatch.setattr(mod, "user_stats_today", today_for)
    ran: list[int] = []
    monkeypatch.setattr(mod, "_run_range", lambda *a, **kw: ran.append(1) or {})

    with pytest.raises(mod.StatsRangeError):
        mod.get_user_stats_range(1, date(2026, 10, 10), date(2026, 10, 22))
    with pytest.raises(mod.StatsRangeError):
        mod.get_user_stats_range(1, date(2025, 9, 15), date(2026, 10, 21))
    assert ran == []
    mod.get_user_stats_range(1, date(2025, 9, 16), date(2026, 10, 21))
    assert ran == [1]
    assert seen == [1, 1, 1]


def test_public_user_range_resolves_the_profile_in_the_same_scope(pg_db, monkeypatch):
    from crate.db.queries import user_library_stats_range as mod

    seen: list[int] = []

    def today_for(user_id, *, session=None):
        seen.append(user_id)
        return date(2026, 10, 21)

    monkeypatch.setattr(mod, "user_stats_today", today_for)

    assert (
        mod.get_public_user_stats_range(
            "nobody-here", date(2026, 10, 1), date(2026, 10, 21)
        )
        is None
    )
    assert seen == []
    payload = mod.get_public_user_stats_range(
        _username(1), date(2026, 10, 1), date(2026, 10, 21), limit=4
    )
    assert payload["available"] is True
    assert seen == [1]
    with pytest.raises(mod.StatsRangeError):
        mod.get_public_user_stats_range(
            _username(1), date(2026, 10, 10), date(2026, 10, 1)
        )


def test_instance_range_validates_against_the_utc_day(pg_db, monkeypatch):
    from crate.db.queries import user_library_stats_range as mod

    monkeypatch.setattr(mod, "instance_stats_today", lambda: date(2026, 10, 21))

    with pytest.raises(mod.StatsRangeError):
        mod.get_instance_stats_range(date(2026, 10, 10), date(2026, 10, 22))
    with pytest.raises(mod.StatsRangeError):
        mod.get_instance_stats_range(date(2025, 9, 15), date(2026, 10, 21))
    payload = mod.get_instance_stats_range(date(2025, 9, 16), date(2026, 10, 21))
    assert payload["start"] == "2025-09-16"


def test_range_does_not_offer_deleted_local_track_as_playable(pg_db):
    from crate.db.queries.user_library_stats_range import get_user_stats_range

    seed_listening_history(user_id=1, events=100, days=30)
    recompute_user_listening_aggregates(1)
    with read_scope() as session:
        first, last = session.execute(
            text("SELECT MIN(day),MAX(day) FROM user_track_daily WHERE user_id=1")
        ).one()
    before = get_user_stats_range(1, first, last, limit=20)
    removed = before["top_tracks"][0]
    track_id = removed["track_id"]
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_tracks WHERE id=:id"), {"id": track_id}
        )
    after = get_user_stats_range(1, first, last, limit=20)
    historical = next(
        row for row in after["top_tracks"] if row["title"] == removed["title"]
    )
    assert historical["track_id"] is None, (
        "The range still offers a deleted local id to its Play button"
    )
