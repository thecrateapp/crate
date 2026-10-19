from __future__ import annotations

from unittest.mock import patch
import uuid

from fastapi import HTTPException
from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.smart_mix.versions import ANALYZER_VERSION


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
                        :current_version, 'source-full', 'full', NOW()
                    ),
                    (
                        :legacy_id, 0 + 2, 'partial-v2', 'crate-rust',
                        'future-v2', 'source-partial', 'partial', NOW()
                    )
                """
            ),
            {
                "full_id": track_ids[0],
                "legacy_id": track_ids[1],
                "current_version": ANALYZER_VERSION,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id, pipeline, state, attempts, priority, last_error,
                    target_generation
                )
                VALUES
                    (:pending_id, 'smart_mix', 'pending', 0, 3, NULL, :target),
                    (:failed_id, 'smart_mix', 'failed', 2, 5, 'decoder', :target)
                """
            ),
            {
                "pending_id": track_ids[2],
                "failed_id": track_ids[3],
                "target": ANALYZER_VERSION,
            },
        )

    from crate.db.jobs.smart_mix_backfill import refresh_smart_mix_coverage
    from crate.db.queries.smart_mix_admin import get_smart_mix_admin_status

    refresh_smart_mix_coverage(max_attempts=3)
    status = get_smart_mix_admin_status()
    assert status.pop("refreshed_at") is not None

    assert status == {
        "profile_version": 1,
        "analyzer_version": ANALYZER_VERSION,
        "total_tracks": 4,
        "current_profiles": 1,
        "stale_profiles": 1,
        "outdated_profiles": 1,
        "source_changed_profiles": 0,
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
            "exhausted": 0,
            "completed": 0,
        },
        "versions": [
            {"analyzer_version": "future-v2", "profiles": 1, "current": False},
            {"analyzer_version": ANALYZER_VERSION, "profiles": 1, "current": True},
        ],
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
        tracks = test_app.get("/api/admin/smart-mix/tracks")
        reanalyze = test_app.post("/api/admin/smart-mix/tracks/1/reanalyze")

    assert status.status_code == 403
    assert backfill.status_code == 403
    assert tracks.status_code == 403
    assert reanalyze.status_code == 403


