from pathlib import Path


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


def test_setlist_worker_refreshes_and_invalidates_dependent_surfaces(monkeypatch):
    from crate.worker_handlers import enrichment

    invalidations: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        "crate.setlistfm.refresh_probable_setlist",
        lambda name: {"status": "ready", "artist_name": name, "songs": 12},
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )

    result = enrichment._handle_refresh_probable_setlist(
        "task-1", {"artist_name": "High Vis"}, {}
    )

    assert result == {
        "status": "ready",
        "artist_name": "High Vis",
        "songs": 12,
    }
    assert invalidations == [("upcoming", "artist:high-vis")]


def test_api_read_paths_do_not_call_setlist_provider_live():
    root = Path(__file__).parents[1] / "crate" / "api"

    for relative in ("me.py", "browse_artist.py", "enrichment.py"):
        source = (root / relative).read_text()
        assert "setlistfm.get_probable_setlist(" not in source
        assert "get_probable_setlist(artist_name)" not in source
