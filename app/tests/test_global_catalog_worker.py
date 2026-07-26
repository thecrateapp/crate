def _stub_full_run_tracking(monkeypatch, global_catalog, *, run_id="run-1"):
    monkeypatch.setattr(
        global_catalog,
        "begin_global_catalog_reconciliation_run",
        lambda **_kwargs: run_id,
    )
    monkeypatch.setattr(
        global_catalog,
        "record_global_catalog_reconciliation_batch",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        global_catalog,
        "complete_global_catalog_reconciliation_run",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        global_catalog,
        "fail_global_catalog_reconciliation_run",
        lambda *_args, **_kwargs: None,
    )


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

    _stub_full_run_tracking(monkeypatch, global_catalog)
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
        lambda *, batch_size, cursor, recompute_matches: (
            calls.append(f"local:{batch_size}")
            or calls.append(f"recompute:{recompute_matches}")
            or {"completed": True, "source_rows_seen": batch_size}
        ),
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert calls == ["local:500", "recompute:True"]
    assert result["status"] == "continued"
    assert result["phase"] == "local"


def test_full_worker_processes_one_bounded_batch_then_enqueues_continuation(
    monkeypatch,
):
    from crate.worker_handlers import global_catalog

    _stub_full_run_tracking(monkeypatch, global_catalog)
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
        lambda *, batch_size, cursor, recompute_matches: (
            local_calls.append(cursor)
            or local_calls.append(recompute_matches)
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

    assert local_calls == [None, True]
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
                "run_id": "run-1",
            }
        },
    )


def test_full_worker_resumes_persisted_batches_before_marking_ready(monkeypatch):
    from crate.worker_handlers import global_catalog

    _stub_full_run_tracking(monkeypatch, global_catalog)
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
                "run_id": "run-1",
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
        lambda *, batch_size, cursor, recompute_matches: (
            local_cursors.append(cursor)
            or local_cursors.append(recompute_matches)
            or {"completed": True, "next_cursor": None, "source_rows_seen": 1}
        ),
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-1", {}, {})

    assert result["status"] == "continued"
    assert local_cursors == [
        {"entity_type": "artist", "after_id": 500},
        True,
    ]
    assert transitions[-1] == (
        "backfilling",
        {
            "bootstrap_cursor_json": {
                "phase": "local_prune",
                "cursor": None,
                "run_id": "run-1",
            }
        },
    )


def test_full_worker_starts_new_run_when_resuming_failed_checkpoint(monkeypatch):
    from crate.worker_handlers import global_catalog

    transitions: list[tuple[str, dict]] = []
    recorded_runs: list[str] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "failed",
            "bootstrap_cursor_json": {
                "phase": "local",
                "cursor": {"entity_type": "track", "after_id": 250000},
                "run_id": "failed-run",
            },
        },
    )
    monkeypatch.setattr(
        global_catalog,
        "begin_global_catalog_reconciliation_run",
        lambda **_kwargs: "retry-run",
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **kwargs: transitions.append((status, kwargs)),
    )
    monkeypatch.setattr(
        global_catalog,
        "record_global_catalog_reconciliation_batch",
        lambda run_id, _batch: recorded_runs.append(run_id),
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog_batch",
        lambda **_kwargs: {
            "completed": True,
            "next_cursor": None,
            "source_rows_seen": 1,
        },
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-retry", {}, {})

    assert result["status"] == "continued"
    assert recorded_runs == ["retry-run"]
    assert transitions[0] == (
        "backfilling",
        {
            "bootstrap_cursor_json": {
                "phase": "local",
                "cursor": {"entity_type": "track", "after_id": 250000},
                "run_id": "retry-run",
            }
        },
    )
    assert transitions[-1][1]["bootstrap_cursor_json"]["run_id"] == "retry-run"


def test_full_worker_resumes_a_checkpoint_after_a_previous_task_stops(monkeypatch):
    from crate.worker_handlers import global_catalog

    _stub_full_run_tracking(monkeypatch, global_catalog)
    remote_cursors: list[dict | None] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {
                "phase": "remote",
                "cursor": {"entity_type": "artist", "after_id": 500},
                "run_id": "run-1",
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
        lambda *, batch_size, cursor, recompute_matches: (
            remote_cursors.append(cursor)
            or remote_cursors.append(recompute_matches)
            or {"completed": True, "source_rows_seen": 1}
        ),
    )
    monkeypatch.setattr(
        global_catalog, "transition_catalog_state", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-2", {}, {})

    assert result["status"] == "continued"
    assert result["phase"] == "remote"
    assert remote_cursors == [
        {"entity_type": "artist", "after_id": 500},
        True,
    ]


def test_full_worker_refreshes_canonical_payloads_after_match_recompute(monkeypatch):
    from crate.worker_handlers import global_catalog

    _stub_full_run_tracking(monkeypatch, global_catalog)
    transitions: list[dict] = []
    calls: list[dict] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {
                "phase": "local_refresh",
                "cursor": None,
                "run_id": "run-1",
            },
        },
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog_batch",
        lambda **kwargs: (
            calls.append(kwargs)
            or {
                "completed": True,
                "next_cursor": None,
                "source_rows_seen": 5,
            }
        ),
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda _status, **kwargs: transitions.append(
            dict(kwargs["bootstrap_cursor_json"])
        ),
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    result = global_catalog._handle_reconcile_full("task-refresh", {}, {})

    assert calls == [{"batch_size": 500, "cursor": None}]
    assert result["phase"] == "local_refresh"
    assert transitions[-1] == {
        "phase": "remote_refresh",
        "cursor": None,
        "run_id": "run-1",
    }


def test_full_worker_backfills_legacy_user_refs_before_catalog_is_ready(monkeypatch):
    from crate.worker_handlers import global_catalog

    _stub_full_run_tracking(monkeypatch, global_catalog)
    calls: list[str] = []
    transitions: list[str] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {
                "phase": "user_refs",
                "cursor": None,
                "run_id": "run-1",
            },
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

    _stub_full_run_tracking(monkeypatch, global_catalog)
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
                "run_id": "run-1",
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
                    "run_id": "run-1",
                }
            },
        )
    ]


