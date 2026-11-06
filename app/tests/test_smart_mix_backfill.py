from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import uuid

import pytest
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


def test_previous_analyzer_profiles_are_claimed_for_the_new_generation(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    [track_id] = _create_tracks(tmp_path, count=1)
    _insert_profile(track_id, analyzer_version="smart-mix-audio-v5")
    _insert_processing(
        track_id, state="done", attempts=1, target_generation="smart-mix-audio-v5"
    )

    claimed = claim_smart_mix_backfill_batch(
        limit=10, max_attempts=3, claimed_by="test-worker"
    )

    assert [row["id"] for row in claimed] == [track_id]
    assert _processing_row(track_id)["target_generation"] == ANALYZER_VERSION


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


def test_python_profiles_are_claimed_only_when_promotion_is_enabled(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    [track_id] = _create_tracks(tmp_path, count=1)
    _insert_profile(
        track_id,
        analyzer_version=ANALYZER_VERSION,
        analyzer="crate-python",
        quality="partial",
    )
    _insert_processing(
        track_id, state="done", attempts=1, target_generation=ANALYZER_VERSION
    )

    assert claim_smart_mix_backfill_batch(limit=10, claimed_by="test-worker") == []
    claimed = claim_smart_mix_backfill_batch(
        limit=10, claimed_by="test-worker", promote_python_profiles=True
    )

    assert [row["id"] for row in claimed] == [track_id]
    assert _processing_row(track_id)["attempts"] == 2


def test_missing_profiles_are_claimed_before_python_promotions(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    promoted_id, missing_id = _create_tracks(tmp_path, count=2)
    _insert_profile(
        promoted_id,
        analyzer_version=ANALYZER_VERSION,
        analyzer="crate-python",
        quality="partial",
    )
    _insert_processing(
        promoted_id, state="done", attempts=1, target_generation=ANALYZER_VERSION
    )

    claimed = claim_smart_mix_backfill_batch(
        limit=1, claimed_by="test-worker", promote_python_profiles=True
    )

    assert [row["id"] for row in claimed] == [missing_id]


def test_python_promotions_respect_the_retry_bound(pg_db, tmp_path: Path) -> None:
    del pg_db
    [track_id] = _create_tracks(tmp_path, count=1)
    _insert_profile(
        track_id,
        analyzer_version=ANALYZER_VERSION,
        analyzer="crate-python",
        quality="partial",
    )
    _insert_processing(
        track_id, state="done", attempts=3, target_generation=ANALYZER_VERSION
    )

    assert (
        claim_smart_mix_backfill_batch(
            limit=10,
            max_attempts=3,
            claimed_by="test-worker",
            promote_python_profiles=True,
        )
        == []
    )


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


def test_concurrent_claims_never_exceed_the_in_flight_limit(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    import threading

    from crate.db.jobs.smart_mix_backfill import count_smart_mix_in_flight

    _create_tracks(tmp_path, count=6)
    claims: dict[str, list[dict]] = {}

    def second_coordinator() -> None:
        claims["second"] = claim_smart_mix_backfill_batch(
            limit=25, max_in_flight=4, claimed_by="task:second"
        )

    with transaction_scope() as first_session:
        claims["first"] = claim_smart_mix_backfill_batch(
            limit=25, max_in_flight=4, claimed_by="task:first", session=first_session
        )
        # The second coordinator counts and claims before the first commits.
        second = threading.Thread(target=second_coordinator)
        second.start()
        second.join(timeout=1)
    second.join(timeout=10)

    assert not second.is_alive()
    assert len(claims["first"]) == 4
    assert claims["second"] == []
    assert count_smart_mix_in_flight() == 4


def test_a_claim_takes_only_the_free_slots(pg_db, tmp_path: Path) -> None:
    del pg_db
    in_flight, *free = _create_tracks(tmp_path, count=4)
    _insert_processing(
        in_flight, state="analyzing", attempts=1, target_generation=ANALYZER_VERSION
    )

    claimed = claim_smart_mix_backfill_batch(
        limit=25, max_in_flight=3, claimed_by="task:coordinator"
    )

    assert len(claimed) == 2
    assert {row["id"] for row in claimed} <= set(free)


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
    refreshes: list[bool] = []
    monkeypatch.setattr(
        analysis, "refresh_live_smart_mix_coverage", lambda: refreshes.append(True)
    )

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
    assert refreshes == [True]


def test_failed_profiles_also_refresh_the_live_coverage(monkeypatch) -> None:
    from crate.worker_handlers import analysis

    monkeypatch.setattr(
        analysis,
        "resolve_smart_mix_track",
        lambda **_kwargs: {"id": 7, "path": "/music/artist/album/track.flac"},
    )
    monkeypatch.setattr(
        analysis, "capture_smart_mix_source", lambda *_args, **_kwargs: "capture"
    )

    def broken(_path):
        raise RuntimeError("decoder exploded")

    monkeypatch.setattr("crate.audio_analysis.analyze_mix_profile", broken)
    monkeypatch.setattr(analysis, "record_smart_mix_failure", lambda *_a, **_k: None)
    refreshes: list[bool] = []
    monkeypatch.setattr(
        analysis, "refresh_live_smart_mix_coverage", lambda: refreshes.append(True)
    )

    result = analysis._handle_compute_smart_mix_profile("task-1", {"track_id": 7}, {})

    assert "decoder exploded" in result["error"]
    assert refreshes == [True]


def test_a_profile_that_cannot_be_stored_is_recorded_as_failed(monkeypatch) -> None:
    from crate.smart_mix.beat_grid import BeatGridCodecError
    from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft
    from crate.worker_handlers import analysis

    monkeypatch.setattr(
        analysis,
        "resolve_smart_mix_track",
        lambda **_kwargs: {"id": 7, "path": "/music/artist/album/track.flac"},
    )
    monkeypatch.setattr(
        analysis, "capture_smart_mix_source", lambda *_args, **_kwargs: "capture"
    )
    monkeypatch.setattr(
        "crate.audio_analysis.analyze_mix_profile",
        lambda _path: TrackMixProfileDraft(
            analyzer="crate-rust",
            analyzer_version=ANALYZER_VERSION,
            duration_ms=10_000,
            quality=MixProfileQuality.FULL,
        ),
    )

    def unstorable(_capture, _draft):
        raise BeatGridCodecError("beat positions must be positive")

    monkeypatch.setattr(analysis, "publish_smart_mix_profile", unstorable)
    failures: list[tuple[int, str, str | None]] = []
    monkeypatch.setattr(
        analysis,
        "record_smart_mix_failure",
        lambda track_id, _path, reason, *, claim_token=None: failures.append(
            (track_id, reason, claim_token)
        ),
    )
    refreshes: list[bool] = []
    monkeypatch.setattr(
        analysis, "refresh_live_smart_mix_coverage", lambda: refreshes.append(True)
    )

    result = analysis._handle_compute_smart_mix_profile(
        "task-1", {"track_id": 7, "claim_token": "worker:claim"}, {}
    )

    assert "publication failed" in result["error"]
    assert failures == [(7, "beat positions must be positive", "worker:claim")]
    assert refreshes == [True]


def test_live_coverage_refresh_is_throttled_while_work_is_in_flight(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        COVERAGE_STATE_KEY,
        refresh_live_smart_mix_coverage,
    )

    [claimed] = _create_tracks(tmp_path, count=1)
    _insert_processing(
        claimed, state="analyzing", attempts=1, target_generation=ANALYZER_VERSION
    )

    assert refresh_live_smart_mix_coverage() is True
    assert refresh_live_smart_mix_coverage() is False

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE ops_runtime_state
                SET updated_at = NOW() - INTERVAL '11 seconds'
                WHERE key = :key
                """
            ),
            {"key": COVERAGE_STATE_KEY},
        )
    assert refresh_live_smart_mix_coverage() is True

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE track_processing_state
                SET state = 'done'
                WHERE track_id = :track_id
                """
            ),
            {"track_id": claimed},
        )
    assert refresh_live_smart_mix_coverage() is True


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


def _insert_profile(
    track_id: int,
    *,
    analyzer_version: str,
    analyzer: str = "crate-rust",
    quality: str = "full",
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, analyzed_at
                )
                VALUES (
                    :track_id, 1, :revision, :analyzer,
                    :analyzer_version, 'source', :quality, NOW()
                )
                """
            ),
            {
                "track_id": track_id,
                "revision": f"revision-{track_id}",
                "analyzer": analyzer,
                "analyzer_version": analyzer_version,
                "quality": quality,
            },
        )


def _insert_processing(
    track_id: int,
    *,
    state: str,
    attempts: int,
    target_generation: str,
    claimed_hours_ago: int = 0,
    claimed_minutes_ago: int = 0,
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
                        THEN NOW() - make_interval(hours => :hours, mins => :minutes)
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
                "minutes": claimed_minutes_ago,
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


def _queue_child(track_id: int, claim_token: str) -> str:
    from crate.db.repositories.tasks import create_task_dedup

    task_id = create_task_dedup(
        "compute_smart_mix_profile",
        {"track_id": track_id, "claim_token": claim_token},
        dedup_key=f"smart-mix-profile:{track_id}",
        dispatch=False,
    )
    assert task_id is not None
    return task_id


def _set_task(task_id: str, **columns) -> None:
    assignments = ", ".join(f"{column} = :{column}" for column in columns)
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE tasks SET {assignments} WHERE id = :id"),
            {"id": task_id, **columns},
        )


def _age_claim(track_id: int, *, hours: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE track_processing_state
                SET claimed_at = NOW() - make_interval(hours => :hours)
                WHERE track_id = :track_id AND pipeline = 'smart_mix'
                """
            ),
            {"track_id": track_id, "hours": hours},
        )


