"""Instance listening rollups sum every listener's per-day projections."""

from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import text

from crate.db.jobs.instance_listening_rollups import (
    instance_listening_rollups_incomplete,
    queue_instance_listening_backfill_if_needed,
    rebuild_instance_entity_firsts,
    rebuild_instance_listening_days,
)
from crate.db.jobs.user_listening_projections import mark_listening_day_dirty
from crate.db.repositories.user_library_aggregate_runner import (
    recompute_user_listening_aggregates,
    refresh_user_listening_aggregates,
)
from crate.db.repositories.user_library_playback_writes import record_play_event
from crate.db.tx import read_scope, transaction_scope
from tests.conftest import PG_AVAILABLE
from tests.stats_history import seed_listening_history, seed_stats_library

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

ROLLUPS = "crate.db.jobs.instance_listening_rollups"
DAYS_TASK = "rebuild_instance_listening_days"


def _create_listener(username: str = "second", tz: str | None = None) -> int:
    with transaction_scope() as session:
        return session.execute(
            text(
                "INSERT INTO users (email, username, timezone, created_at) "
                "VALUES (:email, :username, :tz, now()) RETURNING id"
            ),
            {"email": f"{username}@example.test", "username": username, "tz": tz},
        ).scalar_one()


def _set_timezone(user_id: int, tz: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE users SET timezone = :tz WHERE id = :u"),
            {"tz": tz, "u": user_id},
        )


def _play(
    user_id: int,
    ended_at: str,
    *,
    track_id: int | None = None,
    track: dict | None = None,
    n: int = 0,
) -> int:
    if track is None:
        with read_scope() as session:
            track = dict(
                session.execute(
                    text(
                        "SELECT title, artist, album FROM library_tracks WHERE id = :id"
                    ),
                    {"id": track_id},
                )
                .mappings()
                .one()
            )
    ended = datetime.fromisoformat(ended_at)
    return record_play_event(
        user_id,
        client_event_id=f"rollup-{user_id}-{ended_at}-{n}",
        track_id=track_id,
        track_path=track.get("path"),
        title=track["title"],
        artist=track["artist"],
        album=track["album"],
        started_at=(ended - timedelta(seconds=200)).isoformat(),
        ended_at=ended_at,
        played_seconds=200.0,
        track_duration_seconds=200.0,
        completion_ratio=1.0,
        was_completed=True,
        play_source_type="album",
        device_type="web",
        app_platform="listen-web",
    )


def _seed_two_listeners() -> tuple[int, list[int]]:
    _set_timezone(1, "UTC")
    history = seed_listening_history(user_id=1, events=400, days=45)
    other = _create_listener(tz="America/New_York")
    seed_listening_history(
        user_id=other,
        events=300,
        days=30,
        end_at="2026-10-05T21:00:00+00:00",
        track_ids=history.track_ids,
    )
    recompute_user_listening_aggregates(1)
    recompute_user_listening_aggregates(other)
    return other, history.track_ids


def _rebuild_all() -> tuple[int, int]:
    with transaction_scope() as session:
        rows = rebuild_instance_listening_days(session, None)
        firsts = rebuild_instance_entity_firsts(session, None)
    return rows, firsts


def _rows(session, sql: str) -> list[dict]:
    return [
        {
            key: round(value, 6) if isinstance(value, float) else value
            for key, value in row.items()
        }
        for row in session.execute(text(sql)).mappings().all()
    ]


def _instance_snapshot() -> dict:
    with read_scope() as session:
        return {
            "daily": _rows(
                session,
                "SELECT * FROM instance_track_daily "
                "ORDER BY day, entity_key, artist, album",
            ),
            "firsts": _rows(
                session,
                "SELECT * FROM instance_entity_firsts ORDER BY entity_type, entity_key",
            ),
        }


def _firsts() -> dict[tuple[str, str], tuple[str, str, str]]:
    return {
        (row["entity_type"], row["entity_key"]): (
            str(row["first_day"]),
            row["artist"],
            row["album"],
        )
        for row in _instance_snapshot()["firsts"]
    }


def _days_dedup_key(days: list[str]) -> str:
    digest = hashlib.sha1(",".join(sorted(days)).encode()).hexdigest()
    return f"instance-listening-days:{digest}"


def _quiet_task_events(monkeypatch) -> None:
    monkeypatch.setattr(
        "crate.worker_handlers.analysis.emit_progress", lambda *a, **k: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.analysis.emit_task_event", lambda *a, **k: None
    )
    monkeypatch.setattr(
        "crate.db.domain_events.append_domain_event", lambda *a, **k: None
    )


