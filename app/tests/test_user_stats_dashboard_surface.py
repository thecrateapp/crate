def _stats_snapshot(payload: dict) -> dict:
    return {
        "scope": "stats:dashboard",
        "subject_key": "user:7:30d:default:10:8:8:8:30",
        "payload_json": payload,
        "version": 2,
        "built_at": "2026-07-18T10:00:00+00:00",
        "generation_ms": 12,
        "source_seq": 8,
    }


def test_warm_stats_dashboard_reads_persisted_snapshot_without_rebuilding(monkeypatch):
    from crate.db import user_stats_dashboard_surface as surface

    monkeypatch.setattr(
        surface,
        "get_ui_snapshot",
        lambda *_args, **_kwargs: _stats_snapshot(
            {"window": "30d", "overview": {"play_count": 42}}
        ),
    )
    monkeypatch.setattr(
        surface,
        "build_user_stats_dashboard",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("dashboard rebuilt")),
    )

    payload = surface.get_user_stats_dashboard(7, window="30d")

    assert payload["overview"]["play_count"] == 42
    assert payload["snapshot"]["version"] == 2


def test_cold_stats_dashboard_returns_minimal_payload_and_queues_projection(
    monkeypatch,
):
    from crate.db import user_stats_dashboard_surface as surface

    queued: list[dict] = []
    monkeypatch.setattr(surface, "get_ui_snapshot", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        surface,
        "create_task_dedup",
        lambda task_type, params, **_kwargs: queued.append(
            {"task_type": task_type, **params}
        ),
    )

    payload = surface.get_user_stats_dashboard(7, window="30d")

    assert payload["window"] == "30d"
    assert payload["overview"]["play_count"] == 0
    assert payload["top_tracks"]["items"] == []
    assert payload["snapshot"]["pending"] is True
    assert queued == [
        {
            "task_type": "refresh_user_stats_dashboard_snapshot",
            "user_id": 7,
            "window": "30d",
            "month": None,
            "tracks_limit": 10,
            "artists_limit": 8,
            "albums_limit": 8,
            "genres_limit": 8,
            "replay_limit": 30,
        }
    ]


def test_stats_projection_refresh_persists_built_payload(monkeypatch):
    from crate.db import user_stats_dashboard_surface as surface

    saved: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        surface,
        "build_user_stats_dashboard",
        lambda **_kwargs: {"window": "30d", "overview": {"play_count": 9}},
    )
    monkeypatch.setattr(
        surface,
        "upsert_ui_snapshot",
        lambda scope, subject_key, payload, **_kwargs: (
            saved.append((scope, subject_key, payload)) or _stats_snapshot(payload)
        ),
    )

    payload = surface.refresh_user_stats_dashboard_snapshot(7, window="30d")

    assert payload["overview"]["play_count"] == 9
    assert saved[0][0] == "stats:dashboard"
    assert saved[0][1].startswith("user:7:30d:")


def test_stats_refresh_worker_builds_default_dashboard(monkeypatch):
    from crate.worker_handlers import analysis

    calls: list[tuple[int, str]] = []
    invalidations: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        "crate.db.user_stats_dashboard_surface.refresh_user_stats_dashboard_snapshot",
        lambda user_id, window="30d", **_kwargs: calls.append((user_id, window)) or {},
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )

    result = analysis._handle_refresh_user_stats_dashboard_snapshot(
        "task-2", {"user_id": 7, "window": "30d"}, {}
    )

    assert result == {"ok": True, "user_id": 7, "window": "30d"}
    assert calls == [(7, "30d")]
    assert invalidations == [("history",)]
