def test_incremental_worker_claims_only_dirty_catalog_sources(monkeypatch):
    from crate.worker_handlers import global_catalog

    snapshot_refreshes: list[bool] = []
    monkeypatch.setattr(
        global_catalog,
        "refresh_global_catalog_genre_snapshots",
        lambda: snapshot_refreshes.append(True),
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_dirty_catalog_sources",
        lambda limit: {
            "claimed": limit,
            "completed": limit,
            "failed": 0,
            "remaining": 0,
        },
    )

    result = global_catalog._handle_reconcile_incremental(
        "task-1", {"batch_size": 123}, {}
    )

    assert result == {
        "status": "completed",
        "mode": "incremental",
        "claimed": 123,
        "completed": 123,
        "failed": 0,
        "remaining": 0,
    }
    assert snapshot_refreshes == [True]


def test_incremental_worker_has_no_global_catalog_feature_gate(monkeypatch):
    from crate.worker_handlers import global_catalog

    monkeypatch.setattr(
        global_catalog, "refresh_global_catalog_genre_snapshots", lambda: None
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_dirty_catalog_sources",
        lambda limit: {"claimed": 0, "completed": 0, "failed": 0, "remaining": 0},
    )

    result = global_catalog._handle_reconcile_incremental(
        "task-1", {"batch_size": 123}, {}
    )

    assert result["status"] == "completed"
    assert result["mode"] == "incremental"


def test_full_worker_runs_local_then_remote_reconciliation(monkeypatch):
    from crate.worker_handlers import global_catalog

    calls: list[str] = []
    monkeypatch.setattr(global_catalog, "get_catalog_state", lambda: {"status": "cold"})
    monkeypatch.setattr(
        global_catalog, "transition_catalog_state", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        global_catalog, "refresh_global_catalog_genre_snapshots", lambda: None
    )
    monkeypatch.setattr(
        global_catalog,
        "backfill_legacy_user_library_refs",
        lambda: {"artist_follows": 0, "album_saves": 0},
    )

    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog",
        lambda batch_size: calls.append(f"local:{batch_size}") or {},
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_remote_catalog",
        lambda batch_size: calls.append(f"remote:{batch_size}") or {},
    )

    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert calls == ["local:500", "remote:500"]
    assert result["status"] == "completed"


def test_full_worker_backfills_legacy_user_refs_before_catalog_is_ready(monkeypatch):
    from crate.worker_handlers import global_catalog

    calls: list[str] = []
    transitions: list[str] = []
    monkeypatch.setattr(global_catalog, "get_catalog_state", lambda: {"status": "cold"})
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **_kwargs: transitions.append(status),
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog",
        lambda batch_size: calls.append("local") or {"batch_size": batch_size},
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_remote_catalog",
        lambda batch_size: calls.append("remote") or {"batch_size": batch_size},
    )
    monkeypatch.setattr(
        global_catalog,
        "refresh_global_catalog_genre_snapshots",
        lambda: calls.append("genres"),
    )
    monkeypatch.setattr(
        global_catalog,
        "backfill_legacy_user_library_refs",
        lambda: calls.append("user_refs") or {"artist_follows": 1, "album_saves": 1},
    )

    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert calls == ["local", "remote", "genres", "user_refs"]
    assert transitions == ["backfilling", "ready"]
    assert result["user_refs"] == {"artist_follows": 1, "album_saves": 1}


def test_full_worker_marks_catalog_ready_only_after_both_sources_finish(monkeypatch):
    from crate.worker_handlers import global_catalog

    transitions: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog",
        lambda batch_size: {"sources_upserted": batch_size},
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_remote_catalog",
        lambda batch_size: {"sources_upserted": 0},
    )
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {"status": "cold"},
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **kwargs: transitions.append((status, kwargs)),
    )
    monkeypatch.setattr(
        global_catalog, "refresh_global_catalog_genre_snapshots", lambda: None
    )
    monkeypatch.setattr(
        global_catalog,
        "backfill_legacy_user_library_refs",
        lambda: {"artist_follows": 0, "album_saves": 0},
    )

    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert result["status"] == "completed"
    assert [status for status, _ in transitions] == ["backfilling", "ready"]
    assert "last_full_reconcile_at" in transitions[-1][1]


def test_global_catalog_tasks_are_registered_in_worker():
    from crate.worker import TASK_HANDLERS

    assert "global_catalog_reconcile_incremental" in TASK_HANDLERS
    assert "global_catalog_reconcile_full" in TASK_HANDLERS


def test_global_catalog_tasks_use_maintenance_queue():
    from crate.actors import TASK_POOL_CONFIG

    assert (
        TASK_POOL_CONFIG["global_catalog_reconcile_incremental"].queue == "maintenance"
    )
    assert TASK_POOL_CONFIG["global_catalog_reconcile_full"].queue == "maintenance"
