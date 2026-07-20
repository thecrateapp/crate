from crate.worker_handlers.management import (
    _handle_move_artist,
    _handle_repair,
    _handle_repair_duplicate_tracks,
)


def test_handle_index_genres_broadcasts_library_cache_invalidation(monkeypatch):
    from crate.worker_handlers.analysis import _handle_index_genres

    emitted_events: list[tuple[str, str, dict]] = []
    broadcasted_scopes: list[tuple[str, ...]] = []

    monkeypatch.setattr(
        "crate.genre_indexer.index_all_genres",
        lambda progress_callback=None: {"total_genres": 2},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.analysis.emit_task_event",
        lambda task_id, level, payload: emitted_events.append(
            (task_id, level, payload)
        ),
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: broadcasted_scopes.append(scopes),
    )

    result = _handle_index_genres("index-genres-1", {}, {"library_path": "/music"})

    assert result == {"total_genres": 2}
    assert emitted_events[-1] == (
        "index-genres-1",
        "info",
        {"message": "Genres indexed: 2 genres"},
    )
    assert broadcasted_scopes == [("library", "home")]


def test_handle_repair_duplicate_tracks_delegates_high_confidence_rows(monkeypatch):
    captured: dict = {}
    duplicate_rows = [
        {
            "album_id": 55,
            "artist": "Gurriers",
            "album": "Come and See",
            "title": "Nausea",
            "track_number": 1,
            "disc_number": 1,
            "cnt": 2,
            "paths": ["/music/Gurriers/01-low.mp3", "/music/Gurriers/01-hi.flac"],
            "track_ids": [101, 102],
            "tracks": [{"id": 101}, {"id": 102}],
            "fingerprinted_count": 2,
            "missing_fingerprint_count": 0,
        }
    ]

    monkeypatch.setattr(
        "crate.worker_handlers.management.get_duplicate_tracks",
        lambda: duplicate_rows,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management._handle_repair",
        lambda task_id, params, config: (
            captured.update({"task_id": task_id, "params": params, "config": config})
            or {"summary": {"applied": 1}}
        ),
    )

    result = _handle_repair_duplicate_tracks(
        "repair-duplicates-1",
        {},
        {"library_path": "/tmp/fake"},
    )

    assert result == {"summary": {"applied": 1}}
    assert captured == {
        "task_id": "repair-duplicates-1",
        "config": {"library_path": "/tmp/fake"},
        "params": {
            "dry_run": False,
            "auto_only": True,
            "issues": [
                {
                    "check": "duplicate_tracks",
                    "severity": "medium",
                    "details": {
                        "album_id": 55,
                        "artist": "Gurriers",
                        "album": "Come and See",
                        "title": "Nausea",
                        "track_number": 1,
                        "disc_number": 1,
                        "count": 2,
                        "paths": [
                            "/music/Gurriers/01-low.mp3",
                            "/music/Gurriers/01-hi.flac",
                        ],
                        "track_ids": [101, 102],
                        "tracks": duplicate_rows[0]["tracks"],
                        "fingerprinted_count": 2,
                        "missing_fingerprint_count": 0,
                    },
                }
            ],
        },
    }


def test_move_artist_restores_directory_when_database_rename_fails(
    tmp_path, monkeypatch
):
    source = tmp_path / "old-folder"
    target = tmp_path / "Renamed Artist"
    source.mkdir()
    (source / "song.flac").write_bytes(b"audio")

    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_artist",
        lambda _name: {"name": "Old Artist", "folder_name": "old-folder"},
    )

    def fail_rename(*_args):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        "crate.worker_handlers.management.rename_artist_in_db", fail_rename
    )

    try:
        _handle_move_artist(
            "move-artist-1",
            {"name": "Old Artist", "new_name": "Renamed Artist"},
            {"library_path": str(tmp_path)},
        )
    except RuntimeError as exc:
        assert str(exc) == "database unavailable"
    else:
        raise AssertionError("database failure must be propagated")

    assert source.is_dir()
    assert (source / "song.flac").read_bytes() == b"audio"
    assert not target.exists()


