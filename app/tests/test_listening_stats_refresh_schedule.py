from __future__ import annotations

from datetime import date

from sqlalchemy import text

from crate.db.repositories.tasks import release_task_dedup_key
from crate.db.repositories.user_library_aggregate_runner import (
    schedule_dirty_listening_refreshes,
    schedule_user_listening_refresh,
)
from crate.db.repositories.user_library_playback_writes import (
    _schedule_stats_refresh,
)
from crate.db.tx import read_scope, transaction_scope


def _mark_dirty(user_id: int = 1, day: date = date(2026, 10, 25)) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO user_listening_dirty_days (user_id, day) "
                "VALUES (:user_id, :day) ON CONFLICT DO NOTHING"
            ),
            {"user_id": user_id, "day": day},
        )


def _refresh_tasks() -> list[dict]:
    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    "SELECT id, status, dedup_key, params_json FROM tasks "
                    "WHERE type = 'refresh_user_listening_stats' ORDER BY created_at"
                )
            ).mappings()
        ]


def test_sweep_queues_one_refresh_per_user_with_dirty_days(pg_db):
    _mark_dirty()

    assert schedule_dirty_listening_refreshes() == [1]
    assert schedule_dirty_listening_refreshes() == [1]

    tasks = _refresh_tasks()
    assert len(tasks) == 1
    assert tasks[0]["dedup_key"] == "listening-stats:1"
    assert tasks[0]["params_json"] == {"user_id": 1}


def test_sweep_does_nothing_without_dirty_days(pg_db):
    assert schedule_dirty_listening_refreshes() == []
    assert _refresh_tasks() == []


def test_a_running_refresh_that_released_its_key_lets_new_plays_queue(pg_db):
    first = schedule_user_listening_refresh(1)
    assert first is not None
    pg_db.update_task(first, status="running")
    assert schedule_user_listening_refresh(1) is None

    release_task_dedup_key(first)

    assert schedule_user_listening_refresh(1) is not None


def test_the_sweep_rescues_a_play_swallowed_by_the_debounce(pg_db, monkeypatch):
    cache: dict[str, object] = {}
    monkeypatch.setattr(
        "crate.db.repositories.user_library_playback_writes.get_cache",
        lambda key, max_age_seconds=None: cache.get(key),
    )
    monkeypatch.setattr(
        "crate.db.repositories.user_library_playback_writes.set_cache",
        lambda key, value, ttl=None: cache.__setitem__(key, value),
    )

    _schedule_stats_refresh(1)
    [first] = _refresh_tasks()
    pg_db.update_task(first["id"], status="completed")

    _mark_dirty()
    _schedule_stats_refresh(1)
    assert len(_refresh_tasks()) == 1

    schedule_dirty_listening_refreshes()
    tasks = _refresh_tasks()
    assert len(tasks) == 2
    assert tasks[-1]["status"] == "pending"


def test_the_sweep_is_scheduled_every_five_minutes():
    from crate.scheduler import DEFAULT_SCHEDULES
    from crate.worker_handlers.analysis import ANALYSIS_TASK_HANDLERS

    assert DEFAULT_SCHEDULES["refresh_dirty_listening_stats"] == 300
    assert "refresh_dirty_listening_stats" in ANALYSIS_TASK_HANDLERS
