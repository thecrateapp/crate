from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import pytest
from crate.db.jobs.product_kpis import (
    ALL_KPIS,
    KPI_QUERIES,
    compute_product_kpis,
    product_kpi_days_due,
)
from crate.db.tx import read_scope, transaction_scope
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

NOW = datetime(2026, 10, 20, 15, 0, tzinfo=timezone.utc)
TODAY = NOW.date()
YESTERDAY = TODAY - timedelta(days=1)


def _execute(sql: str, params: dict | None = None):
    with transaction_scope() as session:
        return session.execute(text(sql), params or {})


def _user(name: str, created_at: datetime, **extra) -> int:
    with transaction_scope() as session:
        return session.execute(
            text(
                "INSERT INTO users (email, username, created_at, last_login, deleted_at) "
                "VALUES (:email, :name, :created_at, :last_login, :deleted_at) RETURNING id"
            ),
            {
                "email": f"{name}@example.test",
                "name": name,
                "created_at": created_at,
                "last_login": extra.get("last_login"),
                "deleted_at": extra.get("deleted_at"),
            },
        ).scalar_one()


def _listened(user_id: int, day: date, plays: int, minutes: float = 30.0) -> None:
    _execute(
        "INSERT INTO user_daily_listening (user_id, day, play_count, complete_play_count, "
        "skip_count, minutes_listened) VALUES (:u, :d, :p, :c, :s, :m)",
        {"u": user_id, "d": day, "p": plays, "c": plays - 1, "s": 1, "m": minutes},
    )


def _event(
    user_id: int, at: datetime, platform: str | None, source: str | None
) -> None:
    _execute(
        "INSERT INTO user_play_events (user_id, started_at, ended_at, created_at, "
        "app_platform, play_source_type) VALUES (:u, :at, :at, :at, :platform, :source)",
        {"u": user_id, "at": at, "platform": platform, "source": source},
    )


def _rows(day: date, kpi: str) -> dict[str, tuple[float, int | None]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                "SELECT dims, value, sample FROM product_kpi_daily "
                "WHERE day = :day AND kpi = :kpi"
            ),
            {"day": day, "kpi": kpi},
        ).all()
    return {
        json.dumps(dims, sort_keys=True): (value, sample)
        for dims, value, sample in rows
    }


def _value(day: date, kpi: str) -> float | None:
    rows = _rows(day, kpi)
    return rows["{}"][0] if "{}" in rows else None


def test_every_query_declares_the_kpis_it_writes():
    assert len(ALL_KPIS) == len(set(ALL_KPIS))
    for query in KPI_QUERIES:
        for kpi in query.kpis:
            assert f"'{kpi}'" in query.sql or query.streams, kpi


def test_listening_reach_and_signups_come_from_rollups_and_users(pg_db):
    alice = _user("alice", NOW - timedelta(days=2), last_login=NOW - timedelta(hours=2))
    bob = _user("bob", datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc))
    carol = _user("carol", NOW - timedelta(days=60), deleted_at=NOW - timedelta(days=1))
    _listened(alice, TODAY, plays=5, minutes=90)
    _listened(bob, TODAY, plays=3, minutes=30)
    _listened(alice, TODAY - timedelta(days=10), plays=2)
    _listened(carol, TODAY - timedelta(days=40), plays=1)

    compute_product_kpis([TODAY], now=NOW)

    assert _rows(TODAY, "users.daily_listeners")["{}"] == (2.0, 2)
    assert _value(TODAY, "listening.plays") == 8.0
    assert _value(TODAY, "listening.complete_plays") == 6.0
    assert _value(TODAY, "listening.skips") == 2.0
    assert _value(TODAY, "listening.hours") == pytest.approx(2.0)
    assert _value(TODAY, "users.weekly_listeners") == 2.0
    assert _value(TODAY, "users.monthly_listeners") == 2.0
    assert _value(TODAY, "users.signups") == 1.0
    total = _value(TODAY, "users.total")
    assert total is not None and total >= 2.0
    assert _value(TODAY, "users.active") is not None


