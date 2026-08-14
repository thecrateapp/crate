from __future__ import annotations

from unittest.mock import patch
import uuid

from fastapi import HTTPException
from sqlalchemy import text

from crate.db.tx import transaction_scope


def test_status_counts_profile_versions_quality_and_checkpoint_state(pg_db) -> None:
    del pg_db
    track_ids = _create_tracks(4)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, analyzed_at
                )
                VALUES
                    (
                        :full_id, 1, 'full-v1', 'crate-rust',
                        'smart-mix-v1', 'source-full', 'full', NOW()
                    ),
                    (
                        :legacy_id, 0 + 2, 'partial-v2', 'crate-rust',
                        'future-v2', 'source-partial', 'partial', NOW()
                    )
                """
            ),
            {"full_id": track_ids[0], "legacy_id": track_ids[1]},
        )
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id, pipeline, state, attempts, priority, last_error
                )
                VALUES
                    (:pending_id, 'smart_mix', 'pending', 0, 3, NULL),
                    (:failed_id, 'smart_mix', 'failed', 2, 5, 'decoder')
                """
            ),
            {"pending_id": track_ids[2], "failed_id": track_ids[3]},
        )

    from crate.db.queries.smart_mix_admin import get_smart_mix_admin_status

    status = get_smart_mix_admin_status()

    assert status == {
        "profile_version": 1,
        "analyzer_version": "smart-mix-v1",
        "total_tracks": 4,
        "current_profiles": 1,
        "missing_profiles": 3,
        "coverage_percent": 25.0,
        "quality": {
            "full": 1,
            "partial": 1,
            "legacy": 0,
            "unavailable": 0,
        },
        "processing": {
            "pending": 1,
            "active": 0,
            "failed": 1,
            "completed": 0,
        },
    }


def test_admin_routes_require_analysis_management_permission(test_app) -> None:
    with patch(
        "crate.api.smart_mix_admin.require_permission",
        side_effect=HTTPException(status_code=403, detail="Forbidden"),
    ):
        status = test_app.get("/api/admin/smart-mix/status")
        backfill = test_app.post(
            "/api/admin/smart-mix/backfill",
            json={"batchSize": 25, "maxAttempts": 3},
        )

    assert status.status_code == 403
    assert backfill.status_code == 403


def test_status_exposes_active_backfill_without_starting_work(
    test_app,
    monkeypatch,
) -> None:
    from crate.api import smart_mix_admin

    monkeypatch.setattr(
        smart_mix_admin,
        "get_smart_mix_admin_status",
        lambda: {
            "profile_version": 1,
            "analyzer_version": "smart-mix-v1",
            "total_tracks": 100,
            "current_profiles": 40,
            "missing_profiles": 60,
            "coverage_percent": 40.0,
            "quality": {
                "full": 35,
                "partial": 5,
                "legacy": 0,
                "unavailable": 0,
            },
            "processing": {
                "pending": 3,
                "active": 2,
                "failed": 1,
                "completed": 34,
            },
        },
    )
    monkeypatch.setattr(
        smart_mix_admin,
        "_backfill_tasks",
        lambda: [
            {
                "id": "task-active",
                "status": "running",
                "created_at": "2026-07-30T10:00:00Z",
                "updated_at": "2026-07-30T10:01:00Z",
            }
        ],
    )
    monkeypatch.setattr(
        smart_mix_admin,
        "create_task_dedup",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("status reads must not queue work")
        ),
    )

    response = test_app.get("/api/admin/smart-mix/status")

    assert response.status_code == 200
    assert response.json()["controlState"] == "running"
    assert response.json()["activeTask"]["id"] == "task-active"
    assert response.json()["coveragePercent"] == 40.0


