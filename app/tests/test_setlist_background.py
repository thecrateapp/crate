from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def test_missing_setlists_are_deduplicated_into_background_tasks(monkeypatch):
    from crate import setlistfm

    calls: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(setlistfm, "get_cached_probable_setlist", lambda _name: None)
    monkeypatch.setattr(setlistfm, "get_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(setlistfm, "set_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup",
        lambda task_type, params, dedup_key: (
            calls.append((task_type, params, dedup_key)) or f"task-{len(calls)}"
        ),
    )

    task_ids = setlistfm.queue_probable_setlist_refreshes(
        [" Placebo ", "placebo", "Biznaga"]
    )

    assert task_ids == ["task-1", "task-2"]
    assert calls == [
        (
            "refresh_probable_setlist",
            {"artist_name": "Placebo"},
            "placebo",
        ),
        (
            "refresh_probable_setlist",
            {"artist_name": "Biznaga"},
            "biznaga",
        ),
    ]


def test_forced_refresh_ignores_cache_status_and_returns_active_task(monkeypatch):
    from crate import setlistfm

    created: list[tuple[str, dict, str]] = []
    active: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        setlistfm,
        "get_cached_probable_setlist",
        lambda _name: [{"title": "Cached Song"}],
    )
    monkeypatch.setattr(
        setlistfm,
        "get_cache",
        lambda *_args, **_kwargs: {"status": "missing"},
    )
    monkeypatch.setattr(setlistfm, "set_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup",
        lambda task_type, params, dedup_key: (
            created.append((task_type, params, dedup_key)) or None
        ),
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.find_active_task_by_type_params",
        lambda task_type, params, *, dedup_key: (
            active.append((task_type, params, dedup_key)) or "task-active"
        ),
    )

    task_id = setlistfm.queue_probable_setlist_refresh(" Placebo ", force=True)

    expected = (
        "refresh_probable_setlist",
        {"artist_name": "Placebo", "force": True},
        "placebo",
    )
    assert task_id == "task-active"
    assert created == [expected]
    assert active == [expected]


def test_refresh_invalidates_aggregate_enrichment_only_after_success(monkeypatch):
    from crate import setlistfm

    deleted: list[str] = []
    calls: list[tuple[str, bool]] = []
    monkeypatch.setattr(
        setlistfm,
        "get_probable_setlist",
        lambda name, *, force=False: (
            calls.append((name, force)) or [{"title": "New Song"}]
        ),
    )
    monkeypatch.setattr(setlistfm, "set_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(setlistfm, "delete_cache", lambda key: deleted.append(key))

    result = setlistfm.refresh_probable_setlist(" Placebo ", force=True)

    assert result == {"status": "ready", "artist_name": "Placebo", "songs": 1}
    assert calls == [("Placebo", True)]
    assert deleted == ["enrichment:placebo"]


def test_setlist_worker_refreshes_and_invalidates_dependent_surfaces(monkeypatch):
    from crate.worker_handlers import enrichment

    invalidations: list[tuple[str, ...]] = []
    refreshes: list[tuple[str, bool]] = []

    def refresh(name, *, force=False):
        refreshes.append((name, force))
        return {"status": "ready", "artist_name": name, "songs": 12}

    monkeypatch.setattr("crate.setlistfm.refresh_probable_setlist", refresh)
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )

    result = enrichment._handle_refresh_probable_setlist(
        "task-1", {"artist_name": "High Vis", "force": True}, {}
    )

    assert result == {
        "status": "ready",
        "artist_name": "High Vis",
        "songs": 12,
    }
    assert refreshes == [("High Vis", True)]
    assert invalidations == [("upcoming", "artist:high-vis")]


def test_api_read_paths_do_not_call_setlist_provider_live():
    root = Path(__file__).parents[1] / "crate" / "api"

    for relative in ("me.py", "browse_artist.py", "enrichment.py"):
        source = (root / relative).read_text()
        assert "setlistfm.get_probable_setlist(" not in source
        assert "get_probable_setlist(artist_name)" not in source


def test_admin_can_force_refresh_setlist_by_artist_id(monkeypatch):
    from crate.api import enrichment

    queued: list[tuple[str, bool]] = []
    monkeypatch.setattr(enrichment, "artist_name_from_id", lambda _id: "High Vis")
    monkeypatch.setattr(
        enrichment.setlistfm,
        "queue_probable_setlist_refresh",
        lambda name, *, force=False: queued.append((name, force)) or "task-setlist",
    )
    request = SimpleNamespace(state=SimpleNamespace(user={"id": 1, "role": "editor"}))

    result = enrichment.refresh_probable_setlist_by_id(request, 42)

    assert result == {"task_id": "task-setlist", "status": "queued"}
    assert queued == [("High Vis", True)]


def test_admin_can_force_refresh_setlist_by_artist_entity_uid(monkeypatch):
    from crate.api import enrichment

    monkeypatch.setattr(
        enrichment,
        "artist_name_from_entity_uid",
        lambda _uid: "High Vis",
    )
    monkeypatch.setattr(
        enrichment.setlistfm,
        "queue_probable_setlist_refresh",
        lambda _name, *, force=False: "task-entity" if force else None,
    )
    request = SimpleNamespace(state=SimpleNamespace(user={"id": 1, "role": "editor"}))

    result = enrichment.refresh_probable_setlist_by_entity_uid(
        request,
        "artist-uid",
    )

    assert result == {"task_id": "task-entity", "status": "queued"}