def test_play_breakdowns_collapse_unknown_and_free_text_values(pg_db):
    user = _user("dana", NOW - timedelta(days=5))
    at = datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc)
    _event(user, at, "android", "radio")
    _event(user, at + timedelta(minutes=5), "android", "album")
    _event(user, at + timedelta(minutes=9), None, "Some Free Text!")
    _event(user, at - timedelta(days=1), "web", "radio")

    compute_product_kpis([TODAY], now=NOW)

    platforms = _rows(TODAY, "listening.plays_by_platform")
    assert platforms['{"platform": "android"}'] == (2.0, 1)
    assert platforms['{"platform": "unknown"}'] == (1.0, 1)
    assert '{"platform": "web"}' not in platforms
    sources = _rows(TODAY, "listening.plays_by_source")
    assert sources['{"source": "other"}'] == (1.0, 1)
    assert sources['{"source": "radio"}'][0] == 1.0


def test_acquisition_outcomes_come_from_finished_tasks(pg_db):
    start = datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc)
    for index, (task_type, status) in enumerate(
        (
            ("soulseek_download", "completed"),
            ("soulseek_download", "failed"),
            ("tidal_download", "completed"),
            ("compute_analytics", "completed"),
            ("soulseek_download", "running"),
        )
    ):
        _execute(
            "INSERT INTO tasks (id, type, status, created_at, started_at, updated_at) "
            "VALUES (:id, :type, :status, :start, :start, :updated)",
            {
                "id": f"task-{index}",
                "type": task_type,
                "status": status,
                "start": start,
                "updated": start + timedelta(minutes=12),
            },
        )

    compute_product_kpis([TODAY], now=NOW)

    completed = _rows(TODAY, "acquisition.completed")
    assert completed == {
        '{"source": "soulseek"}': (1.0, None),
        '{"source": "tidal"}': (1.0, None),
    }
    assert _rows(TODAY, "acquisition.failed") == {'{"source": "soulseek"}': (1.0, None)}
    minutes = _rows(TODAY, "acquisition.minutes_to_complete")
    assert minutes['{"source": "tidal"}'][0] == pytest.approx(12.0)


def test_streams_are_consolidated_only_inside_metric_retention(pg_db):
    for day in (TODAY, TODAY - timedelta(days=20)):
        _execute(
            "INSERT INTO metric_minute_snapshots (series_id, name, bucket_start, source_id, "
            "revision, count, sum_value, min_value, max_value, last_value, last_observed_at) "
            "VALUES (:series, 'stream.requests', :bucket, 'test', 1, 4, 4, 1, 1, 1, :bucket)",
            {
                "series": f"stream.requests:{day}",
                "bucket": datetime.combine(
                    day, datetime.min.time(), tzinfo=timezone.utc
                )
                + timedelta(hours=10),
            },
        )

    compute_product_kpis([TODAY, TODAY - timedelta(days=20)], now=NOW)

    assert _value(TODAY, "streams.requests") == 4.0
    assert _value(TODAY, "streams.transcodes_failed") is None
    assert _value(TODAY - timedelta(days=20), "streams.requests") is None


def test_snapshots_are_written_for_today_and_kept_on_recompute(pg_db):
    compute_product_kpis([YESTERDAY], now=NOW - timedelta(days=1))
    yesterday_tracks = _value(YESTERDAY, "library.tracks")
    assert yesterday_tracks is not None

    first = compute_product_kpis([YESTERDAY, TODAY], now=NOW)
    second = compute_product_kpis([YESTERDAY, TODAY], now=NOW)

    assert first == second
    assert _value(YESTERDAY, "library.tracks") == yesterday_tracks
    assert _value(TODAY, "library.tracks") is not None
    with read_scope() as session:
        duplicates = session.execute(
            text(
                "SELECT COUNT(*) FROM (SELECT day, kpi, dims FROM product_kpi_daily "
                "GROUP BY 1, 2, 3 HAVING COUNT(*) > 1) AS repeated"
            )
        ).scalar_one()
    assert duplicates == 0


def test_days_due_backfills_from_the_first_data_then_only_recent_days(pg_db):
    user = _user("erin", NOW - timedelta(days=3))
    _listened(user, TODAY - timedelta(days=3), plays=1)

    due = product_kpi_days_due(now=NOW)

    assert due[-1] == TODAY
    assert due[0] <= TODAY - timedelta(days=3)
    assert len(due) <= 366

    compute_product_kpis(due, now=NOW)

    assert product_kpi_days_due(now=NOW) == [YESTERDAY, TODAY]