def test_backfill_is_bounded_and_deduplicated(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    calls: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        smart_mix_admin,
        "create_task_dedup",
        lambda task_type, params, *, dedup_key: (
            calls.append((task_type, params, dedup_key)) or "task-new"
        ),
    )

    response = test_app.post(
        "/api/admin/smart-mix/backfill",
        json={"batchSize": 40, "maxAttempts": 4},
    )
    oversized = test_app.post(
        "/api/admin/smart-mix/backfill",
        json={"batchSize": 101, "maxAttempts": 3},
    )

    assert response.status_code == 200
    assert response.json() == {
        "taskId": "task-new",
        "status": "queued",
        "deduplicated": False,
    }
    assert calls == [
        (
            "backfill_smart_mix_profiles",
            {
                "batch_size": 40,
                "max_attempts": 4,
                "triggered_by": "admin",
            },
            "smart-mix:backfill:v1",
        )
    ]
    assert oversized.status_code == 422


def test_duplicate_backfill_returns_existing_task(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    monkeypatch.setattr(
        smart_mix_admin,
        "create_task_dedup",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        smart_mix_admin,
        "_active_backfill_task",
        lambda: {"id": "task-existing", "status": "delegated"},
    )

    response = test_app.post(
        "/api/admin/smart-mix/backfill",
        json={"batchSize": 25, "maxAttempts": 3},
    )

    assert response.status_code == 200
    assert response.json() == {
        "taskId": "task-existing",
        "status": "already_running",
        "deduplicated": True,
    }


def test_pause_cancel_and_resume_reuse_task_checkpoints(
    test_app,
    monkeypatch,
) -> None:
    from crate.api import smart_mix_admin

    current = {"id": "task-active", "status": "running"}
    updates: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        smart_mix_admin,
        "_active_backfill_task",
        lambda: current,
    )
    monkeypatch.setattr(
        smart_mix_admin,
        "update_task",
        lambda task_id, **kwargs: updates.append((task_id, kwargs)),
    )

    paused = test_app.post("/api/admin/smart-mix/backfill/pause")
    cancelled = test_app.post("/api/admin/smart-mix/backfill/cancel")

    monkeypatch.setattr(
        smart_mix_admin,
        "create_task_dedup",
        lambda *_args, **_kwargs: "task-resumed",
    )
    resumed = test_app.post(
        "/api/admin/smart-mix/backfill/resume",
        json={"batchSize": 30, "maxAttempts": 3},
    )

    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert updates == [
        (
            "task-active",
            {
                "status": "cancelled",
                "result": {"control": "paused", "checkpointed": True},
            },
        ),
        (
            "task-active",
            {
                "status": "cancelled",
                "result": {"control": "cancelled", "checkpointed": True},
            },
        ),
    ]
    assert resumed.status_code == 200
    assert resumed.json()["taskId"] == "task-resumed"
    assert resumed.json()["status"] == "resumed"


def _create_tracks(count: int) -> list[int]:
    suffix = uuid.uuid4().hex
    artist = f"Smart Mix Admin {suffix}"
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, entity_uid)
                VALUES (:artist, CAST(:artist_uid AS UUID))
                """
            ),
            {"artist": artist, "artist_uid": str(uuid.uuid4())},
        )
        album_id = int(
            session.execute(
                text(
                    """
                    INSERT INTO library_albums (artist, name, path, entity_uid)
                    VALUES (:artist, :album, :path, CAST(:album_uid AS UUID))
                    RETURNING id
                    """
                ),
                {
                    "artist": artist,
                    "album": f"Album {suffix}",
                    "path": f"/music/smart-mix-admin/{suffix}",
                    "album_uid": str(uuid.uuid4()),
                },
            ).scalar_one()
        )
        return [
            int(
                session.execute(
                    text(
                        """
                        INSERT INTO library_tracks (
                            album_id, artist, album, filename, title, path,
                            entity_uid, duration
                        )
                        VALUES (
                            :album_id, :artist, :album, :filename, :title, :path,
                            CAST(:track_uid AS UUID), 180.0
                        )
                        RETURNING id
                        """
                    ),
                    {
                        "album_id": album_id,
                        "artist": artist,
                        "album": f"Album {suffix}",
                        "filename": f"{index}.flac",
                        "title": f"Track {index}",
                        "path": f"/music/smart-mix-admin/{suffix}/{index}.flac",
                        "track_uid": str(uuid.uuid4()),
                    },
                ).scalar_one()
            )
            for index in range(count)
        ]
