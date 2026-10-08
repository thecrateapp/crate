"""Signal sections of the stats dashboard built from listening projections."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from crate.db.repositories.user_library_aggregate_runner import (
    recompute_user_listening_aggregates,
)
from tests.conftest import PG_AVAILABLE
from tests.stats_history import seed_listening_history

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _dashboard(window: str) -> dict:
    from crate.db.user_stats_dashboard_surface import build_user_stats_dashboard

    return build_user_stats_dashboard(
        user_id=1,
        window=window,
        month=None,
        tracks_limit=12,
        artists_limit=10,
        albums_limit=12,
        genres_limit=10,
        replay_limit=36,
    )


@pytest.fixture
def history(pg_db):
    end_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    seeded = seed_listening_history(events=3000, days=900, end_at=end_at)
    recompute_user_listening_aggregates(1)
    return seeded


def test_thirty_day_tape_is_zero_filled_daily(history):
    payload = _dashboard("30d")

    tape = payload["tape"]
    assert tape["granularity"] == "day"
    assert len(tape["points"]) == 30
    assert (
        sum(point["plays"] for point in tape["points"])
        == payload["overview"]["play_count"]
    )
    assert tape["mood"] and {"energy", "valence"} <= set(tape["mood"][0])
    assert {peak["kind"] for peak in tape["peaks"]} >= {"obsession", "longest_day"}
    assert payload["metrics_version"] == "listening-v1"
    assert payload["timezone"] == "UTC"
    assert payload["provisional"] is True


def test_calendar_year_window_scopes_every_section(history):
    year = datetime.now(timezone.utc).year
    payload = _dashboard(f"year:{year}")

    assert payload["window"] == f"year:{year}"
    assert payload["tape"]["start"] == f"{year}-01-01"
    assert payload["top_tracks"]["items"]
    assert payload["replay"]["title_key"] == "stats.replay.calendarYear.title"
    months = [month["month"] for month in payload["tape"]["months"]]
    assert months == sorted(months) and months[0].startswith(str(year))


def test_all_time_tape_switches_to_weekly_buckets(history):
    payload = _dashboard("all_time")

    assert payload["tape"]["granularity"] == "week"
    buckets = [point["bucket"] for point in payload["tape"]["points"]]
    assert len(buckets) > 100
    assert all(datetime.fromisoformat(bucket).weekday() == 0 for bucket in buckets)


def test_highlights_heatmap_and_music_age(history):
    payload = _dashboard("365d")

    highlights = payload["highlights"]
    assert highlights["artist_count"] == 6
    assert highlights["longest_streak"]["days"] >= 1
    assert highlights["longest_session"]["track_count"] >= 1
    assert highlights["obsession"]["plays"] > 1
    assert highlights["obsession"]["track"]["title"]
    assert highlights["new_artists"]["count"] >= 0

    heatmap = payload["heatmap"]
    assert len(heatmap["cells"]) == 7 and len(heatmap["cells"][0]) == 24
    assert heatmap["peak"] is not None
    assert 0 < heatmap["night_share"] <= 1

    music_age = payload["music_age"]
    assert 1990 <= music_age["median_year"] <= 2030
    assert sum(item["share"] for item in music_age["decades"]) == pytest.approx(
        1, abs=0.01
    )
    assert music_age["oldest_album"]["year"] == 1998

    artist = payload["artist_of_period"]
    assert artist["artist_name"] and artist["plays"] > 0
    assert artist["top_album"]["album"]

    assert payload["genre_trend"] and "delta_vs_previous" in payload["genre_trend"][0]


def test_unknown_windows_are_rejected(pg_db):
    from crate.db.user_stats_dashboard_surface import get_user_stats_dashboard

    with pytest.raises(ValueError):
        get_user_stats_dashboard(1, window="year:1900")


def test_artist_rank_needs_enough_listeners(pg_db):
    from sqlalchemy import text

    from crate.db.tx import transaction_scope

    _seed_artist_listeners(listeners=[50, 10, 9, 8, 7, 6], artist="Converge")
    payload = _dashboard("30d")
    assert payload["artist_of_period"]["artist_name"] == "Converge"
    assert payload["artist_of_period"]["listener_count"] == 6
    assert payload["artist_of_period"]["listener_top_percent"] == 17

    with transaction_scope() as session:
        session.execute(text("DELETE FROM user_artist_stats WHERE user_id > 3"))
    assert _dashboard("30d")["artist_of_period"]["listener_top_percent"] is None


def _seed_artist_listeners(*, listeners: list[int], artist: str) -> None:
    from sqlalchemy import text

    from crate.db.tx import transaction_scope

    end_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    seed_listening_history(events=200, days=20, end_at=end_at)
    recompute_user_listening_aggregates(1)
    with transaction_scope() as session:
        mine = session.execute(
            text(
                "SELECT play_count FROM user_artist_stats "
                "WHERE user_id = 1 AND stat_window = '30d' ORDER BY play_count DESC LIMIT 1"
            )
        ).scalar_one()
        session.execute(
            text(
                "UPDATE user_artist_stats SET play_count = :plays "
                "WHERE user_id = 1 AND stat_window = '30d' AND artist_name = :artist"
            ),
            {"plays": max(listeners[0], mine), "artist": artist},
        )
        for index, plays in enumerate(listeners[1:], start=2):
            session.execute(
                text(
                    "INSERT INTO users (id, email, name, role, password_hash, created_at) "
                    "VALUES (:id, :email, :email, 'user', 'x', NOW()) ON CONFLICT (id) DO NOTHING"
                ),
                {"id": 100 + index, "email": f"listener{index}@example.com"},
            )
            session.execute(
                text(
                    "INSERT INTO user_artist_stats (user_id, stat_window, artist_name, play_count, "
                    "complete_play_count, minutes_listened, first_played_at, last_played_at) "
                    "VALUES (:u, '30d', :artist, :plays, 0, 0, NOW(), NOW())"
                ),
                {"u": 100 + index, "artist": artist, "plays": plays},
            )
