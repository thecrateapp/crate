from __future__ import annotations

from pathlib import Path
import uuid

from sqlalchemy import text

from crate.db.jobs.smart_mix_backfill import claim_smart_mix_backfill_batch
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.versions import ANALYZER_VERSION


def test_backfill_claims_tracks_in_user_value_order(pg_db, tmp_path: Path) -> None:
    del pg_db
    track_ids = _create_tracks(tmp_path, count=5)
    current_id, offline_id, library_id, played_id, remaining_id = track_ids
    _mark_current_queue(current_id)
    _mark_playlist_track(library_id)
    _mark_played(played_id)

    claimed = claim_smart_mix_backfill_batch(
        limit=5,
        offline_track_ids=[offline_id],
        claimed_by="test-worker",
    )

    assert [row["id"] for row in claimed] == [
        current_id,
        offline_id,
        library_id,
        played_id,
        remaining_id,
    ]
    assert [row["priority"] for row in claimed] == [1, 2, 3, 4, 5]


def test_backfill_respects_retry_bound(pg_db, tmp_path: Path) -> None:
    del pg_db
    [track_id] = _create_tracks(tmp_path, count=1)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id, pipeline, state, attempts, priority, last_error,
                    target_generation
                )
                VALUES (
                    :track_id, 'smart_mix', 'failed', 3, 5, 'permanent', :target
                )
                """
            ),
            {"track_id": track_id, "target": ANALYZER_VERSION},
        )

    assert (
        claim_smart_mix_backfill_batch(
            limit=10,
            max_attempts=3,
            claimed_by="test-worker",
        )
        == []
    )


def test_done_rows_of_an_older_generation_are_claimed_again(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    [track_id] = _create_tracks(tmp_path, count=1)
    _insert_profile(track_id, analyzer_version="smart-mix-v1")
    _insert_processing(
        track_id, state="done", attempts=3, target_generation="smart-mix-v1"
    )

    claimed = claim_smart_mix_backfill_batch(
        limit=10, max_attempts=3, claimed_by="test-worker"
    )

    assert [row["id"] for row in claimed] == [track_id]
    assert _processing_row(track_id) == {
        "state": "analyzing",
        "attempts": 1,
        "target_generation": ANALYZER_VERSION,
    }


def test_exhausted_rows_of_an_older_generation_get_a_fresh_retry_budget(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    [track_id] = _create_tracks(tmp_path, count=1)
    _insert_processing(
        track_id, state="failed", attempts=3, target_generation="smart-mix-v1"
    )

    claimed = claim_smart_mix_backfill_batch(
        limit=10, max_attempts=3, claimed_by="test-worker"
    )

    assert [row["id"] for row in claimed] == [track_id]
    assert _processing_row(track_id)["attempts"] == 1


def test_current_generation_profiles_are_not_claimed(pg_db, tmp_path: Path) -> None:
    del pg_db
    [track_id] = _create_tracks(tmp_path, count=1)
    _insert_profile(track_id, analyzer_version=ANALYZER_VERSION)
    _insert_processing(
        track_id, state="done", attempts=1, target_generation=ANALYZER_VERSION
    )

    assert claim_smart_mix_backfill_batch(limit=10, claimed_by="test-worker") == []


def test_fresh_claims_are_not_stolen_but_expired_ones_are(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    fresh_id, expired_id = _create_tracks(tmp_path, count=2)
    _insert_processing(
        fresh_id, state="analyzing", attempts=1, target_generation=ANALYZER_VERSION
    )
    _insert_processing(
        expired_id,
        state="analyzing",
        attempts=1,
        target_generation=ANALYZER_VERSION,
        claimed_hours_ago=3,
    )

    claimed = claim_smart_mix_backfill_batch(limit=10, claimed_by="test-worker")

    assert [row["id"] for row in claimed] == [expired_id]
    assert _processing_row(expired_id)["attempts"] == 2


def test_concurrent_backfill_claims_skip_locked_tracks(pg_db, tmp_path: Path) -> None:
    del pg_db
    track_ids = _create_tracks(tmp_path, count=2)

    with transaction_scope() as first_session:
        first = claim_smart_mix_backfill_batch(
            limit=1,
            claimed_by="first-worker",
            session=first_session,
        )
        with transaction_scope() as second_session:
            second = claim_smart_mix_backfill_batch(
                limit=1,
                claimed_by="second-worker",
                session=second_session,
            )

    assert [first[0]["id"], second[0]["id"]] == track_ids


def test_backfill_handler_pauses_before_claiming_when_governor_denies(
    monkeypatch,
) -> None:
    from crate.worker_handlers import analysis

    monkeypatch.setattr(
        analysis, "get_smart_mix_campaign", lambda: {"status": "running"}
    )
    monkeypatch.setattr(
        "crate.resource_governor.wait_while_pressured",
        lambda **_kwargs: False,
    )
    monkeypatch.setattr(
        analysis,
        "claim_smart_mix_backfill_batch",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("must not claim while resource pressured")
        ),
        raising=False,
    )

    result = analysis._handle_backfill_smart_mix_profiles(
        "task-1", {"batch_size": 20}, {}
    )

    assert result == {"claimed": 0, "queued": 0, "paused": True}


def test_compute_profile_handler_resolves_track_inside_worker(monkeypatch) -> None:
    from crate.worker_handlers import analysis
    from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft

    draft = TrackMixProfileDraft(
        analyzer="crate-python",
        analyzer_version="smart-mix-v1",
        duration_ms=10_000,
        quality=MixProfileQuality.PARTIAL,
    )
    monkeypatch.setattr(
        analysis,
        "resolve_smart_mix_track",
        lambda **_kwargs: {
            "id": 7,
            "entity_uid": str(uuid.uuid4()),
            "path": "/music/artist/album/track.flac",
        },
        raising=False,
    )
    monkeypatch.setattr("crate.audio_analysis.analyze_mix_profile", lambda _path: draft)
    captured: list[tuple[int, str, str | None]] = []
    monkeypatch.setattr(
        analysis,
        "capture_smart_mix_source",
        lambda track_id, path, *, claim_token=None: (
            captured.append((track_id, str(path), claim_token)) or "capture"
        ),
    )
    monkeypatch.setattr(
        analysis,
        "publish_smart_mix_profile",
        lambda capture, _draft: analysis.SmartMixPublication.PUBLISHED,
    )
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)

    result = analysis._handle_compute_smart_mix_profile(
        "task-1",
        {"track_entity_uid": str(uuid.uuid4()), "claim_token": "worker:claim"},
        {},
    )

    assert result == {
        "track_id": 7,
        "stored": True,
        "outcome": "published",
        "quality": "partial",
    }
    assert captured == [(7, "/music/artist/album/track.flac", "worker:claim")]


def _create_tracks(tmp_path: Path, *, count: int) -> list[int]:
    suffix = uuid.uuid4().hex
    artist = f"Backfill Artist {suffix}"
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, entity_uid)
                VALUES (:artist, CAST(:artist_uid AS uuid))
                """
            ),
            {"artist": artist, "artist_uid": str(uuid.uuid4())},
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid)
                VALUES (:artist, :album, :path, CAST(:album_uid AS uuid))
                RETURNING id
                """
            ),
            {
                "artist": artist,
                "album": f"Album {suffix}",
                "path": str(tmp_path / f"album-{suffix}"),
                "album_uid": str(uuid.uuid4()),
            },
        ).scalar_one()
        track_ids = []
        for index in range(count):
            path = tmp_path / f"{suffix}-{index}.flac"
            path.write_bytes(f"track-{index}".encode())
            track_ids.append(
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
                                CAST(:track_uid AS uuid), 180.0
                            )
                            RETURNING id
                            """
                        ),
                        {
                            "album_id": album_id,
                            "artist": artist,
                            "album": f"Album {suffix}",
                            "filename": path.name,
                            "title": f"Track {index}",
                            "path": str(path),
                            "track_uid": str(uuid.uuid4()),
                        },
                    ).scalar_one()
                )
            )
    return track_ids