def test_force_refresh_setlist_rejects_user_without_metadata_permission(monkeypatch):
    from crate.api import enrichment

    queued = False

    def queue(*_args, **_kwargs):
        nonlocal queued
        queued = True
        return "task-setlist"

    monkeypatch.setattr(enrichment, "artist_name_from_id", lambda _id: "High Vis")
    monkeypatch.setattr(
        enrichment.setlistfm,
        "queue_probable_setlist_refresh",
        queue,
    )
    request = SimpleNamespace(state=SimpleNamespace(user={"id": 2, "role": "user"}))

    with pytest.raises(HTTPException) as exc:
        enrichment.refresh_probable_setlist_by_id(request, 42)

    assert exc.value.status_code == 403
    assert queued is False


def test_force_refresh_setlist_returns_not_found_for_unknown_artist(monkeypatch):
    from crate.api import enrichment

    monkeypatch.setattr(enrichment, "artist_name_from_id", lambda _id: None)
    request = SimpleNamespace(state=SimpleNamespace(user={"id": 1, "role": "editor"}))

    with pytest.raises(HTTPException) as exc:
        enrichment.refresh_probable_setlist_by_id(request, 404)

    assert exc.value.status_code == 404


def test_billed_show_artist_names_dedupes_headliners_and_lineups():
    from crate.setlistfm import billed_show_artist_names

    names = billed_show_artist_names(
        [
            {"artist_name": "Main Act", "lineup": ["Main Act", " support   act "]},
            {"artist_name": "Support Act", "lineup": None},
            {"artist_name": "", "lineup": ["Another Act"]},
        ]
    )

    assert names == ["Main Act", "support act", "Another Act"]


def test_outdated_show_setlists_skip_fresh_and_legacy_unknown_caches(monkeypatch):
    from crate import setlistfm

    queued: list[tuple[list[str], bool]] = []
    monkeypatch.setattr(
        setlistfm,
        "get_probable_setlist_health",
        lambda names: {
            "fresh act": {"status": "fresh"},
            "legacy act": {"status": "unknown"},
            "missing act": {"status": "missing"},
            "stale act": {"status": "stale"},
        },
    )
    monkeypatch.setattr(
        setlistfm,
        "queue_probable_setlist_refreshes",
        lambda names, *, force=False: queued.append((names, force)) or ["t1", "t2"],
    )

    result = setlistfm.queue_outdated_show_setlist_refreshes(
        ["Fresh Act", "Legacy Act", "Missing Act", "Stale Act"]
    )

    assert result == ["t1", "t2"]
    assert queued == [(["Missing Act", "Stale Act"], True)]


def test_show_setlist_worker_queues_outdated_billed_artists(monkeypatch):
    from crate import setlistfm
    from crate.db.queries import shows
    from crate.worker_handlers.enrichment import ENRICHMENT_TASK_HANDLERS

    monkeypatch.setattr(
        shows,
        "get_upcoming_shows",
        lambda **kwargs: [{"artist_name": "Main Act", "lineup": ["Support Act"]}],
    )
    monkeypatch.setattr(
        setlistfm,
        "queue_outdated_show_setlist_refreshes",
        lambda names: ["task-1"] if names == ["Main Act", "Support Act"] else [],
    )

    result = ENRICHMENT_TASK_HANDLERS["refresh_show_probable_setlists"]("task", {}, {})

    assert result == {"artist_count": 2, "queued": 1}


def test_cached_setlist_generated_at_reads_the_versioned_cache_entry(monkeypatch):
    from crate import setlistfm

    monkeypatch.setattr(
        setlistfm,
        "get_cache",
        lambda key, max_age_seconds=None: {
            "songs": [{"title": "Hey"}],
            "generated_at": "2026-10-20T10:00:00+00:00",
        },
    )
    assert (
        setlistfm.get_cached_probable_setlist_generated_at("Pixies")
        == "2026-10-20T10:00:00+00:00"
    )

    monkeypatch.setattr(
        setlistfm, "get_cache", lambda key, max_age_seconds=None: [{"title": "Hey"}]
    )
    assert setlistfm.get_cached_probable_setlist_generated_at("Pixies") is None


def test_artist_page_enrichment_reports_when_the_setlist_was_generated(monkeypatch):
    from crate.api import enrichment as api_enrichment

    monkeypatch.setattr(
        api_enrichment, "get_cache", lambda key, max_age_seconds=None: None
    )
    monkeypatch.setattr(
        api_enrichment.setlistfm,
        "get_cached_probable_setlist",
        lambda name: [{"title": "Hey", "frequency": 0.8, "play_count": 4}],
    )
    monkeypatch.setattr(
        api_enrichment.setlistfm,
        "get_cached_probable_setlist_generated_at",
        lambda name: "2026-10-20T10:00:00+00:00",
    )

    payload = api_enrichment.get_artist_page_enrichment("Pixies")

    assert payload["setlist"]["generated_at"] == "2026-10-20T10:00:00+00:00"
    assert payload["setlist"]["total_shows"] == 1
