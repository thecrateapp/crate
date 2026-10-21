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
    for item in music_age["decades"]:
        top = item["top_album"]
        assert top is not None
        assert item["decade"] <= top["year"] < item["decade"] + 10
        assert top["album_id"] and top["album"]

    artist = payload["artist_of_period"]
    assert artist["artist_name"] and artist["plays"] > 0
    assert artist["top_album"]["album"]

    assert payload["genre_trend"] and "delta_vs_previous" in payload["genre_trend"][0]


def test_unknown_windows_are_rejected(pg_db):
    from crate.db.user_stats_dashboard_surface import get_user_stats_dashboard

    with pytest.raises(ValueError):
        get_user_stats_dashboard(1, window="year:1900")


def test_music_age_reports_newest_and_current_year_share(history):
    music_age = _dashboard("year:2024")["music_age"]

    assert music_age["newest_album"]["year"] == 2024
    assert music_age["newest_album"]["album_id"] and music_age["newest_album"]["album"]
    assert music_age["oldest_album"]["year"] <= music_age["newest_album"]["year"]
    assert 0 < music_age["share_this_year"] <= 1

    rolling = _dashboard("365d")["music_age"]
    assert rolling["newest_album"]["year"] == 2024
    # No release in the library is from the period's last year (2026).
    assert rolling["share_this_year"] == 0


def test_heatmap_exposes_night_hours(history):
    heatmap = _dashboard("365d")["heatmap"]

    assert heatmap["night_hours"] == [22, 23, 0, 1, 2, 3, 4, 5]
    assert heatmap["listener_count"] is None


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


def test_overview_previous_totals_match_daily_rows(history):
    from sqlalchemy import text

    from crate.db.queries.user_stats_periods import (
        previous_window,
        resolve_stats_period,
    )
    from crate.db.tx import read_scope

    payload = _dashboard("30d")
    previous = payload["overview"]["previous"]
    period = resolve_stats_period("UTC", window="30d")
    start, end = previous_window(period)
    assert (previous["start"], previous["end"]) == (start.isoformat(), end.isoformat())

    with read_scope() as session:
        row = session.execute(
            text(
                "SELECT COALESCE(SUM(minutes_listened), 0) AS minutes,"
                " COALESCE(SUM(play_count), 0) AS plays,"
                " COUNT(DISTINCT day) AS days FROM user_daily_listening"
                " WHERE user_id = 1 AND day BETWEEN :s AND :e"
            ),
            {"s": start, "e": end},
        ).one()
        artists = session.execute(
            text(
                "SELECT COUNT(DISTINCT artist) FROM user_track_daily"
                " WHERE user_id = 1 AND artist != '' AND day BETWEEN :s AND :e"
            ),
            {"s": start, "e": end},
        ).scalar_one()
    assert row.plays > 0
    assert previous["play_count"] == row.plays
    assert previous["minutes_listened"] == pytest.approx(row.minutes)
    assert previous["active_days"] == row.days
    assert previous["artist_count"] == artists


def test_overview_previous_is_absent_for_all_time(history):
    assert _dashboard("all_time")["overview"]["previous"] is None


def _play_new_track_yesterday() -> None:
    from sqlalchemy import text

    from crate.db.repositories.library_album_upserts import upsert_album
    from crate.db.repositories.library_artist_upserts import upsert_artist
    from crate.db.repositories.library_track_upserts import upsert_track
    from crate.db.tx import transaction_scope

    upsert_artist({"name": "Fresh Face"})
    album_id = upsert_album(
        {
            "artist": "Fresh Face",
            "name": "Fresh Record",
            "path": "/music/Fresh Face/Fresh Record",
            "year": "2026",
            "genre": "Shoegaze",
        }
    )
    upsert_track(
        {
            "album_id": album_id,
            "artist": "Fresh Face",
            "album": "Fresh Record",
            "filename": "01.flac",
            "title": "Fresh Song",
            "track_number": 1,
            "format": "flac",
            "genre": "Shoegaze",
            "year": "2026",
            "duration": 200.0,
            "path": "/music/Fresh Face/Fresh Record/01.flac",
        }
    )
    ended = datetime.now(timezone.utc) - timedelta(hours=26)
    with transaction_scope() as session:
        track_id = session.execute(
            text("SELECT id FROM library_tracks WHERE title = 'Fresh Song'")
        ).scalar_one()
        for index in range(40):
            session.execute(
                text(
                    """
                    INSERT INTO user_play_events (
                        user_id, client_event_id, track_id, track_entity_uid,
                        track_path, title, artist, album, started_at, ended_at,
                        played_seconds, track_duration_seconds, completion_ratio,
                        was_skipped, was_completed, play_source_type, device_type,
                        app_platform, created_at
                    )
                    SELECT 1, 'fresh-' || :i, lt.id, lt.entity_uid, lt.path,
                           lt.title, lt.artist, lt.album,
                           CAST(:ended AS timestamptz) - interval '200 seconds',
                           CAST(:ended AS timestamptz), 200, 200, 1, false, true,
                           'album', 'web', 'listen-web', CAST(:ended AS timestamptz)
                    FROM library_tracks lt WHERE lt.id = :track_id
                    """
                ),
                {"i": index, "ended": ended, "track_id": track_id},
            )