def _record_enqueues(monkeypatch) -> list[tuple[str, dict, str]]:
    calls: list[tuple[str, dict, str]] = []

    def _create_task_dedup(task_type, params=None, dedup_key="", *args, **kwargs):
        calls.append((task_type, params or {}, dedup_key))
        return f"task-{len(calls)}"

    monkeypatch.setattr(f"{ROLLUPS}.create_task_dedup", _create_task_dedup)
    return calls


def test_full_rebuild_matches_sum_of_user_days(pg_db):
    _seed_two_listeners()

    rows, _ = _rebuild_all()

    with read_scope() as session:
        user_rows = session.execute(
            text(
                """
                SELECT user_id, day, entity_key, artist, album, play_count,
                       complete_play_count, skip_count, minutes_listened
                FROM user_track_daily
                """
            )
        ).all()
    expected: dict[tuple, dict] = defaultdict(
        lambda: {
            "play_count": 0,
            "complete_play_count": 0,
            "skip_count": 0,
            "minutes_listened": 0.0,
            "users": set(),
        }
    )
    for row in user_rows:
        bucket = expected[(row.day, row.entity_key, row.artist, row.album)]
        bucket["play_count"] += row.play_count
        bucket["complete_play_count"] += row.complete_play_count
        bucket["skip_count"] += row.skip_count
        bucket["minutes_listened"] += row.minutes_listened
        bucket["users"].add(row.user_id)

    actual = {
        (row["day"], row["entity_key"], row["artist"], row["album"]): row
        for row in _instance_snapshot()["daily"]
    }
    assert rows == len(expected)
    assert set(actual) == set(expected)
    assert any(len(bucket["users"]) == 2 for bucket in expected.values())
    for key, bucket in expected.items():
        row = actual[key]
        assert row["play_count"] == bucket["play_count"]
        assert row["complete_play_count"] == bucket["complete_play_count"]
        assert row["skip_count"] == bucket["skip_count"]
        assert row["minutes_listened"] == pytest.approx(bucket["minutes_listened"])
        assert row["listener_count"] == len(bucket["users"])


def test_incremental_day_rebuild_equals_full_rebuild(pg_db):
    other, track_ids = _seed_two_listeners()
    _rebuild_all()

    _play(other, "2026-06-02T15:00:00+00:00", track_id=track_ids[3])
    _play(other, "2026-06-02T16:00:00+00:00", track_id=track_ids[-1], n=1)
    _play(other, "2026-10-01T18:00:00+00:00", track_id=track_ids[7])
    result = refresh_user_listening_aggregates(other)
    assert result["days"] == ["2026-06-02", "2026-10-01"]

    with transaction_scope() as session:
        rebuild_instance_listening_days(
            session, [date.fromisoformat(day) for day in result["days"]]
        )
        rebuild_instance_entity_firsts(session, result["keys"])
    incremental = _instance_snapshot()

    _rebuild_all()
    assert _instance_snapshot() == incremental


def test_instance_firsts_drop_keys_no_listener_has_anymore(pg_db):
    _set_timezone(1, "UTC")
    seed_listening_history(user_id=1, events=60, days=10)
    other = _create_listener(tz="UTC")
    recompute_user_listening_aggregates(1)
    recompute_user_listening_aggregates(other)
    _rebuild_all()

    solo = {
        "title": "Solo Song",
        "artist": "Solo Artist",
        "album": "Solo Album",
        "path": "/music/Solo Artist/Solo Album/01.flac",
    }
    ended_at = "2026-09-01T12:00:00+00:00"
    _play(other, ended_at, track=solo)
    added = refresh_user_listening_aggregates(other)
    with transaction_scope() as session:
        rebuild_instance_listening_days(session, [date(2026, 9, 1)])
        rebuild_instance_entity_firsts(session, added["keys"])
    assert _firsts()[("artist", "Solo Artist")] == ("2026-09-01", "Solo Artist", "")

    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM user_play_events WHERE user_id = :u AND artist = :a"),
            {"u": other, "a": "Solo Artist"},
        )
        mark_listening_day_dirty(session, other, ended_at)
    removed = refresh_user_listening_aggregates(other)
    assert "Solo Artist" in removed["keys"]["artist"]
    with transaction_scope() as session:
        rebuild_instance_listening_days(session, [date(2026, 9, 1)])
        rebuild_instance_entity_firsts(session, removed["keys"])

    firsts = _firsts()
    assert ("artist", "Solo Artist") not in firsts
    assert ("album", "Solo Artist||Solo Album") not in firsts
    assert ("track", solo["path"]) not in firsts
    incremental = _instance_snapshot()
    _rebuild_all()
    assert _instance_snapshot() == incremental


