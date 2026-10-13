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
    assert queued[0][2] == "stats-dashboard-instance:instance:90d:12:10:12:10:36"


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