def _create_user() -> int:
    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    """
                    INSERT INTO users (email, name, created_at)
                    VALUES (:email, 'Smart Mix User', NOW())
                    RETURNING id
                    """
                ),
                {"email": f"smart-mix-{uuid.uuid4().hex}@example.test"},
            ).scalar_one()
        )


def _mark_current_queue(track_id: int) -> None:
    user_id = _create_user()
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_devices (
                    user_id, device_id, device_type, created_at, updated_at
                )
                VALUES (:user_id, 'test-device', 'test', NOW(), NOW())
                """
            ),
            {"user_id": user_id},
        )
        session.execute(
            text(
                """
                INSERT INTO user_playback_device_states (
                    user_id, device_id, status, track_id, queue_json
                )
                VALUES (:user_id, 'test-device', 'playing', :track_id, '[]'::jsonb)
                """
            ),
            {"user_id": user_id, "track_id": track_id},
        )


def _mark_playlist_track(track_id: int) -> None:
    with transaction_scope() as session:
        playlist_id = session.execute(
            text(
                """
                INSERT INTO playlists (name, created_at, updated_at)
                VALUES ('Smart Mix Priority', NOW(), NOW())
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO playlist_tracks (
                    playlist_id, track_id, title, position, added_at
                )
                VALUES (:playlist_id, :track_id, 'Priority', 0, NOW())
                """
            ),
            {"playlist_id": playlist_id, "track_id": track_id},
        )


def _mark_played(track_id: int) -> None:
    user_id = _create_user()
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_play_events (
                    user_id, track_id, started_at, ended_at, played_seconds,
                    was_skipped, was_completed, created_at
                )
                VALUES (
                    :user_id, :track_id, NOW() - INTERVAL '3 minutes', NOW(),
                    180, false, true, NOW()
                )
                """
            ),
            {"user_id": user_id, "track_id": track_id},
        )