def test_a_child_that_fails_for_good_frees_its_slot(pg_db, tmp_path: Path) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        count_smart_mix_in_flight,
        release_dead_smart_mix_claims,
    )
    from crate.db.repositories.tasks import fail_or_retry_task

    [track_id] = _create_tracks(tmp_path, count=1)
    [claim] = claim_smart_mix_backfill_batch(limit=1, claimed_by="task:coordinator")
    child = _queue_child(track_id, claim["claim_token"])

    # A retry puts the same task, with the same claim token, back in the queue.
    assert fail_or_retry_task(child, "decoder crashed") == "retrying"
    assert fail_or_retry_task(child, "decoder crashed") == "retrying"
    assert count_smart_mix_in_flight() == 1

    assert fail_or_retry_task(child, "decoder crashed") == "failed"
    assert count_smart_mix_in_flight() == 0
    assert release_dead_smart_mix_claims() == 1
    row = _processing_row(track_id)
    assert (row["state"], row["attempts"]) == ("failed", 1)


def test_a_child_lost_with_its_worker_frees_its_slot(pg_db, tmp_path: Path) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import count_smart_mix_in_flight
    from crate.db.repositories.tasks import cleanup_zombie_tasks

    [track_id] = _create_tracks(tmp_path, count=1)
    [claim] = claim_smart_mix_backfill_batch(limit=1, claimed_by="task:coordinator")
    child = _queue_child(track_id, claim["claim_token"])
    # The process died mid-analysis on its last retry: no heartbeat for ten minutes.
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE tasks
                SET status = 'running',
                    retry_count = max_retries,
                    heartbeat_at = NOW() - INTERVAL '10 minutes'
                WHERE id = :id
                """
            ),
            {"id": child},
        )
    assert count_smart_mix_in_flight() == 1

    assert cleanup_zombie_tasks(heartbeat_timeout_min=5) == 1
    assert count_smart_mix_in_flight() == 0


def test_a_child_whose_analysis_fails_frees_its_slot(pg_db, tmp_path: Path) -> None:
    del pg_db
    from crate.db.jobs.analysis_storage import record_smart_mix_failure
    from crate.db.jobs.smart_mix_backfill import count_smart_mix_in_flight

    [track_id] = _create_tracks(tmp_path, count=1)
    [claim] = claim_smart_mix_backfill_batch(limit=1, claimed_by="task:coordinator")
    child = _queue_child(track_id, claim["claim_token"])
    _set_task(child, status="running")

    record_smart_mix_failure(
        track_id, claim["path"], "decoder crashed", claim_token=claim["claim_token"]
    )

    assert count_smart_mix_in_flight() == 0
    assert _processing_row(track_id)["state"] == "failed"


def test_four_stuck_claims_do_not_block_the_backfill(pg_db, tmp_path: Path) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import count_smart_mix_in_flight

    # Four claims whose children were never queued: the coordinator died between
    # claiming and queuing them. They used to count for two hours, which is the
    # whole day limit.
    stuck = _create_tracks(tmp_path, count=4)
    for track_id in stuck:
        _insert_processing(
            track_id,
            state="analyzing",
            attempts=1,
            target_generation=ANALYZER_VERSION,
            claimed_minutes_ago=10,
        )

    assert count_smart_mix_in_flight() == 0
    claimed = claim_smart_mix_backfill_batch(limit=4, claimed_by="task:next")
    assert sorted(row["id"] for row in claimed) == sorted(stuck)
    assert {_processing_row(track_id)["attempts"] for track_id in stuck} == {2}


def test_releasing_dead_claims_skips_one_another_sweep_holds(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    import threading

    from crate.db.jobs.smart_mix_backfill import release_dead_smart_mix_claims

    # The service loop and a coordinator can sweep at once; waiting on each
    # other's rows could deadlock and fail the coordinator.
    held, free = _create_tracks(tmp_path, count=2)
    for track_id in (held, free):
        _insert_processing(
            track_id,
            state="analyzing",
            attempts=1,
            target_generation=ANALYZER_VERSION,
            claimed_minutes_ago=10,
        )
    released: list[int] = []

    def other_sweep() -> None:
        released.append(release_dead_smart_mix_claims())

    with transaction_scope() as session:
        session.execute(
            text(
                """
                SELECT 1 FROM track_processing_state
                WHERE track_id = :track_id AND pipeline = 'smart_mix'
                FOR UPDATE
                """
            ),
            {"track_id": held},
        )
        sweep = threading.Thread(target=other_sweep)
        sweep.start()
        sweep.join(timeout=5)
        finished_while_held = not sweep.is_alive()
    sweep.join(timeout=10)

    assert finished_while_held
    assert released == [1]
    assert _processing_row(free)["state"] == "failed"


@pytest.mark.parametrize("child_status", ["pending", "running"])
def test_a_deferred_or_slow_child_keeps_its_claim(
    pg_db, tmp_path: Path, child_status: str
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        count_smart_mix_in_flight,
        release_dead_smart_mix_claims,
    )

    # A child the resource governor has deferred for three hours stays pending;
    # it still holds its slot and its claim.
    [track_id] = _create_tracks(tmp_path, count=1)
    [claim] = claim_smart_mix_backfill_batch(limit=1, claimed_by="task:coordinator")
    child = _queue_child(track_id, claim["claim_token"])
    _set_task(child, status=child_status)
    _age_claim(track_id, hours=3)

    assert count_smart_mix_in_flight() == 1
    assert release_dead_smart_mix_claims() == 0
    assert claim_smart_mix_backfill_batch(limit=1, claimed_by="task:next") == []
    assert _processing_row(track_id)["state"] == "analyzing"


def test_stale_work_recovery_releases_dead_claims_after_the_zombie_cleanup(
    monkeypatch,
) -> None:
    from crate import worker

    steps: list[str] = []
    monkeypatch.setattr(
        worker, "cleanup_zombie_tasks", lambda **_k: steps.append("zombies") or 0
    )
    monkeypatch.setattr(
        "crate.db.repositories.ai_usage.reclaim_abandoned_invocations",
        lambda **_k: steps.append("ai") or 0,
    )
    monkeypatch.setattr(
        "crate.db.jobs.smart_mix_backfill.release_dead_smart_mix_claims",
        lambda **_k: steps.append("smart_mix") or 0,
    )

    worker._recover_stale_work()

    assert steps.index("zombies") < steps.index("smart_mix")


# 13:00 and 03:00 in Madrid (CET): outside and inside the default night window.
DAY = datetime(2026, 1, 16, 12, 0, tzinfo=UTC)
NIGHT = datetime(2026, 1, 16, 2, 0, tzinfo=UTC)


def _handler_harness(monkeypatch, *, campaigns, in_flight, claimed=(), now=DAY):
    from crate.worker_handlers import analysis

    calls: dict[str, list] = {
        "claims": [],
        "children": [],
        "completed": [],
        "next": [],
        "released": [],
    }
    instants = iter(now if isinstance(now, list) else [now])
    clock = {"value": None}

    def current_time():
        clock["value"] = next(instants, clock["value"])
        return clock["value"]

    monkeypatch.setattr(analysis, "_now", current_time)
    campaign_values = iter(campaigns)
    current = {"value": None}

    def next_campaign():
        current["value"] = next(campaign_values, current["value"])
        return current["value"]

    in_flight_values = iter(in_flight)
    counted = {"value": 0}

    def next_in_flight():
        counted["value"] = next(in_flight_values, counted["value"])
        return counted["value"]

    monkeypatch.setattr(analysis, "get_smart_mix_campaign", next_campaign)
    monkeypatch.setattr(analysis, "count_smart_mix_in_flight", next_in_flight)
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
    monkeypatch.setattr(
        analysis,
        "release_smart_mix_claims",
        lambda ids: calls["released"].append(list(ids)) or 0,
    )
    monkeypatch.setattr(
        analysis, "refresh_smart_mix_coverage", lambda **_kwargs: {"total_tracks": 1}
    )
    monkeypatch.setattr(
        analysis,
        "complete_smart_mix_campaign",
        lambda: calls["completed"].append(True) or True,
    )
    monkeypatch.setattr(
        analysis,
        "queue_next_smart_mix_batch",
        lambda **kwargs: calls["next"].append(kwargs) or "task-next",
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
        monkeypatch, campaigns=[_running_campaign()], in_flight=[2], claimed=claimed
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert calls["claims"][0]["limit"] == 2
    assert [child[1]["claim_token"] for child in calls["children"]] == [
        "task:task-1:a",
        "task:task-1:b",
    ]
    assert result["claimed"] == 2
    assert result["next_task_id"] == "task-next"
    assert calls["next"] == [{"batches": 1, "claimed": 2}]


def test_the_claim_enforces_the_window_limit(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(batch_size=25)],
        in_flight=[1],
        claimed=[{"id": 5, "entity_uid": "uid-5", "claim_token": "token-5"}],
        now=NIGHT,
    )

    analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert (calls["claims"][0]["limit"], calls["claims"][0]["max_in_flight"]) == (
        7,
        8,
    )


def test_a_coordinator_that_loses_the_slots_does_not_complete_the_campaign(
    monkeypatch,
) -> None:
    # Nothing was in flight when it counted, but another coordinator filled the
    # slots before its claim, which therefore took nothing.
    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign()], in_flight=[0, 4]
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result.get("completed") is not True
    assert calls["completed"] == []


def test_backfill_handler_promotes_python_profiles_only_with_crate_cli(
    monkeypatch,
) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(), _running_campaign()],
        in_flight=[0, 0],
    )
    monkeypatch.setattr("crate.crate_cli.has_subcommands", lambda: True)

    monkeypatch.setattr("crate.crate_cli.is_available", lambda: False)
    analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})
    monkeypatch.setattr("crate.crate_cli.is_available", lambda: True)
    analysis._handle_backfill_smart_mix_profiles("task-2", {}, {})

    assert [claim["promote_python_profiles"] for claim in calls["claims"]] == [
        False,
        True,
    ]


def test_backfill_handler_completes_the_campaign_when_nothing_is_left(
    monkeypatch,
) -> None:
    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign()], in_flight=[0]
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result == {"claimed": 0, "queued": 0, "completed": True}
    assert calls["completed"] == [True]
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


ACROSS_MIDNIGHT = {"start": "22:00", "end": "06:00", "timezone": "Europe/Madrid"}


@pytest.mark.parametrize(
    ("now", "window", "in_flight", "expected_window", "expected_claims"),
    [
        # 03:00 and 13:00 in Madrid with the default 01:00-08:00 window.
        (NIGHT, None, 5, "night", 3),
        (DAY, None, 1, "day", 3),
        # 23:30 in Madrid, inside a window that crosses midnight.
        (
            datetime(2026, 1, 15, 22, 30, tzinfo=UTC),
            ACROSS_MIDNIGHT,
            0,
            "night",
            8,
        ),
        # 13:00 in Madrid, outside the window that crosses midnight.
        (DAY, ACROSS_MIDNIGHT, 0, "day", 4),
        # 07:30 CEST just after spring forward and 07:30 CET just after fall back:
        # a fixed UTC offset would put one of them in the day.
        (datetime(2026, 3, 29, 5, 30, tzinfo=UTC), None, 2, "night", 6),
        (datetime(2026, 10, 25, 6, 30, tzinfo=UTC), None, 2, "night", 6),
        # 08:30 CEST on a summer morning: already day.
        (datetime(2026, 7, 16, 6, 30, tzinfo=UTC), None, 2, "day", 2),
    ],
)
def test_backfill_limit_follows_night_window(
    monkeypatch, now, window, in_flight, expected_window, expected_claims
) -> None:
    campaign = _running_campaign(batch_size=25)
    if window is not None:
        campaign["night_window"] = window
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[campaign],
        in_flight=[in_flight],
        claimed=[{"id": 5, "entity_uid": "uid-5", "claim_token": "token-5"}],
        now=now,
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert calls["claims"][0]["limit"] == expected_claims
    assert result["window"] == expected_window
    assert result["limit"] == (8 if expected_window == "night" else 4)


def test_window_concurrency_comes_from_the_campaign_and_batch_size_caps_a_pass(
    monkeypatch,
) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[
            _running_campaign(batch_size=3, night_concurrency=12),
            _running_campaign(batch_size=25, day_concurrency=2),
        ],
        in_flight=[0, 1],
        now=[NIGHT, DAY],
    )

    analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})
    analysis._handle_backfill_smart_mix_profiles("task-2", {}, {})

    assert [claim["limit"] for claim in calls["claims"]] == [3, 1]


def test_day_limit_keeps_a_saturated_backfill_from_claiming(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(batch_size=25)] * 100,
        in_flight=[4] * 100,
        now=DAY,
    )
    monkeypatch.setattr(analysis, "_SMART_MIX_BACKFILL_MAX_WAIT_SECONDS", 30)

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result["deferred"] is True
    assert (result["window"], result["limit"]) == ("day", 4)
    assert calls["claims"] == []


def test_window_change_applies_on_the_next_batch_without_cancelling(
    monkeypatch,
) -> None:
    # 07:59 and 08:00 in Madrid: eight analyses were accepted during the night.
    last_night_minute = datetime(2026, 1, 16, 6, 59, tzinfo=UTC)
    first_day_minute = datetime(2026, 1, 16, 7, 0, tzinfo=UTC)
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(batch_size=25)] * 100,
        in_flight=[8, 8, 5, 5, 3],
        now=[last_night_minute] + [first_day_minute] * 100,
    )
    monkeypatch.setattr(analysis, "_SMART_MIX_BACKFILL_POLL_SECONDS", 5)
    monkeypatch.setattr(analysis, "_SMART_MIX_BACKFILL_MAX_WAIT_SECONDS", 15)

    morning = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})
    later = analysis._handle_backfill_smart_mix_profiles("task-2", {}, {})

    assert morning["deferred"] is True
    assert (morning["window"], morning["limit"]) == ("day", 4)
    assert calls["released"] == []
    assert [claim["limit"] for claim in calls["claims"]] == [1]
    assert (later["window"], later["limit"]) == ("day", 4)


def test_night_start_lets_a_waiting_coordinator_claim_more(monkeypatch) -> None:
    # 00:59 and 01:00 in Madrid.
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(batch_size=25)] * 10,
        in_flight=[4, 4],
        now=[
            datetime(2026, 1, 15, 23, 59, tzinfo=UTC),
            datetime(2026, 1, 16, 0, 0, tzinfo=UTC),
        ],
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert [claim["limit"] for claim in calls["claims"]] == [4]
    assert (result["window"], result["limit"]) == ("night", 8)


def test_non_backfill_analysis_not_counted(pg_db, tmp_path: Path, monkeypatch) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        count_smart_mix_in_flight,
        save_smart_mix_campaign,
    )
    from crate.db.repositories.tasks import create_task
    from crate.worker_handlers import analysis

    backfill, imported, reanalyzing, reanalyzed = _create_tracks(tmp_path, count=4)
    _insert_processing(
        backfill, state="analyzing", attempts=1, target_generation=ANALYZER_VERSION
    )
    # An import being analyzed holds claims in the analysis and bliss pipelines.
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id, pipeline, state, claimed_by, claimed_at, attempts
                )
                VALUES
                    (:track_id, 'analysis', 'analyzing', 'analysis-daemon', NOW(), 1),
                    (:track_id, 'bliss', 'analyzing', 'bliss-daemon', NOW(), 1)
                """
            ),
            {"track_id": imported},
        )
    # A manual reanalysis runs as a task without a backfill claim, and one that
    # finished leaves a done row without a claim.
    manual_task = create_task(
        "compute_smart_mix_profile",
        {"track_id": reanalyzing},
        dedup_key=f"smart-mix-profile:{reanalyzing}",
        dispatch=False,
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE tasks SET status = 'running' WHERE id = :id"),
            {"id": manual_task},
        )
    _insert_processing(
        reanalyzed, state="done", attempts=1, target_generation=ANALYZER_VERSION
    )

    assert count_smart_mix_in_flight() == 1

    save_smart_mix_campaign(_running_campaign(batch_size=25))
    claims: list[dict] = []
    monkeypatch.setattr(analysis, "_now", lambda: DAY)
    monkeypatch.setattr(
        "crate.resource_governor.wait_while_pressured", lambda **_kwargs: True
    )
    monkeypatch.setattr(
        analysis,
        "claim_smart_mix_backfill_batch",
        lambda **kwargs: claims.append(kwargs) or [],
    )
    monkeypatch.setattr(
        analysis, "refresh_smart_mix_coverage", lambda **_kwargs: {"total_tracks": 4}
    )
    monkeypatch.setattr(
        analysis, "queue_next_smart_mix_batch", lambda **_kwargs: "task-next"
    )

    analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert [claim["limit"] for claim in claims] == [3]