def test_track_list_classifies_profiles_and_filters_by_status(pg_db) -> None:
    del pg_db
    current, outdated, changed, missing, failed = _create_tracks(5)
    _insert_profile(current, ANALYZER_VERSION)
    _insert_profile(outdated, "smart-mix-audio-v3")
    _insert_profile(changed, ANALYZER_VERSION, source_stale=True)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id, pipeline, state, attempts, priority, last_error
                )
                VALUES (:track_id, 'smart_mix', 'failed', 3, 5, 'decoder exploded')
                """
            ),
            {"track_id": failed},
        )

    from crate.db.queries.smart_mix_admin_tracks import list_smart_mix_tracks

    every = {row["track_id"]: row for row in list_smart_mix_tracks(limit=100)}

    assert every[current]["status"] == "current"
    assert every[outdated]["status"] == "outdated"
    assert every[outdated]["analyzer_version"] == "smart-mix-audio-v3"
    assert every[changed]["status"] == "source_changed"
    assert every[missing]["status"] == "missing"
    assert every[failed]["processing_error"] == "decoder exploded"
    for status, expected in (
        ("current", [current]),
        ("outdated", [outdated]),
        ("source_changed", [changed]),
        ("missing", [failed, missing]),
        ("failed", [failed]),
    ):
        rows = list_smart_mix_tracks(status=status, limit=100)
        assert [row["track_id"] for row in rows if row["track_id"] in every] == (
            expected
        ), status
    by_version = list_smart_mix_tracks(analyzer_version="smart-mix-audio-v3")
    assert [row["track_id"] for row in by_version] == [outdated]


def test_track_list_searches_and_pages_by_track_id(pg_db) -> None:
    del pg_db
    track_ids = _create_tracks(3)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET title = '100% Pure_Love' WHERE id = :id"),
            {"id": track_ids[1]},
        )

    from crate.db.queries.smart_mix_admin_tracks import list_smart_mix_tracks

    found = list_smart_mix_tracks(search="pure_love")
    literal = list_smart_mix_tracks(search="100%")
    wildcard = list_smart_mix_tracks(search="Pure%Love")
    first = list_smart_mix_tracks(limit=2)
    second = list_smart_mix_tracks(limit=2, before_track_id=first[-1]["track_id"])

    assert [row["track_id"] for row in found] == [track_ids[1]]
    assert [row["track_id"] for row in literal] == [track_ids[1]]
    assert wildcard == []
    assert [row["track_id"] for row in first] == [track_ids[2], track_ids[1]]
    assert second[0]["track_id"] == track_ids[0]


def test_track_route_pages_and_rejects_short_searches(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    calls: list[dict] = []

    def fake_list(**kwargs):
        calls.append(kwargs)
        return [
            {"track_id": track_id, "status": "missing", "title": f"Track {track_id}"}
            for track_id in (30, 20, 10)
        ][: kwargs["limit"]]

    monkeypatch.setattr(smart_mix_admin, "list_smart_mix_tracks", fake_list)

    page = test_app.get("/api/admin/smart-mix/tracks?status=missing&q=Fazer&limit=2")
    short = test_app.get("/api/admin/smart-mix/tracks?q=ab")
    unknown = test_app.get("/api/admin/smart-mix/tracks?status=bogus")

    assert page.status_code == 200
    assert [track["trackId"] for track in page.json()["tracks"]] == [30, 20]
    assert page.json()["nextBefore"] == 20
    assert calls[0] == {
        "status": "missing",
        "analyzer_version": None,
        "search": "Fazer",
        "before_track_id": None,
        "limit": 3,
    }
    assert short.status_code == 422
    assert unknown.status_code == 422


def test_reanalyze_queues_one_profile_task_per_track(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    queued: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        smart_mix_admin,
        "resolve_smart_mix_track",
        lambda *, track_id: (
            {"id": track_id, "entity_uid": "uid-7"} if track_id == 7 else None
        ),
    )

    def fake_dedup(task_type, params, *, dedup_key):
        queued.append((task_type, params, dedup_key))
        return "task-1" if len(queued) == 1 else None

    monkeypatch.setattr(smart_mix_admin, "create_task_dedup", fake_dedup)

    first = test_app.post("/api/admin/smart-mix/tracks/7/reanalyze")
    again = test_app.post("/api/admin/smart-mix/tracks/7/reanalyze")
    missing = test_app.post("/api/admin/smart-mix/tracks/8/reanalyze")

    assert first.status_code == 202
    assert first.json() == {"taskId": "task-1", "status": "queued"}
    assert again.json() == {"taskId": None, "status": "already_queued"}
    assert missing.status_code == 404
    assert queued[0] == (
        "compute_smart_mix_profile",
        {"track_id": 7, "track_entity_uid": "uid-7"},
        "smart-mix-profile:7",
    )


def _coverage(refreshed_at: str | None = "2099-01-01T00:00:00+00:00") -> dict:
    return {
        "profile_version": 1,
        "analyzer_version": ANALYZER_VERSION,
        "total_tracks": 100,
        "current_profiles": 40,
        "stale_profiles": 10,
        "missing_profiles": 60,
        "coverage_percent": 40.0,
        "quality": {"full": 35, "partial": 5, "legacy": 0, "unavailable": 0},
        "processing": {
            "pending": 3,
            "active": 2,
            "failed": 1,
            "exhausted": 1,
            "completed": 34,
        },
        "refreshed_at": refreshed_at,
    }


def _campaign(status: str = "running") -> dict:
    return {
        "target": ANALYZER_VERSION,
        "status": status,
        "batch_size": 25,
        "max_attempts": 3,
        "batches": 2,
        "claimed": 50,
        "sequence": 2,
    }


def test_status_serves_the_snapshot_without_starting_backfill_work(
    test_app,
    monkeypatch,
) -> None:
    from crate.api import smart_mix_admin

    monkeypatch.setattr(smart_mix_admin, "get_smart_mix_admin_status", _coverage)
    monkeypatch.setattr(
        smart_mix_admin, "get_smart_mix_campaign_status", lambda: _campaign()
    )
    monkeypatch.setattr(
        smart_mix_admin,
        "_backfill_tasks",
        lambda: [{"id": "task-active", "status": "running"}],
    )
    monkeypatch.setattr(
        smart_mix_admin,
        "create_task_dedup",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("a fresh snapshot must not queue work")
        ),
    )

    response = test_app.get("/api/admin/smart-mix/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["controlState"] == "running"
    assert payload["activeTask"]["id"] == "task-active"
    assert payload["coveragePercent"] == 40.0
    assert payload["staleProfiles"] == 10
    assert payload["processing"]["exhausted"] == 1
    assert payload["campaign"]["batches"] == 2


def test_missing_snapshot_queues_only_a_coverage_refresh(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    queued: list[tuple[str, str]] = []
    monkeypatch.setattr(
        smart_mix_admin, "get_smart_mix_admin_status", lambda: _coverage(None)
    )
    monkeypatch.setattr(smart_mix_admin, "get_smart_mix_campaign_status", lambda: None)
    monkeypatch.setattr(smart_mix_admin, "_backfill_tasks", lambda: [])
    monkeypatch.setattr(
        smart_mix_admin,
        "create_task_dedup",
        lambda task_type, _params, *, dedup_key: queued.append((task_type, dedup_key)),
    )

    response = test_app.get("/api/admin/smart-mix/status")

    assert response.status_code == 200
    assert response.json()["controlState"] == "idle"
    assert queued == [("refresh_smart_mix_coverage", "smart-mix:coverage")]


def test_backfill_starts_a_bounded_campaign(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    started: list[dict] = []
    monkeypatch.setattr(smart_mix_admin, "_active_backfill_task", lambda: None)
    monkeypatch.setattr(
        smart_mix_admin,
        "start_smart_mix_campaign",
        lambda **kwargs: started.append(kwargs) or _campaign(),
    )
    monkeypatch.setattr(
        smart_mix_admin, "queue_next_smart_mix_batch", lambda _campaign: "task-new"
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
    assert started == [{"batch_size": 40, "max_attempts": 4}]
    assert oversized.status_code == 422


def test_backfill_with_an_active_batch_reuses_it(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    monkeypatch.setattr(
        smart_mix_admin,
        "_active_backfill_task",
        lambda: {"id": "task-existing", "status": "delegated"},
    )
    monkeypatch.setattr(
        smart_mix_admin, "start_smart_mix_campaign", lambda **_kwargs: _campaign()
    )
    monkeypatch.setattr(
        smart_mix_admin,
        "queue_next_smart_mix_batch",
        lambda _campaign: (_ for _ in ()).throw(AssertionError("no second batch")),
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


def test_pause_cancel_and_resume_drive_the_campaign(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    transitions: list[tuple[str, set[str]]] = []
    monkeypatch.setattr(smart_mix_admin, "_active_backfill_task", lambda: None)
    monkeypatch.setattr(
        smart_mix_admin,
        "set_smart_mix_campaign_status",
        lambda status, *, allowed_from: (
            transitions.append((status, allowed_from)) or _campaign(status)
        ),
    )
    monkeypatch.setattr(
        smart_mix_admin, "start_smart_mix_campaign", lambda **_kwargs: _campaign()
    )
    monkeypatch.setattr(
        smart_mix_admin, "queue_next_smart_mix_batch", lambda _campaign: "task-resumed"
    )

    paused = test_app.post("/api/admin/smart-mix/backfill/pause")
    cancelled = test_app.post("/api/admin/smart-mix/backfill/cancel")
    resumed = test_app.post(
        "/api/admin/smart-mix/backfill/resume",
        json={"batchSize": 30, "maxAttempts": 3},
    )

    assert paused.json()["status"] == "paused"
    assert cancelled.json()["status"] == "cancelled"
    assert transitions == [
        ("paused", {"running"}),
        ("cancelled", {"running", "paused"}),
    ]
    assert resumed.json() == {
        "taskId": "task-resumed",
        "status": "resumed",
        "deduplicated": False,
    }


def test_pause_without_a_running_campaign_conflicts(test_app, monkeypatch) -> None:
    from crate.api import smart_mix_admin

    monkeypatch.setattr(
        smart_mix_admin,
        "set_smart_mix_campaign_status",
        lambda _status, *, allowed_from: None,
    )

    assert test_app.post("/api/admin/smart-mix/backfill/pause").status_code == 409


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


def _insert_profile(
    track_id: int, analyzer_version: str, *, source_stale: bool = False
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, analyzed_at,
                    source_stale_at
                )
                VALUES (
                    :track_id, 1, :revision, 'crate-rust', :analyzer_version,
                    'source', 'full', NOW(), CASE WHEN :stale THEN NOW() END
                )
                """
            ),
            {
                "track_id": track_id,
                "revision": f"profile-{track_id}",
                "analyzer_version": analyzer_version,
                "stale": source_stale,
            },
        )