def _insert_profile(track_id: int, *, analyzer_version: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, analyzed_at
                )
                VALUES (
                    :track_id, 1, :revision, 'crate-rust',
                    :analyzer_version, 'source', 'full', NOW()
                )
                """
            ),
            {
                "track_id": track_id,
                "revision": f"revision-{track_id}",
                "analyzer_version": analyzer_version,
            },
        )


def _insert_processing(
    track_id: int,
    *,
    state: str,
    attempts: int,
    target_generation: str,
    claimed_hours_ago: int = 0,
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id, pipeline, state, claimed_by, claimed_at,
                    attempts, priority, target_generation
                )
                VALUES (
                    :track_id, 'smart_mix', :state,
                    CASE WHEN :state = 'analyzing' THEN 'other-worker' END,
                    CASE WHEN :state = 'analyzing'
                        THEN NOW() - make_interval(hours => :hours)
                    END,
                    :attempts, 5, :target
                )
                """
            ),
            {
                "track_id": track_id,
                "state": state,
                "attempts": attempts,
                "target": target_generation,
                "hours": claimed_hours_ago,
            },
        )


def _processing_row(track_id: int) -> dict:
    with read_scope() as session:
        return dict(
            session.execute(
                text(
                    """
                    SELECT state, attempts, target_generation
                    FROM track_processing_state
                    WHERE track_id = :track_id AND pipeline = 'smart_mix'
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .one()
        )


def test_coverage_snapshot_separates_current_stale_failed_and_exhausted(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import refresh_smart_mix_coverage
    from crate.db.queries.smart_mix_admin import get_smart_mix_admin_status

    current, stale, failed, exhausted, missing = _create_tracks(tmp_path, count=5)
    _insert_profile(current, analyzer_version=ANALYZER_VERSION)
    _insert_profile(stale, analyzer_version="smart-mix-v1")
    _insert_processing(
        failed, state="failed", attempts=1, target_generation=ANALYZER_VERSION
    )
    _insert_processing(
        exhausted, state="failed", attempts=3, target_generation=ANALYZER_VERSION
    )

    refresh_smart_mix_coverage(max_attempts=3)
    status = get_smart_mix_admin_status()

    assert status["analyzer_version"] == ANALYZER_VERSION
    assert status["total_tracks"] == 5
    assert status["current_profiles"] == 1
    assert status["stale_profiles"] == 1
    assert status["missing_profiles"] == 4
    assert status["coverage_percent"] == 20.0
    assert status["processing"]["failed"] == 1
    assert status["processing"]["exhausted"] == 1
    assert status["refreshed_at"] is not None
    assert missing not in {current, stale}


def test_status_without_a_snapshot_reports_no_counts(pg_db) -> None:
    del pg_db
    from crate.db.queries.smart_mix_admin import get_smart_mix_admin_status

    status = get_smart_mix_admin_status()

    assert status["refreshed_at"] is None
    assert status["total_tracks"] == 0


def test_status_query_never_scans_library_tracks() -> None:
    import inspect

    from crate.db.queries import smart_mix_admin

    assert "library_tracks" not in inspect.getsource(smart_mix_admin)


def test_in_flight_counts_only_fresh_claims_of_the_current_target(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import count_smart_mix_in_flight

    fresh, expired, old_target = _create_tracks(tmp_path, count=3)
    _insert_processing(
        fresh, state="analyzing", attempts=1, target_generation=ANALYZER_VERSION
    )
    _insert_processing(
        expired,
        state="analyzing",
        attempts=1,
        target_generation=ANALYZER_VERSION,
        claimed_hours_ago=3,
    )
    _insert_processing(
        old_target, state="analyzing", attempts=1, target_generation="smart-mix-v1"
    )

    assert count_smart_mix_in_flight() == 1


def _handler_harness(monkeypatch, *, campaigns, in_flight, claimed=()):
    from crate.worker_handlers import analysis

    calls: dict[str, list] = {"claims": [], "children": [], "saved": [], "next": []}
    campaign_values = iter(campaigns)
    current = {"value": None}

    def next_campaign():
        current["value"] = next(campaign_values, current["value"])
        return current["value"]

    in_flight_values = iter(in_flight)
    monkeypatch.setattr(analysis, "get_smart_mix_campaign", next_campaign)
    monkeypatch.setattr(
        analysis, "count_smart_mix_in_flight", lambda: next(in_flight_values)
    )
    monkeypatch.setattr(
        "crate.resource_governor.wait_while_pressured", lambda **_kwargs: True
    )
    monkeypatch.setattr(
        analysis,
        "claim_smart_mix_backfill_batch",
        lambda **kwargs: calls["claims"].append(kwargs) or list(claimed),
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup",
        lambda task_type, params, *, dedup_key: (
            calls["children"].append((task_type, params, dedup_key))
            or f"child-{len(calls['children'])}"
        ),
    )
    monkeypatch.setattr(analysis, "release_smart_mix_claims", lambda _ids: 0)
    monkeypatch.setattr(
        analysis, "refresh_smart_mix_coverage", lambda **_kwargs: {"total_tracks": 1}
    )
    monkeypatch.setattr(
        analysis,
        "save_smart_mix_campaign",
        lambda campaign: calls["saved"].append(campaign),
    )
    monkeypatch.setattr(
        analysis,
        "queue_next_smart_mix_batch",
        lambda campaign: calls["next"].append(campaign) or "task-next",
    )
    monkeypatch.setattr(analysis, "_sleep", lambda _seconds: None)
    return analysis, calls


def _running_campaign(**overrides) -> dict:
    return {
        "target": ANALYZER_VERSION,
        "status": "running",
        "batch_size": 10,
        "max_attempts": 3,
        "batches": 1,
        "claimed": 10,
        "sequence": 1,
        **overrides,
    }


def test_backfill_handler_does_nothing_unless_the_campaign_runs(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign(status="paused")], in_flight=[]
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result == {"claimed": 0, "queued": 0, "control": "paused"}
    assert calls["claims"] == []
    assert calls["next"] == []


def test_backfill_handler_claims_free_capacity_and_chains_the_next_batch(
    monkeypatch,
) -> None:
    claimed = [
        {"id": 5, "entity_uid": "uid-5", "claim_token": "task:task-1:a"},
        {"id": 6, "entity_uid": "uid-6", "claim_token": "task:task-1:b"},
    ]
    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign()], in_flight=[8], claimed=claimed
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert calls["claims"][0]["limit"] == 2
    assert [child[1]["claim_token"] for child in calls["children"]] == [
        "task:task-1:a",
        "task:task-1:b",
    ]
    assert result["claimed"] == 2
    assert result["next_task_id"] == "task-next"
    assert calls["next"][0]["batches"] == 2
    assert calls["next"][0]["claimed"] == 12


def test_backfill_handler_completes_the_campaign_when_nothing_is_left(
    monkeypatch,
) -> None:
    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign()], in_flight=[0]
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result == {"claimed": 0, "queued": 0, "completed": True}
    assert calls["saved"][-1]["status"] == "completed"
    assert calls["next"] == []


def test_saturated_backfill_waits_then_defers_without_claiming(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign()] * 100,
        in_flight=[10] * 100,
    )
    monkeypatch.setattr(analysis, "_SMART_MIX_BACKFILL_MAX_WAIT_SECONDS", 30)

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result["deferred"] is True
    assert calls["claims"] == []
    assert len(calls["next"]) == 1


def test_pausing_during_the_wait_stops_before_claiming(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(), _running_campaign(status="paused")],
        in_flight=[10, 10],
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result == {"claimed": 0, "queued": 0, "control": "paused"}
    assert calls["claims"] == []
    assert calls["next"] == []


def test_campaign_start_resets_counters_for_a_new_target_and_keeps_a_paused_one(
    pg_db,
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        get_smart_mix_campaign,
        save_smart_mix_campaign,
        start_smart_mix_campaign,
    )

    save_smart_mix_campaign(
        _running_campaign(status="paused", batches=4, claimed=40, sequence=7)
    )
    resumed = start_smart_mix_campaign(batch_size=20, max_attempts=3)
    assert (resumed["status"], resumed["batches"], resumed["sequence"]) == (
        "running",
        4,
        7,
    )

    save_smart_mix_campaign(
        _running_campaign(target="smart-mix-v1", batches=4, claimed=40, sequence=7)
    )
    restarted = start_smart_mix_campaign(batch_size=20, max_attempts=3)
    assert (restarted["target"], restarted["batches"], restarted["sequence"]) == (
        ANALYZER_VERSION,
        0,
        7,
    )
    assert get_smart_mix_campaign()["batch_size"] == 20
