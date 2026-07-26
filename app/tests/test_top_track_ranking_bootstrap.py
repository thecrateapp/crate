def test_startup_queues_top_track_ranking_backfill_when_version_is_stale(
    monkeypatch,
):
    from crate import api
    from crate.db import cache_settings
    from crate.db.repositories import tasks
    from crate.popularity import ARTIST_TOP_TRACK_RANKING_VERSION

    queued: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(cache_settings, "get_setting", lambda _key: None)
    monkeypatch.setattr(
        tasks,
        "create_task_dedup",
        lambda task_type, params, *, dedup_key: queued.append(
            (task_type, params, dedup_key)
        ),
    )

    api._queue_artist_top_track_ranking_backfill()

    assert queued == [
        (
            "compute_popularity",
            {
                "triggered_by": "api_startup",
                "ranking_version": ARTIST_TOP_TRACK_RANKING_VERSION,
            },
            f"bootstrap:artist-top-tracks:v{ARTIST_TOP_TRACK_RANKING_VERSION}",
        )
    ]


def test_startup_skips_current_top_track_ranking_backfill(monkeypatch):
    from crate import api
    from crate.db import cache_settings
    from crate.db.repositories import tasks
    from crate.popularity import ARTIST_TOP_TRACK_RANKING_VERSION

    monkeypatch.setattr(
        cache_settings,
        "get_setting",
        lambda _key: ARTIST_TOP_TRACK_RANKING_VERSION,
    )
    monkeypatch.setattr(
        tasks,
        "create_task_dedup",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("current ranking must not queue a backfill")
        ),
    )

    api._queue_artist_top_track_ranking_backfill()


def test_popularity_finalize_marks_ranking_and_invalidates_artist_surfaces(
    monkeypatch,
):
    from crate.popularity import ARTIST_TOP_TRACK_RANKING_VERSION
    from crate.worker_handlers import analysis

    settings: list[tuple[str, str]] = []
    deleted: list[str] = []
    invalidations: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        "crate.popularity.recompute_track_popularity_scores",
        lambda: {"tracks_scored": 27},
    )
    monkeypatch.setattr(
        "crate.db.cache_settings.set_setting",
        lambda key, value: settings.append((key, value)),
    )
    monkeypatch.setattr(
        "crate.db.cache_store.delete_cache_prefix",
        lambda prefix: deleted.append(prefix),
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )

    result = analysis._popularity_finalize()

    assert result == {"tracks_scored": 27}
    assert settings == [
        ("artist_top_track_ranking_version", ARTIST_TOP_TRACK_RANKING_VERSION)
    ]
    assert deleted == [
        "listen:artist_top_tracks:v1:",
        "listen:artist_top_tracks:v2:",
        "listen:artist_top_tracks:v3:",
        "listen:artist_page:v6:",
    ]
    assert invalidations == [("catalog", "home")]


def test_failed_popularity_chunk_does_not_mark_ranking_backfill_complete(monkeypatch):
    from crate.db.repositories import tasks
    from crate.worker_handlers import analysis

    finalized: list[bool] = []
    updated: list[dict] = []
    monkeypatch.setattr(
        tasks,
        "check_siblings_complete",
        lambda _parent_id: {
            "all_done": True,
            "total": 2,
            "completed": 1,
            "failed": 1,
        },
    )
    monkeypatch.setattr(
        tasks,
        "update_task",
        lambda _task_id, **kwargs: updated.append(kwargs),
    )
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setitem(
        analysis._PARENT_FINALIZERS,
        "compute_popularity",
        lambda: finalized.append(True) or {},
    )

    analysis._try_complete_parent("parent-1", "compute_popularity")

    assert finalized == []
    assert updated[0]["result"]["finalization_skipped"] is True


def test_empty_popularity_backfill_still_finalizes_ranking_version(monkeypatch):
    from crate.worker_handlers import analysis

    finalized: list[bool] = []
    monkeypatch.setattr(
        analysis,
        "_chunk_coordinator",
        lambda *_args, **_kwargs: {"chunks": 0, "artists": 0},
    )
    monkeypatch.setattr(
        analysis,
        "_popularity_finalize",
        lambda: finalized.append(True) or {"tracks_scored": 0},
    )

    result = analysis._handle_compute_popularity("task-1", {}, {})

    assert result == {"chunks": 0, "artists": 0, "tracks_scored": 0}
    assert finalized == [True]
