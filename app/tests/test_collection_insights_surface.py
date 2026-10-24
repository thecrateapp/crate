"""The collection report is served from snapshots, never built by HTTP."""

from datetime import datetime, timedelta, timezone

import pytest


@pytest.fixture(autouse=True)
def active_refresh_task(monkeypatch):
    from crate.db import collection_insights_surface as surface

    monkeypatch.setattr(
        surface,
        "find_active_task_by_type_params",
        lambda *_a, **_k: "existing-report-task",
    )


def _row(age=0):
    built = datetime.now(timezone.utc) - timedelta(seconds=age)
    return {
        "scope": "admin:collection-insights",
        "subject_key": "v1:30d",
        "version": 2,
        "built_at": built,
        "stale_after": built + timedelta(seconds=300),
        "payload_json": {
            "ready": True,
            "window": "30d",
            "catalogue": {"tracks": 42, "albums": 7},
        },
    }


def test_cold_read_queues_without_building(monkeypatch):
    from crate.db import collection_insights_surface as surface

    queued = []
    monkeypatch.setattr(surface, "get_ui_snapshot", lambda *_a, **_k: None)
    monkeypatch.setattr(
        surface, "create_task_dedup", lambda *a, **k: queued.append((a, k))
    )
    result = surface.get_collection_insights(window="90d")
    assert result["ready"] is False
    assert result["current"] is None
    assert result["snapshot"]["missing"] is True
    assert result["snapshot"]["pending"] is True
    assert result["snapshot"]["subject_key"] == "v1:90d"
    assert result["snapshot"]["task_id"] == "existing-report-task"
    assert queued == [
        (
            ("refresh_collection_insights", {"window": "90d"}),
            {"dedup_key": "collection-insights:v1:90d"},
        )
    ]


def test_current_read_does_not_schedule_unless_requested(monkeypatch):
    from crate.db import collection_insights_surface as surface

    queued = []
    monkeypatch.setattr(surface, "get_ui_snapshot", lambda *_a, **_k: _row())
    monkeypatch.setattr(surface, "create_task_dedup", lambda *a, **k: queued.append(a))
    result = surface.get_collection_insights()
    assert result["catalogue"]["tracks"] == 42
    assert result["snapshot"]["stale"] is False
    assert not queued
    refreshed = surface.get_collection_insights(fresh=True)
    assert refreshed["ready"] is True
    assert refreshed["snapshot"]["pending"] is True
    assert len(queued) == 1


def test_old_snapshot_survives_and_refresh_failure_is_reported(monkeypatch):
    from crate.db import collection_insights_surface as surface

    def read(*_a, max_age_seconds=None):
        return None if max_age_seconds == 300 else _row(age=172800)

    def unavailable(*_a, **_k):
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(surface, "get_ui_snapshot", read)
    monkeypatch.setattr(surface, "create_task_dedup", unavailable)
    result = surface.get_collection_insights()
    assert result["ready"] is True
    assert result["snapshot"]["stale"] is True
    assert result["snapshot"]["pending"] is False
    assert result["snapshot"]["refresh_error"] is True


def test_schedule_refresh_is_debounced_and_bounds_windows(monkeypatch):
    from crate.db import collection_insights_surface as surface

    cache, queued = {}, []
    monkeypatch.setattr(surface, "get_cache", lambda key, **_k: cache.get(key))
    monkeypatch.setattr(
        surface, "set_cache", lambda key, value, **_k: cache.__setitem__(key, value)
    )
    monkeypatch.setattr(surface, "create_task_dedup", lambda *a, **_k: queued.append(a))
    assert surface.schedule_collection_insights_refresh() == 3
    assert surface.schedule_collection_insights_refresh() == 0
    assert [item[1]["window"] for item in queued] == ["30d", "90d", "365d"]
    with pytest.raises(ValueError):
        surface.get_collection_insights(window="unbounded")


def test_endpoint_validates_and_requires_library_view(test_app, monkeypatch):
    import crate.api.analytics as router

    calls = []

    def cached(**params):
        calls.append(params)
        from crate.db.collection_insights_surface import cold_collection_insights

        return cold_collection_insights(params["window"])

    monkeypatch.setattr(router, "get_collection_insights", cached)
    result = test_app.get("/api/admin/collection-insights?window=90d&fresh=true")
    assert result.status_code == 200
    assert result.json()["snapshot"]["missing"] is True
    assert calls == [{"window": "90d", "fresh": True}]
    assert (
        test_app.get("/api/admin/collection-insights?window=all_time").status_code
        == 422
    )

    async def no_user(self, request):
        return None

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", no_user)
    assert test_app.get("/api/admin/collection-insights").status_code == 401


def test_endpoint_openapi_is_typed_authenticated(test_app):
    operation = test_app.get("/openapi.json").json()["paths"][
        "/api/admin/collection-insights"
    ]["get"]
    assert operation["tags"] == ["analytics"]
    assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("/CollectionInsightsResponse")


def test_worker_and_task_governor_route_report_builds_to_maintenance(monkeypatch):
    from crate.actors import TASK_POOL_CONFIG
    from crate.db.repositories.tasks_shared import DB_HEAVY_TASKS
    from crate.resource_governor import RESOURCE_GOVERNED_TASK_TYPES
    from crate.worker_handlers import analysis
    from crate.db import collection_insights_surface as surface

    calls = []
    monkeypatch.setattr(
        surface, "refresh_collection_insights", lambda **k: calls.append(k)
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation", lambda scope: None
    )
    handler = analysis.ANALYSIS_TASK_HANDLERS["refresh_collection_insights"]
    assert handler("t", {"window": "90d"}, {}) == {"ok": True, "window": "90d"}
    assert calls == [{"window": "90d"}]
    assert TASK_POOL_CONFIG["refresh_collection_insights"].queue == "maintenance"
    assert "refresh_collection_insights" in DB_HEAVY_TASKS
    assert "refresh_collection_insights" in RESOURCE_GOVERNED_TASK_TYPES


def test_projector_coalesces_listening_catalogue_and_analysis_refresh(monkeypatch):
    from crate import projector

    for event_type, scope, payload in [
        ("user.listening_aggregates.updated", "user", {"user_id": 1}),
        ("library.scan.completed", "library", {}),
        ("track.analysis.updated", "pipeline:analysis", {}),
        ("track.bliss.updated", "pipeline:bliss", {}),
        ("ui.invalidate", "ui.invalidate", {"scope": "genres"}),
    ]:
        actions, _ = projector._projection_actions(
            {"event_type": event_type, "scope": scope, "payload_json": payload}
        )
        assert ("collection-insights", None) in actions
    calls = []
    monkeypatch.setattr(
        projector, "schedule_collection_insights_refresh", lambda: calls.append(True)
    )
    assert projector._execute_projection_action(("collection-insights", None)) == (0, 0)
    assert calls == [True]
