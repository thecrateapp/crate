"""Crate Pulse is served from a worker-built snapshot."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from crate.db import instance_stats_dashboard_surface as surface
from tests.conftest import PG_AVAILABLE


def test_cold_instance_dashboard_queues_a_build_instead_of_aggregating(monkeypatch):
    queued: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(surface, "get_ui_snapshot", lambda *_a, **_k: None)
    monkeypatch.setattr(
        surface,
        "build_instance_stats_dashboard",
        lambda **_k: (_ for _ in ()).throw(AssertionError("built in request")),
    )
    monkeypatch.setattr(
        surface,
        "create_task_dedup",
        lambda task, params, dedup_key: queued.append((task, params, dedup_key)),
    )

    payload = surface.get_instance_stats_dashboard(window="90d")

    assert payload["snapshot"]["pending"] is True
    assert payload["snapshot"]["scope"] == "stats:dashboard:instance"
    assert payload["subject"] == {"kind": "instance", "display_name": "Crate"}
    assert queued[0][0] == "refresh_instance_stats_dashboard_snapshot"
    assert queued[0][2] == "stats-dashboard-instance:v3:instance:90d:12:10:14:10:36"


def test_instance_key_is_versioned_and_limits_match_listen():
    key = surface.instance_stats_subject_key(
        window="30d", month=None, **surface._DEFAULT_LIMITS
    )

    assert key == "v3:instance:30d:12:10:14:10:36"
    assert surface._DEFAULT_LIMITS["albums_limit"] == 14


def test_instance_refresh_scheduling_is_debounced(monkeypatch):
    cache: dict[str, object] = {}
    queued: list[str] = []
    monkeypatch.setattr(surface, "get_cache", lambda key, **_k: cache.get(key))
    monkeypatch.setattr(
        surface, "set_cache", lambda key, value, ttl: cache.__setitem__(key, value)
    )
    monkeypatch.setattr(
        surface,
        "create_task_dedup",
        lambda task, params, dedup_key: queued.append(dedup_key),
    )

    assert surface.schedule_instance_stats_dashboard_refresh() == 4
    assert surface.schedule_instance_stats_dashboard_refresh() == 0
    assert len(queued) == 4


def test_rejects_calendar_years_for_the_instance():
    with pytest.raises(ValueError):
        surface.get_instance_stats_dashboard(window="year:2026")


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_instance_snapshot_aggregates_every_listener(pg_db):
    from crate.db.repositories.user_library_aggregate_runner import (
        recompute_user_listening_aggregates,
    )
    from tests.stats_history import seed_listening_history

    end_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    history = seed_listening_history(events=120, days=20, end_at=end_at)
    recompute_user_listening_aggregates(1)

    payload = surface.refresh_instance_stats_dashboard_snapshot(window="30d")

    assert payload["snapshot"]["scope"] == "stats:dashboard:instance"
    assert sum(point["plays"] for point in payload["tape"]["points"]) == 120
    assert payload["highlights"] is None
    assert payload["heatmap"]["peak"] is not None
    assert payload["artist_of_period"]["listener_top_percent"] is None
    assert history.event_count == 120
    previous = payload["overview"]["previous"]
    assert {"start", "end", "minutes_listened", "play_count", "active_days"} <= set(
        previous
    )
    assert "overview_previous" not in payload


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_instance_top_items_flag_first_plays_in_period(pg_db):
    from crate.db.jobs.instance_listening_rollups import (
        rebuild_instance_entity_firsts,
        rebuild_instance_listening_days,
    )
    from crate.db.repositories.user_library_aggregate_runner import (
        recompute_user_listening_aggregates,
    )
    from crate.db.tx import transaction_scope
    from tests.stats_history import seed_listening_history

    end_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    seed_listening_history(events=120, days=20, end_at=end_at)
    recompute_user_listening_aggregates(1)
    with transaction_scope() as session:
        rebuild_instance_listening_days(session, None)
        rebuild_instance_entity_firsts(session, None)

    def build(window: str) -> dict:
        return surface.build_instance_stats_dashboard(
            window=window, month=None, **surface._DEFAULT_LIMITS
        )

    recent = build("30d")
    artists = recent["top_artists"]["items"]
    assert artists and all(item["is_new"] is True for item in artists)
    assert all(item["is_new"] is True for item in recent["top_tracks"]["items"])
    assert all(item["is_new"] is True for item in recent["top_albums"]["items"])

    ancient = build("all_time")
    items = (
        ancient["top_tracks"]["items"]
        + ancient["top_artists"]["items"]
        + ancient["top_albums"]["items"]
    )
    assert items and all(item["is_new"] is False for item in items)


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_instance_heatmap_counts_listeners(pg_db):
    from sqlalchemy import text

    from crate.db.repositories.user_library_aggregate_runner import (
        recompute_user_listening_aggregates,
    )
    from crate.db.tx import transaction_scope
    from tests.stats_history import seed_listening_history

    end_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    seed_listening_history(events=120, days=20, end_at=end_at)
    recompute_user_listening_aggregates(1)
    with transaction_scope() as session:
        for user_id in (201, 202):
            session.execute(
                text(
                    "INSERT INTO users (id, email, name, role, password_hash, created_at) "
                    "VALUES (:id, :email, :email, 'user', 'x', NOW()) "
                    "ON CONFLICT (id) DO NOTHING"
                ),
                {"id": user_id, "email": f"l{user_id}@example.com"},
            )
        session.execute(
            text(
                "INSERT INTO user_hourly_listening (user_id, day, hour, minutes_listened) "
                "VALUES (201, CURRENT_DATE - 1, 23, 5), (201, CURRENT_DATE - 2, 9, 3), "
                "(202, CURRENT_DATE - 200, 10, 4)"
            )
        )

    payload = surface.build_instance_stats_dashboard(
        window="30d", month=None, **surface._DEFAULT_LIMITS
    )

    # User 1 (seeded history) and user 201; user 202 is outside the window.
    assert payload["heatmap"]["listener_count"] == 2
    assert payload["heatmap"]["night_hours"] == [22, 23, 0, 1, 2, 3, 4, 5]
