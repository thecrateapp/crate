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


def test_full_worker_advances_from_local_to_prune_without_scanning_remote(monkeypatch):
    from crate.worker_handlers import global_catalog

    calls: list[str] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {"status": "cold", "bootstrap_cursor_json": {}},
    )
    monkeypatch.setattr(
        global_catalog, "transition_catalog_state", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog_batch",
        lambda *, batch_size, cursor: (
            calls.append(f"local:{batch_size}")
            or {"completed": True, "source_rows_seen": batch_size}
        ),
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert calls == ["local:500"]
    assert result["status"] == "continued"
    assert result["phase"] == "local"


def test_full_worker_processes_one_bounded_batch_then_enqueues_continuation(
    monkeypatch,
):
    from crate.worker_handlers import global_catalog

    transitions: list[tuple[str, dict]] = []
    continuations: list[dict] = []
    local_calls: list[dict | None] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {"status": "cold", "bootstrap_cursor_json": {}},
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **kwargs: transitions.append((status, kwargs)),
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog_batch",
        lambda *, batch_size, cursor: (
            local_calls.append(cursor)
            or {
                "completed": False,
                "next_cursor": {"entity_type": "artist", "after_id": batch_size},
                "source_rows_seen": batch_size,
            }
        ),
    )
    monkeypatch.setattr(
        global_catalog,
        "create_task",
        lambda task_type, params, **kwargs: (
            continuations.append({"task_type": task_type, "params": params, **kwargs})
            or "continuation-task"
        ),
        raising=False,
    )

    result = global_catalog._handle_reconcile_full("task-1", {"batch_size": 25}, {})

    assert local_calls == [None]
    assert result["status"] == "continued"
    assert result["completed"] is False
    assert result["phase"] == "local"
    assert continuations == [
        {
            "task_type": "global_catalog_reconcile_full",
            "params": {"batch_size": 25, "triggered_by": "continuation"},
            "parent_task_id": "task-1",
            "dedup_key": "global-catalog:full",
        }
    ]
    assert transitions[-1] == (
        "backfilling",
        {
            "bootstrap_cursor_json": {
                "phase": "local",
                "cursor": {"entity_type": "artist", "after_id": 25},
            }
        },
    )


def test_full_worker_resumes_persisted_batches_before_marking_ready(monkeypatch):
    from crate.worker_handlers import global_catalog

    transitions: list[tuple[str, dict]] = []
    local_cursors: list[dict | None] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {
                "phase": "local",
                "cursor": {"entity_type": "artist", "after_id": 500},
            },
        },
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **kwargs: transitions.append((status, kwargs)),
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog_batch",
        lambda *, batch_size, cursor: (
            local_cursors.append(cursor)
            or {"completed": True, "next_cursor": None, "source_rows_seen": 1}
        ),
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert result["status"] == "continued"
    assert local_cursors == [{"entity_type": "artist", "after_id": 500}]
    assert transitions[-1] == (
        "backfilling",
        {
            "bootstrap_cursor_json": {
                "phase": "local_prune",
                "cursor": None,
            }
        },
    )


def test_full_worker_resumes_a_checkpoint_after_a_previous_task_stops(monkeypatch):
    from crate.worker_handlers import global_catalog

    remote_cursors: list[dict | None] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {
                "phase": "remote",
                "cursor": {"entity_type": "artist", "after_id": 500},
            },
        },
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog_batch",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("local reconciliation was already checkpointed")
        ),
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_remote_catalog_batch",
        lambda *, batch_size, cursor: (
            remote_cursors.append(cursor) or {"completed": True, "source_rows_seen": 1}
        ),
    )
    monkeypatch.setattr(
        global_catalog, "transition_catalog_state", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-2", {}, {})

    assert result["status"] == "continued"
    assert result["phase"] == "remote"
    assert remote_cursors == [{"entity_type": "artist", "after_id": 500}]


def test_full_worker_backfills_legacy_user_refs_before_catalog_is_ready(monkeypatch):
    from crate.worker_handlers import global_catalog

    calls: list[str] = []
    transitions: list[str] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {"phase": "user_refs", "cursor": None},
        },
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **_kwargs: transitions.append(status),
    )
    monkeypatch.setattr(
        global_catalog,
        "backfill_legacy_user_library_refs_batch",
        lambda **_kwargs: (
            calls.append("user_refs")
            or {
                "artist_follows": 1,
                "album_saves": 1,
                "playlist_tracks": 0,
                "playlist_track_exclusions": 0,
                "play_events": 0,
                "listening_stats_users": 0,
                "users_processed": 1,
                "completed": True,
                "next_cursor": None,
            }
        ),
    )
    monkeypatch.setattr(
        global_catalog,
        "finalize_user_library_refs_backfill",
        lambda report: report,
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert calls == ["user_refs"]
    assert transitions == ["backfilling"]
    assert result["batch"]["artist_follows"] == 1
    assert result["batch"]["album_saves"] == 1
    assert result["status"] == "continued"


def test_full_worker_checkpoints_one_user_reference_batch(monkeypatch):
    from crate.worker_handlers import global_catalog

    transitions: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "user_refs_backfill_version": 0,
            "bootstrap_cursor_json": {
                "phase": "user_refs",
                "cursor": 10,
                "user_refs_report": {"artist_follows": 2},
            },
        },
    )
    monkeypatch.setattr(
        global_catalog,
        "backfill_legacy_user_library_refs_batch",
        lambda **kwargs: {
            "artist_follows": 1,
            "album_saves": 0,
            "track_likes": 0,
            "playlist_tracks": 0,
            "playlist_track_exclusions": 0,
            "play_events": 0,
            "listening_stats_users": 0,
            "users_processed": 5,
            "completed": False,
            "next_cursor": 15,
        },
        raising=False,
    )
    monkeypatch.setattr(
        global_catalog,
        "finalize_user_library_refs_backfill",
        lambda _report: (_ for _ in ()).throw(
            AssertionError("partial batch must not finalize")
        ),
        raising=False,
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **kwargs: transitions.append((status, kwargs)),
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full(
        "task-user-refs", {"batch_size": 5}, {}
    )

    assert result["status"] == "continued"
    assert transitions == [
        (
            "backfilling",
            {
                "bootstrap_cursor_json": {
                    "phase": "user_refs",
                    "cursor": 15,
                    "user_refs_report": {
                        "artist_follows": 3,
                        "album_saves": 0,
                        "track_likes": 0,
                        "playlist_tracks": 0,
                        "playlist_track_exclusions": 0,
                        "play_events": 0,
                        "listening_stats_users": 0,
                    },
                }
            },
        )
    ]


def test_full_worker_marks_catalog_ready_only_after_both_sources_finish(monkeypatch):
    from crate.worker_handlers import global_catalog

    transitions: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {"phase": "snapshots", "cursor": None},
        },
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **kwargs: transitions.append((status, kwargs)),
    )
    monkeypatch.setattr(
        global_catalog, "refresh_global_catalog_genre_snapshots", lambda: None
    )
    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert result["status"] == "completed"
    assert [status for status, _ in transitions] == ["ready"]
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