def test_full_worker_marks_catalog_ready_only_after_both_sources_finish(monkeypatch):
    from crate.worker_handlers import global_catalog

    completed_runs: list[str] = []
    _stub_full_run_tracking(monkeypatch, global_catalog)
    monkeypatch.setattr(
        global_catalog,
        "complete_global_catalog_reconciliation_run",
        lambda run_id: completed_runs.append(run_id),
    )
    transitions: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {
                "phase": "snapshots",
                "cursor": None,
                "run_id": "run-1",
            },
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
    assert completed_runs == ["run-1"]


def test_full_worker_starts_and_checkpoints_a_persisted_run(monkeypatch):
    from crate.worker_handlers import global_catalog

    started: list[str] = []
    recorded: list[tuple[str, int]] = []
    transitions: list[dict] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {"status": "ready", "bootstrap_cursor_json": {}},
    )
    monkeypatch.setattr(
        global_catalog,
        "begin_global_catalog_reconciliation_run",
        lambda **_kwargs: started.append("full") or "persisted-run",
    )
    monkeypatch.setattr(
        global_catalog,
        "record_global_catalog_reconciliation_batch",
        lambda run_id, result: recorded.append(
            (run_id, int(result["source_rows_seen"]))
        ),
    )
    monkeypatch.setattr(
        global_catalog,
        "fail_global_catalog_reconciliation_run",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda _status, **kwargs: transitions.append(
            dict(kwargs.get("bootstrap_cursor_json") or {})
        ),
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog_batch",
        lambda **_kwargs: {
            "completed": False,
            "next_cursor": {"entity_type": "track", "after_id": 500},
            "source_rows_seen": 500,
        },
    )
    monkeypatch.setattr(global_catalog, "create_task", lambda *_args, **_kwargs: "next")

    global_catalog._handle_reconcile_full("task-1", {}, {})

    assert started == ["full"]
    assert recorded == [("persisted-run", 500)]
    assert transitions[-1] == {
        "phase": "local",
        "cursor": {"entity_type": "track", "after_id": 500},
        "run_id": "persisted-run",
    }


def test_full_worker_marks_catalog_failed_when_run_tracking_cannot_start(monkeypatch):
    from crate.worker_handlers import global_catalog

    transitions: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {"status": "ready", "bootstrap_cursor_json": {}},
    )
    monkeypatch.setattr(
        global_catalog,
        "begin_global_catalog_reconciliation_run",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("run table unavailable")),
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda status, **kwargs: transitions.append((status, kwargs)),
    )

    try:
        global_catalog._handle_reconcile_full("task-1", {}, {})
    except RuntimeError as exc:
        assert str(exc) == "run table unavailable"
    else:
        raise AssertionError("run creation failure must abort reconciliation")

    assert transitions[-1] == (
        "failed",
        {"last_error": "run table unavailable"},
    )


def test_full_worker_preserves_original_error_if_failure_tracking_also_fails(
    monkeypatch,
):
    from crate.worker_handlers import global_catalog

    _stub_full_run_tracking(monkeypatch, global_catalog)
    monkeypatch.setattr(
        global_catalog,
        "get_catalog_state",
        lambda: {
            "status": "backfilling",
            "bootstrap_cursor_json": {
                "phase": "local",
                "cursor": None,
                "run_id": "run-1",
            },
        },
    )
    monkeypatch.setattr(
        global_catalog,
        "reconcile_local_catalog_batch",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("source failure")),
    )
    monkeypatch.setattr(
        global_catalog,
        "fail_global_catalog_reconciliation_run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("run table failure")
        ),
    )
    monkeypatch.setattr(
        global_catalog,
        "transition_catalog_state",
        lambda *_args, **_kwargs: None,
    )

    try:
        global_catalog._handle_reconcile_full("task-1", {}, {})
    except RuntimeError as exc:
        assert str(exc) == "source failure"
    else:
        raise AssertionError("source reconciliation failure must be preserved")


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