def test_a_pause_during_a_batch_survives_the_batch_finishing(pg_db) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        complete_smart_mix_campaign,
        get_smart_mix_campaign,
        queue_next_smart_mix_batch,
        save_smart_mix_campaign,
        set_smart_mix_campaign_status,
    )

    save_smart_mix_campaign(_running_campaign(batches=4, claimed=40, sequence=7))
    assert set_smart_mix_campaign_status("paused", allowed_from={"running"})

    assert queue_next_smart_mix_batch(batches=1, claimed=25) is None
    assert complete_smart_mix_campaign() is False

    campaign = get_smart_mix_campaign()
    assert campaign["status"] == "paused"
    assert (campaign["batches"], campaign["claimed"], campaign["sequence"]) == (
        4,
        40,
        7,
    )


def test_a_running_campaign_counts_the_batch_and_queues_the_next(pg_db) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        complete_smart_mix_campaign,
        get_smart_mix_campaign,
        queue_next_smart_mix_batch,
        save_smart_mix_campaign,
        set_smart_mix_campaign_status,
    )

    save_smart_mix_campaign(_running_campaign(batches=4, claimed=40, sequence=7))

    task_id = queue_next_smart_mix_batch(batches=1, claimed=25)

    campaign = get_smart_mix_campaign()
    assert task_id is not None
    assert (campaign["batches"], campaign["claimed"], campaign["sequence"]) == (
        5,
        65,
        8,
    )
    with transaction_scope() as session:
        dedup_key = session.execute(
            text("SELECT dedup_key FROM tasks WHERE id = :id"), {"id": task_id}
        ).scalar_one()
    assert dedup_key == f"smart-mix:backfill:{ANALYZER_VERSION}:8"
    assert set_smart_mix_campaign_status("running", allowed_from={"paused"}) is None
    assert complete_smart_mix_campaign() is True
    assert get_smart_mix_campaign()["status"] == "completed"


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