def test_top_items_flag_entities_first_heard_in_period(history):
    _play_new_track_yesterday()
    recompute_user_listening_aggregates(1)

    payload = _dashboard("30d")

    tracks = {item["title"]: item["is_new"] for item in payload["top_tracks"]["items"]}
    artists = {
        item["artist_name"]: item["is_new"] for item in payload["top_artists"]["items"]
    }
    albums = {item["album"]: item["is_new"] for item in payload["top_albums"]["items"]}
    assert tracks["Fresh Song"] is True
    assert artists["Fresh Face"] is True
    assert albums["Fresh Record"] is True
    older = [name for name in artists if name != "Fresh Face"]
    assert older and not any(artists[name] for name in older)
    assert not any(is_new for title, is_new in tracks.items() if title != "Fresh Song")

    year = datetime.now(timezone.utc).year
    year_items = _dashboard(f"year:{year}")["top_artists"]["items"]
    assert year_items and all("is_new" in item for item in year_items)


def test_all_time_marks_nothing_new(history):
    _play_new_track_yesterday()
    recompute_user_listening_aggregates(1)

    payload = _dashboard("all_time")

    items = (
        payload["top_tracks"]["items"]
        + payload["top_artists"]["items"]
        + payload["top_albums"]["items"]
    )
    assert items and all(item["is_new"] is False for item in items)


def test_audio_profile_previous_uses_previous_window(history):
    from sqlalchemy import text

    from crate.db.queries.user_stats_periods import (
        previous_window,
        resolve_stats_period,
    )
    from crate.db.tx import read_scope

    payload = _dashboard("30d")
    previous = payload["story"]["audio_profile_previous"]
    period = resolve_stats_period("UTC", window="30d")
    first, last = previous_window(period)
    with read_scope() as session:
        expected = session.execute(
            text(
                """
                SELECT SUM(lt.energy * td.play_count) / SUM(td.play_count) AS energy
                FROM user_track_daily td
                JOIN library_tracks lt ON lt.id = td.track_id
                WHERE td.user_id = 1 AND td.day BETWEEN :first AND :last
                """
            ),
            {"first": first, "last": last},
        ).scalar_one()
    assert previous is not None
    assert previous["energy"] == pytest.approx(float(expected))
    assert set(previous) == set(payload["story"]["audio_profile"])

    assert _dashboard("all_time")["story"]["audio_profile_previous"] is None


def _share(name: str, share: float) -> dict:
    return {"genre_name": name, "slug": name.lower(), "share": share}


def _period():
    from datetime import date

    from crate.db.queries.user_stats_periods import StatsPeriod

    return StatsPeriod(
        key="30d",
        start=date(2026, 9, 21),
        end=date(2026, 10, 21),
        previous_start=date(2026, 8, 22),
        timezone="UTC",
        today=date(2026, 10, 20),
    )


def _trend(monkeypatch, current: list[dict], previous: list[dict]):
    from crate.db.queries import user_library_stats_signal as signal

    calls = iter([current, previous])
    monkeypatch.setattr(signal, "_genre_shares", lambda *args, **kwargs: next(calls))
    return signal._genre_trend(None, 1, _period())


def test_genre_trend_appends_the_biggest_faller_beyond_the_top_six(monkeypatch):
    current = [_share(f"G{i}", 0.2 - i * 0.02) for i in range(6)] + [
        _share("Seventh", 0.03),
        _share("Eighth", 0.02),
    ]
    previous = [_share(f"G{i}", 0.2 - i * 0.02) for i in range(6)] + [
        _share("Seventh", 0.10),
        _share("Eighth", 0.02),
        _share("Gone", 0.12),
    ]

    trend = _trend(monkeypatch, current, previous)

    assert len(trend) == 7
    assert not any(item.get("faller") for item in trend[:6])
    faller = trend[-1]
    assert faller["faller"] is True
    assert faller["genre_name"] == "Gone"
    assert faller["slug"] == "gone"
    assert faller["share"] == 0.0
    assert faller["delta_vs_previous"] == -0.12


def test_genre_trend_picks_a_remaining_current_genre_as_faller(monkeypatch):
    current = [_share(f"G{i}", 0.2 - i * 0.02) for i in range(6)] + [
        _share("Seventh", 0.03)
    ]
    previous = [_share(f"G{i}", 0.2 - i * 0.02) for i in range(6)] + [
        _share("Seventh", 0.10)
    ]

    trend = _trend(monkeypatch, current, previous)

    assert trend[-1]["genre_name"] == "Seventh"
    assert trend[-1]["faller"] is True
    assert trend[-1]["delta_vs_previous"] == -0.07


def test_genre_trend_skips_the_faller_without_previous_or_a_drop(monkeypatch):
    current = [_share(f"G{i}", 0.15) for i in range(7)]

    assert len(_trend(monkeypatch, current, [])) == 6
    assert len(_trend(monkeypatch, current, current)) == 6


def test_audio_profile_reports_unknown_analysis_as_null():
    from crate.db.queries.user_library_stats_story import _audio_profile_payload

    class _Result:
        def mappings(self):
            return self

        def first(self):
            return {"energy": None, "danceability": 0, "valence": None, "bpm": None}

    class _Session:
        def execute(self, *args, **kwargs):
            return _Result()

    payload = _audio_profile_payload(_Session(), 1, _period())

    assert payload["energy"] is None
    assert payload["valence"] is None
    assert payload["danceability"] == 0.0