def test_rebuild_is_idempotent(pg_db):
    _seed_two_listeners()

    first_counts = _rebuild_all()
    first = _instance_snapshot()
    assert _rebuild_all() == first_counts
    assert _instance_snapshot() == first

    days = [date(2026, 10, 1), date(2026, 10, 5)]
    for _ in range(2):
        with transaction_scope() as session:
            rebuild_instance_listening_days(session, days)
            rebuild_instance_entity_firsts(
                session, {"artist": ["Converge", "Dredg"], "album": [], "track": []}
            )
    assert _instance_snapshot() == first


def test_instance_firsts_take_the_earliest_listener(pg_db):
    track_ids = seed_stats_library()
    other = _create_listener(tz="UTC")
    _set_timezone(1, "UTC")
    first_track, second_track = track_ids[0], track_ids[1]
    _play(1, "2026-05-10T12:00:00+00:00", track_id=first_track)
    _play(other, "2026-05-03T12:00:00+00:00", track_id=first_track)
    _play(1, "2026-05-01T12:00:00+00:00", track_id=second_track)
    _play(other, "2026-05-10T13:00:00+00:00", track_id=first_track, n=1)
    recompute_user_listening_aggregates(1)
    recompute_user_listening_aggregates(other)

    _rebuild_all()

    with read_scope() as session:
        track = (
            session.execute(
                text(
                    """
                    SELECT DISTINCT utd.entity_key, lt.artist, lt.album
                    FROM user_track_daily utd
                    JOIN library_tracks lt ON lt.id = utd.track_id
                    WHERE utd.track_id = :id
                    """
                ),
                {"id": first_track},
            )
            .mappings()
            .one()
        )
        shared_day = (
            session.execute(
                text(
                    """
                    SELECT play_count, listener_count FROM instance_track_daily
                    WHERE day = '2026-05-10' AND entity_key = :key
                    """
                ),
                {"key": track["entity_key"]},
            )
            .mappings()
            .one()
        )
    firsts = _firsts()
    album_key = f"{track['artist']}||{track['album']}"
    assert firsts[("track", track["entity_key"])][0] == "2026-05-03"
    assert firsts[("artist", track["artist"])] == ("2026-05-01", track["artist"], "")
    assert firsts[("album", album_key)] == (
        "2026-05-01",
        track["artist"],
        track["album"],
    )
    assert dict(shared_day) == {"play_count": 2, "listener_count": 2}


def test_backfill_is_queued_only_when_rollups_are_incomplete(pg_db, monkeypatch):
    calls = _record_enqueues(monkeypatch)
    with read_scope() as session:
        assert not instance_listening_rollups_incomplete(session)
    assert queue_instance_listening_backfill_if_needed() is None
    assert calls == []

    _seed_two_listeners()
    calls.clear()
    with read_scope() as session:
        assert instance_listening_rollups_incomplete(session)
    assert queue_instance_listening_backfill_if_needed() == "task-1"
    assert calls == [
        ("backfill_instance_listening_rollups", {}, "instance-listening-backfill")
    ]

    calls.clear()
    with transaction_scope() as session:
        rebuild_instance_listening_days(session, [date(2026, 10, 5)])
    with read_scope() as session:
        assert instance_listening_rollups_incomplete(session)
    assert queue_instance_listening_backfill_if_needed() is not None

    calls.clear()
    _rebuild_all()
    with read_scope() as session:
        assert not instance_listening_rollups_incomplete(session)
    assert queue_instance_listening_backfill_if_needed() is None
    assert calls == []


def test_api_startup_queues_the_backfill_check(monkeypatch):
    from crate import api

    calls: list[bool] = []
    monkeypatch.setattr(
        f"{ROLLUPS}.queue_instance_listening_backfill_if_needed",
        lambda: calls.append(True) or "task-1",
    )

    api._queue_instance_listening_backfill()

    assert calls == [True]


def test_backfill_task_fills_the_whole_history(pg_db, monkeypatch):
    from crate.worker_handlers.analysis import (
        _handle_backfill_instance_listening_rollups,
    )

    _seed_two_listeners()
    _quiet_task_events(monkeypatch)

    result = _handle_backfill_instance_listening_rollups("backfill", {}, {})

    assert result["ok"] is True
    assert result["track_rows"] > 0
    filled = _instance_snapshot()
    _rebuild_all()
    assert _instance_snapshot() == filled