def test_handle_repair_revalidates_applied_checks(monkeypatch):
    emitted: list[tuple[str, str, dict]] = []
    domain_events: list[tuple[str, dict, str, str]] = []
    resolved_issue_ids: list[int] = []

    class FakeRepair:
        def __init__(self, config):
            self.config = config

        def repair(
            self,
            report,
            dry_run=True,
            auto_only=True,
            task_id=None,
            progress_callback=None,
            event_callback=None,
        ):
            assert dry_run is False
            assert auto_only is False
            if event_callback:
                event_callback(
                    {
                        "event_type": "item",
                        "level": "info",
                        "check_type": "has_photo_desync",
                        "outcome": "applied",
                        "item_key": "issue:7",
                        "target": "Birds In Row/UGLY",
                        "action": "delete_loose",
                        "message": "Applied delete loose on Birds In Row/UGLY",
                    }
                )
            return {
                "actions": [{"action": "delete_loose", "applied": True, "details": {}}],
                "item_results": [
                    {
                        "check_type": "has_photo_desync",
                        "outcome": "applied",
                    }
                ],
                "summary": {"applied": 1, "skipped": 0, "failed": 0, "unsupported": 0},
                "fs_changed": False,
                "db_changed": True,
                "resolved_ids": [7],
                "unsupported_checks": [],
            }

    class FakeHealthCheck:
        def __init__(self, config):
            self.config = config

        def run_selected(self, check_types, *, progress_callback=None, persist=True):
            assert set(check_types) == {"has_photo_desync"}
            assert persist is True
            if progress_callback:
                progress_callback({"check": "has_photo_desync", "done": 0, "total": 1})
            return {
                "issues": [],
                "summary": {},
                "check_count": 1,
                "duration_ms": 12,
                "scanned_at": "2026-04-30T10:00:00+00:00",
            }

    monkeypatch.setattr("crate.repair.LibraryRepair", FakeRepair)
    monkeypatch.setattr("crate.health_check.LibraryHealthCheck", FakeHealthCheck)
    monkeypatch.setattr(
        "crate.worker_handlers.management.emit_progress", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.emit_task_event",
        lambda task_id, event_type, payload: emitted.append(
            (task_id, event_type, payload)
        ),
    )
    monkeypatch.setattr(
        "crate.db.domain_events.append_domain_event",
        lambda event_type, payload, scope=None, subject_key=None: domain_events.append(
            (event_type, payload, scope, subject_key)
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.resolve_issue",
        lambda issue_id: resolved_issue_ids.append(issue_id),
    )
    monkeypatch.setattr(
        "crate.db.admin_health_surface.publish_health_surface_signal",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management._mark_processing",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management._unmark_processing",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.start_scan", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_open_issues", lambda limit=10000: []
    )

    result = _handle_repair(
        "repair-task-1",
        {
            "dry_run": False,
            "auto_only": False,
            "issues": [
                {
                    "id": 7,
                    "check": "duplicate_albums",
                    "details": {"artist": "Birds In Row", "album": "UGLY"},
                }
            ],
        },
        {"library_path": "/tmp/fake", "audio_extensions": [".flac"]},
    )

    assert resolved_issue_ids == [7]
    assert result["revalidated_checks"] == ["has_photo_desync"]
    assert result["revalidation"] == {
        "issue_count": 0,
        "summary": {},
        "duration_ms": 12,
    }
    assert "open after revalidation" in result["message"]
    assert any(
        "Revalidating 1 repaired check type" in payload.get("message", "")
        for _, _, payload in emitted
    )
    assert any(
        event_type == "library.repair.completed"
        for event_type, _, _, _ in domain_events
    )


def test_handle_repair_revalidates_artist_layout_fix_for_target_artist_only(
    monkeypatch,
):
    emitted: list[tuple[str, str, dict]] = []
    targeted_revalidations: list[tuple[set[str], list[str]]] = []

    class FakeRepair:
        def __init__(self, config):
            self.config = config

        def repair(
            self,
            report,
            dry_run=True,
            auto_only=True,
            task_id=None,
            progress_callback=None,
            event_callback=None,
        ):
            return {
                "actions": [
                    {"action": "artist_layout_fix", "applied": True, "details": {}}
                ],
                "item_results": [
                    {
                        "check_type": "artist_layout_fix",
                        "outcome": "applied",
                    }
                ],
                "summary": {"applied": 1, "skipped": 0, "failed": 0, "unsupported": 0},
                "fs_changed": False,
                "db_changed": True,
                "resolved_ids": [9],
                "unsupported_checks": [],
            }

    class FakeHealthCheck:
        def __init__(self, config):
            self.config = config

        def run_selected(self, check_types, *, progress_callback=None, persist=True):
            raise AssertionError(
                "artist-scoped repairs must not trigger global revalidation"
            )

        def run_selected_for_artists(
            self, check_types, artist_names, *, progress_callback=None, persist=True
        ):
            targeted_revalidations.append((set(check_types), list(artist_names)))
            assert persist is True
            if progress_callback:
                progress_callback(
                    {
                        "check": "artist_layout_fix",
                        "artist": "Birds In Row",
                        "done": 1,
                        "total": 1,
                    }
                )
            return {
                "issues": [],
                "summary": {},
                "check_count": 1,
                "duration_ms": 9,
                "scanned_at": "2026-04-30T10:00:00+00:00",
                "artist_count": 1,
            }

    monkeypatch.setattr("crate.repair.LibraryRepair", FakeRepair)
    monkeypatch.setattr("crate.health_check.LibraryHealthCheck", FakeHealthCheck)
    monkeypatch.setattr(
        "crate.worker_handlers.management.emit_progress", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.emit_task_event",
        lambda task_id, event_type, payload: emitted.append(
            (task_id, event_type, payload)
        ),
    )
    monkeypatch.setattr(
        "crate.db.domain_events.append_domain_event", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.resolve_issue", lambda issue_id: None
    )
    monkeypatch.setattr(
        "crate.db.admin_health_surface.publish_health_surface_signal",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management._mark_processing",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management._unmark_processing",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.start_scan", lambda *args, **kwargs: None
    )

    result = _handle_repair(
        "repair-task-2",
        {
            "dry_run": False,
            "auto_only": False,
            "issues": [
                {
                    "id": 9,
                    "check": "artist_layout_fix",
                    "details": {"artist": "Birds In Row"},
                }
            ],
        },
        {"library_path": "/tmp/fake", "audio_extensions": [".flac"]},
    )

    assert targeted_revalidations == [({"artist_layout_fix"}, ["Birds In Row"])]
    assert result["revalidated_checks"] == ["artist_layout_fix"]
    assert result["skipped_revalidation_checks"] == []
    assert result["revalidation"] == {"issue_count": 0, "summary": {}, "duration_ms": 9}
    assert any(
        "Artist revalidation complete" in payload.get("message", "")
        for _, _, payload in emitted
    )
