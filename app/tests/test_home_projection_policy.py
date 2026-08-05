from datetime import datetime, timedelta, timezone


def _snapshot(payload: dict, *, version: int = 1) -> dict:
    return {
        "scope": "home:discovery",
        "subject_key": "7",
        "payload_json": payload,
        "version": version,
        "built_at": "2026-07-18T10:00:00+00:00",
        "generation_ms": 4,
        "source_seq": 12,
    }


def test_home_request_returns_stale_snapshot_and_schedules_refresh(monkeypatch):
    from crate.db import home_discovery_surface as surface

    calls: list[tuple[str, dict, str]] = []
    calls_to_snapshot = 0

    def get_snapshot(scope, *_args, **_kwargs):
        nonlocal calls_to_snapshot
        if scope == "home:recently-played":
            return None
        calls_to_snapshot += 1
        return (
            None
            if calls_to_snapshot == 1
            else _snapshot({"hero": {"name": "High Vis"}})
        )

    monkeypatch.setattr(surface, "get_ui_snapshot", get_snapshot)
    monkeypatch.setattr(
        surface,
        "create_task_dedup",
        lambda task_type, params, dedup_key: calls.append(
            (task_type, params, dedup_key)
        ),
    )
    monkeypatch.setattr(
        surface,
        "get_home_discovery",
        lambda _user_id: (_ for _ in ()).throw(AssertionError("request rebuilt home")),
    )

    payload = surface.get_cached_home_discovery(7)

    assert payload["hero"]["name"] == "High Vis"
    assert payload["snapshot"]["stale"] is True
    assert calls == [
        (
            "refresh_home_discovery_snapshot",
            {"user_id": 7},
            "home-discovery:7",
        )
    ]


def test_cold_home_request_returns_schema_valid_minimal_payload(monkeypatch):
    from crate.db import home_discovery_surface as surface

    queued: list[int] = []
    monkeypatch.setattr(surface, "get_ui_snapshot", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        surface,
        "create_task_dedup",
        lambda _task_type, params, **_kwargs: queued.append(params["user_id"]),
    )
    monkeypatch.setattr(
        surface,
        "get_home_recently_played",
        lambda _user_id: (_ for _ in ()).throw(
            AssertionError("cold home must not run history queries")
        ),
    )

    payload = surface.get_cached_home_discovery(7)

    assert payload["hero"] is None
    assert payload["recently_played"] == []
    assert payload["custom_mixes"] == []
    assert payload["snapshot"]["pending"] is True
    assert queued == [7]


def test_home_request_rotates_cached_hero_candidates_for_the_user(monkeypatch):
    from crate.db import home_discovery_surface as surface

    calls: list[int] = []

    def rotate(rows, *, user_id):
        calls.append(user_id)
        return [rows[1], rows[0]]

    def get_snapshot(scope, *_args, **_kwargs):
        if scope == "home:recently-played":
            return None
        return _snapshot(
            {
                "hero": [{"name": "First"}, {"name": "Second"}],
                "recently_played": [],
            }
        )

    monkeypatch.setattr(surface, "get_ui_snapshot", get_snapshot)
    monkeypatch.setattr(surface, "rotate_home_hero_rows", rotate)

    payload = surface.get_cached_home_discovery(7)

    assert payload["hero"][0]["name"] == "Second"
    assert calls == [7]


def test_home_refresh_worker_builds_full_snapshot(monkeypatch):
    from crate.worker_handlers import analysis

    calls: list[tuple[int, bool]] = []
    section_calls: list[int] = []
    invalidations: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        "crate.db.home.get_cached_home_discovery",
        lambda user_id, fresh=False: calls.append((user_id, fresh)) or {"hero": {}},
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )
    monkeypatch.setattr(
        "crate.db.home_section_surface.warm_home_sections",
        lambda user_id: section_calls.append(user_id) or {},
    )

    result = analysis._handle_refresh_home_discovery_snapshot(
        "task-1", {"user_id": 7}, {}
    )

    assert result == {"ok": True, "user_id": 7}
    assert calls == [(7, True)]
    assert section_calls == [7]
    assert invalidations == [("home",)]


def test_expired_stale_after_does_not_hide_snapshot_inside_requested_stale_window(
    monkeypatch,
):
    from crate.db import ui_snapshot_shared

    now = datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(ui_snapshot_shared, "utc_now", lambda: now)
    row = {
        "built_at": now - timedelta(minutes=11),
        "stale_after": now - timedelta(minutes=1),
    }

    assert ui_snapshot_shared.snapshot_age_ok(row, 3600) is True
    assert ui_snapshot_shared.snapshot_age_ok(row, 600) is False