def test_refresh_user_listening_stats_enqueues_the_instance_day_rebuild(
    pg_db, monkeypatch
):
    from crate.worker_handlers.analysis import _handle_refresh_user_listening_stats

    _set_timezone(1, "UTC")
    history = seed_listening_history(events=100, days=20)
    recompute_user_listening_aggregates(1)
    _play(1, "2026-10-06T21:40:00+00:00", track_id=history.track_ids[2])
    calls = _record_enqueues(monkeypatch)
    _quiet_task_events(monkeypatch)

    result = _handle_refresh_user_listening_stats("refresh", {"user_id": 1}, {})

    assert result == {"ok": True, "user_id": 1}
    assert len(calls) == 1
    task_type, params, dedup_key = calls[0]
    assert task_type == DAYS_TASK
    assert params["days"] == ["2026-10-06"]
    assert "Converge" in params["keys"]["artist"]
    assert dedup_key == _days_dedup_key(["2026-10-06"])


def test_full_user_rebuild_enqueues_the_instance_backfill(pg_db, monkeypatch):
    _set_timezone(1, "UTC")
    seed_listening_history(events=50, days=10)
    calls = _record_enqueues(monkeypatch)

    recompute_user_listening_aggregates(1)

    assert calls == [
        ("backfill_instance_listening_rollups", {}, "instance-listening-backfill")
    ]


def _instance_day_tasks(dedup_key: str | None = None) -> list[dict]:
    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    """
                    SELECT id, dedup_key, params_json AS params FROM tasks
                    WHERE type = :type
                      AND (CAST(:key AS text) IS NULL OR dedup_key = :key)
                    ORDER BY created_at, id
                    """
                ),
                {"type": DAYS_TASK, "key": dedup_key},
            ).mappings()
        ]


def test_two_listeners_refreshing_one_day_share_a_complete_rebuild(pg_db, monkeypatch):
    from crate.worker_handlers.analysis import (
        _handle_rebuild_instance_listening_days,
    )

    other, track_ids = _seed_two_listeners()
    _rebuild_all()
    _quiet_task_events(monkeypatch)
    dedup_key = _days_dedup_key(["2026-06-02"])

    _play(1, "2026-06-02T12:00:00+00:00", track_id=track_ids[0])
    _play(other, "2026-06-02T15:00:00+00:00", track_id=track_ids[-1])
    assert refresh_user_listening_aggregates(1)["days"] == ["2026-06-02"]
    assert refresh_user_listening_aggregates(other)["days"] == ["2026-06-02"]
    (task,) = _instance_day_tasks(dedup_key)

    result = _handle_rebuild_instance_listening_days(task["id"], task["params"], {})

    assert result["ok"] is True
    rebuilt = _instance_snapshot()
    _rebuild_all()
    assert _instance_snapshot() == rebuilt

    _play(other, "2026-06-02T17:00:00+00:00", track_id=track_ids[5])
    refresh_user_listening_aggregates(other)
    later = _instance_day_tasks(dedup_key)
    assert [row["id"] for row in later] != [task["id"]]
    assert len(later) == 1
    assert _instance_day_tasks()[0] == {**task, "dedup_key": None}


BACKFILL_CALL = (
    "backfill_instance_listening_rollups",
    {},
    "instance-listening-backfill",
)


def test_global_ref_backfill_enqueues_one_instance_backfill_for_all_listeners(
    pg_db, monkeypatch
):
    from crate.db.repositories.global_user_library import (
        backfill_legacy_user_library_refs_batch,
    )

    _seed_two_listeners()
    with transaction_scope() as session:
        session.execute(
            text("UPDATE user_play_events SET global_track_uid = gen_random_uuid()")
        )
    calls = _record_enqueues(monkeypatch)

    result = backfill_legacy_user_library_refs_batch(rebuild_listening_stats=True)

    assert result["listening_stats_users"] == 2
    assert calls == [BACKFILL_CALL]


def test_deleting_a_listener_queues_the_backfill_that_drops_them(pg_db, monkeypatch):
    from crate.db.jobs.instance_listening_rollups import rebuild_instance_listening
    from crate.db.repositories.auth_user_admin import delete_user

    other, _ = _seed_two_listeners()
    silent = _create_listener("silent", tz="UTC")
    _rebuild_all()
    calls = _record_enqueues(monkeypatch)

    delete_user(silent)
    delete_user(987654)
    assert calls == []

    delete_user(other)
    assert calls == [BACKFILL_CALL]

    rebuild_instance_listening(None)
    with read_scope() as session:
        remaining = session.execute(
            text(
                """
                SELECT
                    (SELECT COALESCE(SUM(play_count), 0) FROM instance_track_daily),
                    (SELECT COALESCE(SUM(play_count), 0) FROM user_track_daily),
                    (SELECT MAX(listener_count) FROM instance_track_daily)
                """
            )
        ).one()
    assert remaining[0] == remaining[1]
    assert remaining[2] == 1