def test_campaign_stores_the_night_window_and_keeps_it_when_omitted(pg_db) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        get_smart_mix_campaign,
        save_smart_mix_campaign,
        start_smart_mix_campaign,
    )

    # A campaign saved before the night window existed reads the defaults.
    save_smart_mix_campaign(_running_campaign(status="paused"))
    resumed = start_smart_mix_campaign(batch_size=20, max_attempts=3)
    assert (
        resumed["night_window"],
        resumed["night_concurrency"],
        resumed["day_concurrency"],
    ) == (
        {"start": "01:00", "end": "08:00", "timezone": "Europe/Madrid"},
        8,
        4,
    )

    configured = start_smart_mix_campaign(
        batch_size=20,
        max_attempts=3,
        night_window=ACROSS_MIDNIGHT,
        night_concurrency=6,
        day_concurrency=2,
    )
    assert configured["night_window"] == ACROSS_MIDNIGHT

    # Omitted settings survive a resume and a new campaign after a cancel.
    start_smart_mix_campaign(batch_size=25, max_attempts=3, day_concurrency=3)
    save_smart_mix_campaign({**get_smart_mix_campaign(), "status": "cancelled"})
    restarted = start_smart_mix_campaign(batch_size=25, max_attempts=3)

    assert (restarted["batches"], restarted["claimed"]) == (0, 0)
    assert (
        restarted["night_window"],
        restarted["night_concurrency"],
        restarted["day_concurrency"],
    ) == (ACROSS_MIDNIGHT, 6, 3)
    assert get_smart_mix_campaign()["day_concurrency"] == 3
