from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
import uuid

import pytest
from sqlalchemy import text

from crate.db.jobs import smart_mix_backfill
from crate.db.jobs.smart_mix_backfill import claim_smart_mix_backfill_batch
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION

# The production campaign Smart Mix 3 starts from: v6, cancelled after claiming
# 38,865 tracks. Campaigns written before schemas were tracked have no
# profile_version.
CANCELLED_V6_CAMPAIGN = {
    "target": "smart-mix-audio-v6",
    "status": "cancelled",
    "batch_size": 25,
    "max_attempts": 3,
    "batches": 1_555,
    "claimed": 38_865,
    "sequence": 1_600,
}
# v10 asks madmom before giving a track bars of three; production runs the v9 campaign
# (started 2026-11-09 with sequence 10,277), which v10 supersedes whatever its state.
# The counters are illustrative.
PREVIOUS_ANALYZER_VERSION = "smart-mix-audio-v9"
PREVIOUS_CAMPAIGN = {
    "target": PREVIOUS_ANALYZER_VERSION,
    "profile_version": 1,
    "status": "paused",
    "batch_size": 25,
    "max_attempts": 3,
    "batches": 9_000,
    "claimed": 30_000,
    "sequence": 19_277,
}


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


def _coordinator_claim(**kwargs) -> list[int]:
    kwargs.setdefault("max_in_flight", 25)
    kwargs.setdefault("claimed_by", "task:coordinator")
    return [int(row["id"]) for row in claim_smart_mix_backfill_batch(**kwargs)]


def _age_ranking(*, seconds: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE ops_runtime_state
                SET updated_at = NOW() - make_interval(secs => :seconds)
                WHERE key = :key
                """
            ),
            {"key": smart_mix_backfill.RANKING_STATE_KEY, "seconds": seconds},
        )


def _like(track_id: int) -> None:
    user_id = _create_user()
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_liked_tracks (user_id, track_id, created_at)
                VALUES (:user_id, :track_id, NOW())
                """
            ),
            {"user_id": user_id, "track_id": track_id},
        )


def test_a_pass_claims_from_the_stored_ranking_until_it_is_refreshed(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    first, second, third, liked = _create_tracks(tmp_path, count=4)

    assert _coordinator_claim(limit=1) == [first]
    # A like moves the track up, but passes keep the stored order instead of
    # ranking the whole library again.
    _like(liked)
    assert _coordinator_claim(limit=1) == [second]

    _age_ranking(seconds=smart_mix_backfill.RANKING_MAX_AGE_SECONDS + 1)
    assert _coordinator_claim(limit=2) == [liked, third]


def test_the_play_queue_and_offline_ids_go_first_without_a_new_ranking(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    first, _second, queued, offline = _create_tracks(tmp_path, count=4)

    assert _coordinator_claim(limit=1) == [first]
    _mark_current_queue(queued)

    claimed = claim_smart_mix_backfill_batch(
        limit=2,
        max_in_flight=25,
        offline_track_ids=[offline],
        claimed_by="task:coordinator",
    )

    assert [(row["id"], row["priority"]) for row in claimed] == [
        (queued, 1),
        (offline, 2),
    ]


def _queue_items(items: list[dict]) -> None:
    """Store a play queue of these items on a new device."""
    user_id = _create_user()
    device_id = f"device-{uuid.uuid4().hex}"
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_devices (
                    user_id, device_id, device_type, created_at, updated_at
                )
                VALUES (:user_id, :device_id, 'test', NOW(), NOW())
                """
            ),
            {"user_id": user_id, "device_id": device_id},
        )
        session.execute(
            text(
                """
                INSERT INTO user_playback_device_states (
                    user_id, device_id, status, queue_json
                )
                VALUES (:user_id, :device_id, 'paused', CAST(:queue AS jsonb))
                """
            ),
            {
                "user_id": user_id,
                "device_id": device_id,
                "queue": json.dumps(items),
            },
        )


def test_a_long_play_queue_is_claimed_in_order_chunk_by_chunk(
    pg_db, tmp_path: Path, monkeypatch
) -> None:
    del pg_db
    monkeypatch.setattr(smart_mix_backfill, "_LIVE_CHUNK_SIZE", 2)
    _unqueued, *queued = _create_tracks(tmp_path, count=6)
    for track_id in (queued[0], queued[2]):
        _insert_profile(track_id, analyzer_version=ANALYZER_VERSION)
    _queue_items([{"id": str(track_id)} for track_id in reversed(queued)])

    claimed = claim_smart_mix_backfill_batch(
        limit=3, max_in_flight=25, claimed_by="task:coordinator"
    )

    assert [(row["id"], row["priority"]) for row in claimed] == [
        (queued[1], 1),
        (queued[3], 1),
        (queued[4], 1),
    ]


def test_queued_items_as_listen_stores_them_go_first(pg_db, tmp_path: Path) -> None:
    del pg_db
    from crate.db.repositories.playback_state import sanitize_queue_snapshot

    _first, by_id, by_uid, _rest = _create_tracks(tmp_path, count=4)
    with read_scope() as session:
        uid = session.execute(
            text("SELECT entity_uid::text FROM library_tracks WHERE id = :id"),
            {"id": by_uid},
        ).scalar_one()
    # Listen keeps track_id and track_entity_uid (libraryTrackId and entity_uid
    # become those) and drops every other key.
    queue = sanitize_queue_snapshot(
        [{"libraryTrackId": by_id, "id": "x"}, {"entity_uid": uid, "id": "y"}]
    )
    assert queue == [{"track_id": by_id}, {"track_entity_uid": uid}]
    _queue_items(queue)

    claimed = claim_smart_mix_backfill_batch(
        limit=2, max_in_flight=25, claimed_by="task:coordinator"
    )

    assert [(row["id"], row["priority"]) for row in claimed] == [
        (by_id, 1),
        (by_uid, 1),
    ]


def test_an_exhausted_ranking_ranks_again_before_the_claim_gives_up(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    [retried] = _create_tracks(tmp_path, count=1)
    assert _coordinator_claim(limit=1) == [retried]
    # Its child was lost and a track arrived after the ranking: both are
    # claimable although the stored ranking has run out.
    _age_claim(retried, hours=3)
    [imported] = _create_tracks(tmp_path, count=1)

    assert sorted(_coordinator_claim(limit=4)) == sorted([retried, imported])
    assert _processing_row(retried)["attempts"] == 2
    assert _coordinator_claim(limit=4) == []


def test_a_change_of_retry_budget_ranks_again(pg_db, tmp_path: Path) -> None:
    del pg_db
    [track_id] = _create_tracks(tmp_path, count=1)
    _insert_processing(
        track_id, state="failed", attempts=3, target_generation=ANALYZER_VERSION
    )

    assert _coordinator_claim(limit=1, max_attempts=3) == []
    assert _coordinator_claim(limit=1, max_attempts=4) == [track_id]


def test_a_stored_track_that_stopped_being_claimable_is_skipped(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    first, reanalyzed, third = _create_tracks(tmp_path, count=3)
    assert _coordinator_claim(limit=1) == [first]
    # A manual reanalysis wrote a current profile after the ranking.
    _insert_profile(reanalyzed, analyzer_version=ANALYZER_VERSION)

    assert _coordinator_claim(limit=1) == [third]


def test_the_stored_ranking_keeps_promotions_after_every_other_track(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    queued_python, missing, liked_python, played = _create_tracks(tmp_path, count=4)
    for track_id in (queued_python, liked_python):
        _insert_profile(
            track_id,
            analyzer_version=ANALYZER_VERSION,
            analyzer="crate-python",
            quality="partial",
        )
        _insert_processing(
            track_id, state="done", attempts=1, target_generation=ANALYZER_VERSION
        )
    _mark_current_queue(queued_python)
    _like(liked_python)
    _mark_played(played)

    claimed = claim_smart_mix_backfill_batch(
        limit=10,
        max_in_flight=25,
        claimed_by="task:coordinator",
        promote_python_profiles=True,
    )

    # Python promotions go last, as in the whole-library order: promotion,
    # priority, track id.
    assert [(row["id"], row["priority"]) for row in claimed] == [
        (played, 4),
        (missing, 5),
        (queued_python, 1),
        (liked_python, 3),
    ]


def test_two_coordinators_racing_never_exceed_the_limit(pg_db, tmp_path: Path) -> None:
    del pg_db
    import threading

    from crate.db.jobs.smart_mix_backfill import count_smart_mix_in_flight

    track_ids = _create_tracks(tmp_path, count=20)
    claimed: list[int] = []
    errors: list[BaseException] = []

    def race(limit: int) -> None:
        start = threading.Barrier(2)

        def coordinator(name: str) -> None:
            try:
                start.wait(timeout=10)
                claimed.extend(
                    _coordinator_claim(
                        limit=25, max_in_flight=limit, claimed_by=f"task:{name}"
                    )
                )
            except BaseException as error:  # noqa: BLE001 - reraised below
                errors.append(error)

        threads = [
            threading.Thread(target=coordinator, args=(name,))
            for name in ("first", "second")
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert not any(thread.is_alive() for thread in threads)
        assert errors == []

    # Both rank the empty store at once, then both refresh a stale ranking.
    race(4)
    assert len(claimed) == 4
    _age_ranking(seconds=smart_mix_backfill.RANKING_MAX_AGE_SECONDS + 1)
    race(8)

    assert len(claimed) == len(set(claimed)) == 8
    assert set(claimed) <= set(track_ids)
    assert count_smart_mix_in_flight() == 8


def _allow_by_governor(monkeypatch) -> list:
    from crate.resource_governor import ResourceDecision

    decisions: list = []
    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task",
        lambda task_type, params=None: ResourceDecision(allowed=True),
    )
    monkeypatch.setattr(
        "crate.resource_governor.record_decision",
        lambda decision, **kwargs: decisions.append((decision, kwargs)),
    )
    return decisions


def test_governor_pressure_sends_the_coordinator_back_without_sleeping(
    monkeypatch,
) -> None:
    from crate.resource_governor import ResourceDecision
    from crate.worker_handlers import RUN_AGAIN_AFTER_KEY

    # The actor admitted the coordinator, but the governor denies by the time
    # the handler checks: waiting in the handler would hold a heavy process.
    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign()], in_flight=[0]
    )
    decisions = _allow_by_governor(monkeypatch)
    denied = ResourceDecision(
        allowed=False, reason="load 7.2 above 6.8", defer_seconds=600
    )
    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task",
        lambda task_type, params=None: denied,
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result[RUN_AGAIN_AFTER_KEY] == 300
    assert result["progress"] == "Deferred by resource governor: load 7.2 above 6.8"
    assert calls["sleeps"] == []
    assert calls["claims"] == []
    assert [decision for decision, _kwargs in decisions] == [denied]


def test_compute_profile_handler_resolves_track_inside_worker(monkeypatch) -> None:
    from crate.worker_handlers import analysis
    from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft

    track_uid = str(uuid.uuid4())
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
            "entity_uid": track_uid,
            "path": "/music/artist/album/track.flac",
        },
        raising=False,
    )
    _without_beat_model(monkeypatch)
    monkeypatch.setattr(
        "crate.audio_analysis.analyze_mix_profile", lambda _path, _beats=None: draft
    )
    captured: list[tuple[int, str, str | None]] = []
    monkeypatch.setattr(
        analysis,
        "capture_smart_mix_source",
        lambda track_id, path, *, claim_token=None: (
            captured.append((track_id, str(path), claim_token)) or _capture()
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
    invalidated: list[list[str]] = []
    monkeypatch.setattr(
        analysis,
        "invalidate_for_tracks",
        lambda uids: invalidated.append(list(uids)) or 1,
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
    # A published profile drops the AI refinements of its old revision (SM4).
    assert invalidated == [[track_uid]]


def test_failed_profiles_also_refresh_the_live_coverage(monkeypatch) -> None:
    from crate.worker_handlers import analysis

    monkeypatch.setattr(
        analysis,
        "resolve_smart_mix_track",
        lambda **_kwargs: {"id": 7, "path": "/music/artist/album/track.flac"},
    )
    monkeypatch.setattr(
        analysis, "capture_smart_mix_source", lambda *_args, **_kwargs: _capture()
    )

    def broken(_path, _beats=None):
        raise RuntimeError("decoder exploded")

    _without_beat_model(monkeypatch)
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
        analysis, "capture_smart_mix_source", lambda *_args, **_kwargs: _capture()
    )
    _without_beat_model(monkeypatch)
    monkeypatch.setattr(
        "crate.audio_analysis.analyze_mix_profile",
        lambda _path, _beats=None: TrackMixProfileDraft(
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


def _coverage_refreshed_at() -> datetime:
    with read_scope() as session:
        return session.execute(
            text("SELECT updated_at FROM ops_runtime_state WHERE key = :key"),
            {"key": smart_mix_backfill.COVERAGE_STATE_KEY},
        ).scalar_one()


def _age_coverage(*, seconds: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE ops_runtime_state
                SET updated_at = updated_at - make_interval(secs => :seconds)
                WHERE key = :key
                """
            ),
            {"key": smart_mix_backfill.COVERAGE_STATE_KEY, "seconds": seconds},
        )


def _coordinator_on_the_database(monkeypatch):
    """The coordinator with a real claim and coverage; children are not queued."""
    from crate.db.jobs.smart_mix_backfill import save_smart_mix_campaign
    from crate.worker_handlers import analysis

    save_smart_mix_campaign(_running_campaign(batch_size=1))
    monkeypatch.setattr(analysis, "_now", lambda: DAY)
    _allow_by_governor(monkeypatch)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup",
        lambda task_type, params, *, dedup_key: f"child-{params['track_id']}",
    )
    monkeypatch.setattr(
        analysis, "queue_next_smart_mix_batch", lambda **_kwargs: "task-next"
    )
    monkeypatch.setattr("crate.crate_cli.is_available", lambda: False)
    return analysis


def test_a_claiming_pass_refreshes_coverage_at_most_once_a_minute(
    pg_db, tmp_path: Path, monkeypatch
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import refresh_smart_mix_coverage
    from crate.db.queries.smart_mix_admin import get_smart_mix_admin_status

    _create_tracks(tmp_path, count=3)
    analysis = _coordinator_on_the_database(monkeypatch)
    refresh_smart_mix_coverage(max_attempts=3)
    refreshed_at = _coverage_refreshed_at()

    # Right after a refresh, a pass that claims leaves the coverage as it is.
    assert (
        analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})["claimed"] == 1
    )
    assert _coverage_refreshed_at() == refreshed_at
    assert get_smart_mix_admin_status()["processing"]["active"] == 0

    # A minute later, the next one refreshes it.
    _age_coverage(seconds=smart_mix_backfill.PASS_COVERAGE_MAX_AGE_SECONDS + 1)
    aged_at = _coverage_refreshed_at()
    assert (
        analysis._handle_backfill_smart_mix_profiles("task-2", {}, {})["claimed"] == 1
    )
    assert _coverage_refreshed_at() > aged_at
    assert get_smart_mix_admin_status()["processing"]["active"] == 2


def test_a_completing_pass_leaves_the_coverage_current(
    pg_db, tmp_path: Path, monkeypatch
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        get_smart_mix_campaign,
        refresh_smart_mix_coverage,
    )
    from crate.db.queries.smart_mix_admin import get_smart_mix_admin_status

    [track_id] = _create_tracks(tmp_path, count=1)
    analysis = _coordinator_on_the_database(monkeypatch)
    refresh_smart_mix_coverage(max_attempts=3)
    _insert_profile(track_id, analyzer_version=ANALYZER_VERSION)

    # The coverage is seconds old, but the campaign ends on this pass.
    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result == {"claimed": 0, "queued": 0, "completed": True}
    assert get_smart_mix_campaign()["status"] == "completed"
    assert get_smart_mix_admin_status()["current_profiles"] == 1


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
    profile_version: int = PROFILE_SCHEMA_VERSION,
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
                    :track_id, :profile_version, :revision, :analyzer,
                    :analyzer_version, 'source', :quality, NOW()
                )
                """
            ),
            {
                "track_id": track_id,
                "profile_version": profile_version,
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


def test_coverage_snapshot_counts_profiles_with_structure(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import refresh_smart_mix_coverage
    from crate.db.queries.smart_mix_admin import get_smart_mix_structure_percent

    phrased, empty, unsegmented, old, missing = _create_tracks(tmp_path, count=5)
    for track_id in (phrased, empty, unsegmented):
        _insert_profile(track_id, analyzer_version=ANALYZER_VERSION)
    _insert_profile(old, analyzer_version="smart-mix-audio-v6")
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE track_mix_profiles
                SET phrases = CASE track_id
                        WHEN :phrased THEN CAST(:one AS jsonb)
                        WHEN :old THEN CAST(:one AS jsonb)
                        ELSE CAST('[]' AS jsonb)
                    END
                WHERE track_id IN (:phrased, :empty, :old)
                """
            ),
            {
                "phrased": phrased,
                "empty": empty,
                "old": old,
                "one": '[{"start_beat": 0, "start_ms": 0, "bars": 8, '
                '"energy": 0.5, "delta_energy": null, "kind": "body"}]',
            },
        )

    snapshot = refresh_smart_mix_coverage(max_attempts=3)

    # Only current profiles with at least one phrase count, over every track.
    assert snapshot["structure_profiles"] == 1
    assert snapshot["structure_percent"] == 20.0
    assert get_smart_mix_structure_percent() == 20.0
    assert missing not in {phrased, empty, unsegmented, old}


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


def test_the_last_backfill_change_is_its_newest_processing_row(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import seconds_since_smart_mix_change

    assert seconds_since_smart_mix_change() is None
    [claimed, imported] = _create_tracks(tmp_path, count=2)
    claim_smart_mix_backfill_batch(limit=1, claimed_by="task:coordinator")
    assert seconds_since_smart_mix_change() < 5

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE track_processing_state
                SET updated_at = NOW() - INTERVAL '100 seconds'
                WHERE pipeline = 'smart_mix'
                """
            )
        )
        # Other pipelines change all the time; they say nothing about slots.
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id, pipeline, state, attempts, updated_at
                )
                VALUES (:track_id, 'analysis', 'done', 1, NOW())
                """
            ),
            {"track_id": imported},
        )

    assert 99 <= seconds_since_smart_mix_change() < 110


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
        "sleeps": [],
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
    _allow_by_governor(monkeypatch)
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
        analysis, "refresh_smart_mix_coverage_after_pass", lambda **_kwargs: True
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
    monkeypatch.setattr("time.sleep", lambda seconds: calls["sleeps"].append(seconds))
    # A slot changed a moment ago: the coordinator checks again soon.
    monkeypatch.setattr(analysis, "seconds_since_smart_mix_change", lambda: 0.0)
    return analysis, calls


def _running_campaign(**overrides) -> dict:
    return {
        "target": ANALYZER_VERSION,
        "profile_version": PROFILE_SCHEMA_VERSION,
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


def _runs_again_later(result: dict) -> bool:
    from crate.worker_handlers import RUN_AGAIN_AFTER_KEY

    return bool(result.get(RUN_AGAIN_AFTER_KEY))


def test_saturated_backfill_runs_again_later_without_holding_a_process(
    monkeypatch,
) -> None:
    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign()], in_flight=[10]
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    # The task goes back to pending; the worker process is free meanwhile.
    assert _runs_again_later(result)
    assert result["progress"] == "Waiting for a free slot: 10 of 4 in flight (day)"
    assert calls["sleeps"] == []
    assert calls["claims"] == []
    assert calls["next"] == []


@pytest.mark.parametrize(
    ("since_change", "expected_wait"),
    [
        # Right after a claim or a finished analysis: check again in 3 s.
        (0.4, 3),
        # Nothing has changed for 12 s: wait as long again, so the checks
        # about double while the slots stay full.
        (12.2, 12),
        # Never more than 30 s, so a freed slot waits at most that long.
        (300, 30),
        (None, 30),
    ],
)
@pytest.mark.parametrize("in_flight", [4, 2], ids=["saturated", "last-analyses"])
def test_a_waiting_coordinator_backs_off_while_nothing_changes(
    monkeypatch, since_change, expected_wait, in_flight
) -> None:
    from crate.worker_handlers import RUN_AGAIN_AFTER_KEY

    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign()], in_flight=[in_flight]
    )
    monkeypatch.setattr(
        analysis, "seconds_since_smart_mix_change", lambda: since_change
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert result[RUN_AGAIN_AFTER_KEY] == expected_wait


def test_a_pause_stops_a_waiting_coordinator_before_claiming(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(), _running_campaign(status="paused")],
        in_flight=[10],
    )

    waiting = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})
    paused = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert _runs_again_later(waiting)
    assert paused == {"claimed": 0, "queued": 0, "control": "paused"}
    assert calls["claims"] == []
    assert calls["next"] == []


def test_nothing_to_claim_while_analyses_run_waits_for_them(monkeypatch) -> None:
    # The last tracks are in flight: chaining a pass at once would repeat the
    # claim and the coverage refresh until they finish.
    analysis, calls = _handler_harness(
        monkeypatch, campaigns=[_running_campaign()], in_flight=[2]
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert _runs_again_later(result)
    assert result["progress"] == "Waiting for the 2 analyses in flight to finish"
    assert calls["completed"] == []
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
        # Each pass counts, claims nothing and counts again.
        in_flight=[0, 0, 1, 1],
        now=[NIGHT, DAY],
    )

    analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})
    analysis._handle_backfill_smart_mix_profiles("task-2", {}, {})

    assert [claim["limit"] for claim in calls["claims"]] == [3, 1]


def test_day_limit_keeps_a_saturated_backfill_from_claiming(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(batch_size=25)],
        in_flight=[4],
        now=DAY,
    )

    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert _runs_again_later(result)
    assert result["progress"] == "Waiting for a free slot: 4 of 4 in flight (day)"
    assert calls["claims"] == []


def test_window_change_applies_on_the_next_batch_without_cancelling(
    monkeypatch,
) -> None:
    # 07:59 and 08:00 in Madrid: eight analyses were accepted during the night.
    last_night_minute = datetime(2026, 1, 16, 6, 59, tzinfo=UTC)
    first_day_minute = datetime(2026, 1, 16, 7, 0, tzinfo=UTC)
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(batch_size=25)],
        in_flight=[8, 8, 5, 3],
        claimed=[{"id": 5, "entity_uid": "uid-5", "claim_token": "token-5"}],
        now=[last_night_minute, first_day_minute],
    )

    runs = [
        analysis._handle_backfill_smart_mix_profiles("task-1", {}, {}) for _ in range(4)
    ]

    assert [_runs_again_later(run) for run in runs[:3]] == [True, True, True]
    assert runs[0]["progress"].endswith("8 of 8 in flight (night)")
    assert runs[1]["progress"].endswith("8 of 4 in flight (day)")
    assert calls["released"] == []
    assert [claim["limit"] for claim in calls["claims"]] == [1]
    assert (runs[3]["window"], runs[3]["limit"]) == ("day", 4)


def test_night_start_lets_a_waiting_coordinator_claim_more(monkeypatch) -> None:
    # 00:59 and 01:00 in Madrid.
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign(batch_size=25)],
        in_flight=[4, 4],
        claimed=[{"id": 5, "entity_uid": "uid-5", "claim_token": "token-5"}],
        now=[
            datetime(2026, 1, 15, 23, 59, tzinfo=UTC),
            datetime(2026, 1, 16, 0, 0, tzinfo=UTC),
        ],
    )

    waiting = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})
    result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

    assert _runs_again_later(waiting)
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
    _allow_by_governor(monkeypatch)
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


def _bump_schema(monkeypatch) -> int:
    """Run the backfill, the publisher and the writer as the next schema would."""
    from crate.db.jobs import analysis_storage
    from crate.db.repositories import library_analysis_writes

    next_schema = PROFILE_SCHEMA_VERSION + 1
    for module in (smart_mix_backfill, analysis_storage, library_analysis_writes):
        monkeypatch.setattr(module, "PROFILE_SCHEMA_VERSION", next_schema)
    return next_schema


def _current_draft() -> TrackMixProfileDraft:
    return TrackMixProfileDraft(
        analyzer="crate-rust",
        analyzer_version=ANALYZER_VERSION,
        duration_ms=180_000,
        quality=MixProfileQuality.FULL,
        bpm=120.0,
        bpm_confidence=0.95,
        tempo_stability=0.97,
        beat_anchor_ms=500,
        downbeat_anchor_ms=500,
        time_signature=4,
        beat_grid_ms=(500, 1_000, 1_500),
        phrases=(),
        energy_curve=bytes(2),
        structure_confidence=0.0,
    )


def _publish_claims(claimed: list[dict]) -> list[str]:
    from crate.db.jobs.analysis_storage import (
        capture_smart_mix_source,
        publish_smart_mix_profile,
    )

    return [
        str(
            publish_smart_mix_profile(
                capture_smart_mix_source(
                    int(row["id"]), row["path"], claim_token=row["claim_token"]
                ),
                _current_draft(),
            )
        )
        for row in claimed
    ]


def _stored_versions(track_ids: list[int]) -> set[tuple[str, int]]:
    with read_scope() as session:
        return {
            (row.analyzer_version, row.profile_version)
            for row in session.execute(
                text(
                    """
                    SELECT analyzer_version, profile_version
                    FROM track_mix_profiles WHERE track_id = ANY(:ids)
                    """
                ),
                {"ids": track_ids},
            )
        }


def test_backfill_targets_rows_not_at_current_analyzer_and_schema(
    pg_db, tmp_path: Path, monkeypatch
) -> None:
    del pg_db
    v5, v6, missing, v7_previous_schema, current = _create_tracks(tmp_path, count=5)
    previous_schema = PROFILE_SCHEMA_VERSION
    current_schema = _bump_schema(monkeypatch)
    _insert_profile(v5, analyzer_version="smart-mix-audio-v5")
    _insert_profile(v6, analyzer_version="smart-mix-audio-v6")
    _insert_profile(
        v7_previous_schema,
        analyzer_version=ANALYZER_VERSION,
        profile_version=previous_schema,
    )
    _insert_profile(
        current, analyzer_version=ANALYZER_VERSION, profile_version=current_schema
    )
    # v7 rows written before the schema bump finished their v7 claim already; the
    # schema target is a new generation, so their retry budget starts again.
    _insert_processing(
        v7_previous_schema,
        state="done",
        attempts=3,
        target_generation=ANALYZER_VERSION,
    )

    claimed = claim_smart_mix_backfill_batch(
        limit=10, max_attempts=3, claimed_by="test-worker"
    )

    assert sorted(row["id"] for row in claimed) == sorted(
        [v5, v6, missing, v7_previous_schema]
    )
    assert _processing_row(v7_previous_schema)["attempts"] == 1
    assert claim_smart_mix_backfill_batch(limit=10, claimed_by="test-worker") == []


@pytest.mark.parametrize("next_schema", [False, True], ids=["current", "bumped"])
def test_a_freshly_written_current_profile_is_never_claimed_again(
    pg_db, tmp_path: Path, monkeypatch, next_schema: bool
) -> None:
    del pg_db
    track_ids = _create_tracks(tmp_path, count=3)
    for track_id in track_ids:
        _insert_profile(track_id, analyzer_version="smart-mix-audio-v6")
    schema = _bump_schema(monkeypatch) if next_schema else PROFILE_SCHEMA_VERSION

    claimed = claim_smart_mix_backfill_batch(
        limit=10, max_attempts=10, claimed_by="test-worker"
    )
    assert _publish_claims(claimed) == ["published"] * 3

    assert _stored_versions(track_ids) == {(ANALYZER_VERSION, schema)}
    assert (
        claim_smart_mix_backfill_batch(
            limit=10,
            max_attempts=10,
            claimed_by="test-worker",
            promote_python_profiles=True,
        )
        == []
    )


def test_v9_profiles_are_claimed_once_for_v10(pg_db, tmp_path: Path) -> None:
    del pg_db
    track_ids = _create_tracks(tmp_path, count=3)
    for track_id in track_ids:
        _insert_profile(track_id, analyzer_version=PREVIOUS_ANALYZER_VERSION)
        # Finished by the v9 campaign with its retry budget spent: v10 is a new
        # generation, so the budget starts again.
        _insert_processing(
            track_id,
            state="done",
            attempts=3,
            target_generation=PREVIOUS_ANALYZER_VERSION,
        )

    claimed = claim_smart_mix_backfill_batch(
        limit=10, max_attempts=3, claimed_by="task:v10"
    )

    assert sorted(row["id"] for row in claimed) == sorted(track_ids)
    assert {
        (
            _processing_row(track_id)["attempts"],
            _processing_row(track_id)["target_generation"],
        )
        for track_id in track_ids
    } == {(1, ANALYZER_VERSION)}
    assert _publish_claims(claimed) == ["published"] * 3
    assert _stored_versions(track_ids) == {(ANALYZER_VERSION, PROFILE_SCHEMA_VERSION)}
    assert (
        claim_smart_mix_backfill_batch(
            limit=10,
            max_attempts=3,
            claimed_by="task:v10",
            promote_python_profiles=True,
        )
        == []
    )


def test_older_model_profile_kept_from_a_library_draft_is_claimed(
    pg_db, tmp_path: Path
) -> None:
    # A library reanalysis embeds a current-version draft without the model's beats.
    # The track keeps its older profile with Beat This!'s beats, so the backfill still
    # claims it and recomputes it with the model.
    del pg_db
    from dataclasses import replace

    from crate.db.jobs.analysis_storage import store_smart_mix_profile_result

    [track_id] = _create_tracks(tmp_path, count=1)
    with read_scope() as session:
        path = session.execute(
            text("SELECT path FROM library_tracks WHERE id = :id"), {"id": track_id}
        ).scalar_one()
    model = replace(_current_draft(), beat_tracker="beat-this-small0-dbn")
    assert store_smart_mix_profile_result(
        track_id, path, replace(model, analyzer_version=PREVIOUS_ANALYZER_VERSION)
    )
    library = replace(_current_draft(), beat_tracker=None)
    assert store_smart_mix_profile_result(track_id, path, library) is False

    claimed = claim_smart_mix_backfill_batch(
        limit=10, max_attempts=3, claimed_by="task:v10"
    )

    assert [row["id"] for row in claimed] == [track_id]
    assert store_smart_mix_profile_result(track_id, path, model) is True
    assert _stored_versions([track_id]) == {(ANALYZER_VERSION, PROFILE_SCHEMA_VERSION)}


def test_starting_v10_over_the_v9_campaign_starts_a_new_one(pg_db) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        campaign_targets_current,
        get_smart_mix_campaign,
        save_smart_mix_campaign,
        start_smart_mix_campaign,
    )

    save_smart_mix_campaign(dict(PREVIOUS_CAMPAIGN))
    assert campaign_targets_current(get_smart_mix_campaign()) is False

    campaign = start_smart_mix_campaign(batch_size=25, max_attempts=3)

    assert {
        key: campaign[key]
        for key in (
            "target",
            "profile_version",
            "status",
            "batches",
            "claimed",
            "sequence",
        )
    } == {
        "target": ANALYZER_VERSION,
        "profile_version": PROFILE_SCHEMA_VERSION,
        "status": "running",
        "batches": 0,
        "claimed": 0,
        # The sequence keeps growing, so the new batches never reuse a dedup key.
        "sequence": 19_277,
    }
    assert campaign_targets_current(get_smart_mix_campaign()) is True


def test_fresh_campaign_after_the_cancelled_v6_one_claims_old_rows_once(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        get_smart_mix_campaign,
        refresh_smart_mix_coverage,
        save_smart_mix_campaign,
        start_smart_mix_campaign,
    )

    rewritten, abandoned, in_flight, v5, missing = _create_tracks(tmp_path, count=5)
    # Rewritten to v6 by the cancelled campaign.
    _insert_profile(rewritten, analyzer_version="smart-mix-audio-v6")
    _insert_processing(
        rewritten, state="done", attempts=1, target_generation="smart-mix-audio-v6"
    )
    # Claimed by the cancelled campaign and never finished.
    _insert_profile(abandoned, analyzer_version="smart-mix-audio-v5")
    _insert_processing(
        abandoned,
        state="analyzing",
        attempts=1,
        target_generation="smart-mix-audio-v6",
        claimed_hours_ago=3,
    )
    # A v6 analysis still running when v7 starts: claimable once its claim expires.
    _insert_profile(in_flight, analyzer_version="smart-mix-audio-v5")
    _insert_processing(
        in_flight,
        state="analyzing",
        attempts=1,
        target_generation="smart-mix-audio-v6",
    )
    _insert_profile(v5, analyzer_version="smart-mix-audio-v5")
    save_smart_mix_campaign(dict(CANCELLED_V6_CAMPAIGN))

    campaign = start_smart_mix_campaign(batch_size=50, max_attempts=3)

    assert {
        key: campaign[key]
        for key in (
            "target",
            "profile_version",
            "status",
            "batches",
            "claimed",
            "sequence",
        )
    } == {
        "target": ANALYZER_VERSION,
        "profile_version": PROFILE_SCHEMA_VERSION,
        "status": "running",
        "batches": 0,
        "claimed": 0,
        "sequence": 1_600,
    }
    assert get_smart_mix_campaign()["target"] == ANALYZER_VERSION

    claimed = claim_smart_mix_backfill_batch(
        limit=50, max_attempts=3, claimed_by="task:fresh"
    )
    assert sorted(row["id"] for row in claimed) == sorted(
        [rewritten, abandoned, v5, missing]
    )
    assert {_processing_row(row["id"])["target_generation"] for row in claimed} == {
        ANALYZER_VERSION
    }

    assert _publish_claims(claimed) == ["published"] * 4
    assert claim_smart_mix_backfill_batch(limit=50, claimed_by="task:fresh") == []
    coverage = refresh_smart_mix_coverage(max_attempts=3)
    assert coverage["current_profiles"] == 4
    assert coverage["profile_version"] == PROFILE_SCHEMA_VERSION


def test_campaigns_of_another_target_never_claim_for_the_current_one(
    monkeypatch,
) -> None:
    for stale in (
        {**CANCELLED_V6_CAMPAIGN, "status": "running"},
        {**PREVIOUS_CAMPAIGN, "status": "running"},
        _running_campaign(target="smart-mix-audio-v6"),
        _running_campaign(profile_version=PROFILE_SCHEMA_VERSION - 1),
        # Campaigns written before the schema was recorded targeted schema 1.
        {
            key: value
            for key, value in _running_campaign().items()
            if key != "profile_version"
        }
        if PROFILE_SCHEMA_VERSION != 1
        else _running_campaign(target="smart-mix-audio-v5"),
    ):
        analysis, calls = _handler_harness(
            monkeypatch, campaigns=[stale], in_flight=[0]
        )

        result = analysis._handle_backfill_smart_mix_profiles("task-1", {}, {})

        assert result == {"claimed": 0, "queued": 0, "control": "superseded"}
        assert calls["claims"] == calls["next"] == calls["completed"] == []


def test_starting_over_a_paused_campaign_of_another_target_starts_a_new_one(
    pg_db,
) -> None:
    del pg_db
    from crate.db.jobs.smart_mix_backfill import (
        save_smart_mix_campaign,
        start_smart_mix_campaign,
    )

    save_smart_mix_campaign(
        {**CANCELLED_V6_CAMPAIGN, "status": "paused", "batches": 9, "claimed": 90}
    )
    restarted = start_smart_mix_campaign(batch_size=20, max_attempts=3)
    assert (restarted["target"], restarted["batches"], restarted["claimed"]) == (
        ANALYZER_VERSION,
        0,
        0,
    )

    save_smart_mix_campaign(
        _running_campaign(status="paused", profile_version=PROFILE_SCHEMA_VERSION - 1)
    )
    assert start_smart_mix_campaign(batch_size=20, max_attempts=3)["batches"] == 0


def test_profile_task_publishes_the_draft_with_its_phrase_voice(monkeypatch) -> None:
    # Voice is added after the analysis, Rust or Python (SM3-D13).
    from dataclasses import replace

    from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft
    from crate.worker_handlers import analysis

    draft = TrackMixProfileDraft(
        analyzer="crate-rust",
        analyzer_version=ANALYZER_VERSION,
        duration_ms=10_000,
        quality=MixProfileQuality.PARTIAL,
    )
    voiced = replace(draft, analyzer="voiced")
    monkeypatch.setattr(
        analysis,
        "resolve_smart_mix_track",
        lambda **_kwargs: {"id": 7, "path": "/music/artist/album/track.flac"},
        raising=False,
    )
    _without_beat_model(monkeypatch)
    monkeypatch.setattr(
        "crate.audio_analysis.analyze_mix_profile", lambda _path, _beats=None: draft
    )
    voice_calls: list[tuple[TrackMixProfileDraft, str]] = []
    monkeypatch.setattr(
        "crate.smart_mix.vocals.add_vocal_presence",
        lambda value, path, **_kwargs: voice_calls.append((value, str(path))) or voiced,
    )
    monkeypatch.setattr(
        analysis, "capture_smart_mix_source", lambda *_args, **_kwargs: _capture()
    )
    published: list[TrackMixProfileDraft] = []
    monkeypatch.setattr(
        analysis,
        "publish_smart_mix_profile",
        lambda _capture, value: (
            published.append(value) or analysis.SmartMixPublication.PUBLISHED
        ),
    )
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(analysis, "refresh_live_smart_mix_coverage", lambda: None)

    analysis._handle_compute_smart_mix_profile("task-1", {"track_id": 7}, {})

    assert voice_calls == [(draft, "/music/artist/album/track.flac")]
    assert published == [voiced]


def _without_beat_model(monkeypatch) -> None:
    # Handler tests never load Beat This!; its own tests cover it.
    monkeypatch.setattr(
        "crate.smart_mix.beat_model.track_file_beats", lambda _path: None
    )
    _without_stored_signals(monkeypatch)


def _without_stored_signals(monkeypatch) -> None:
    # Nor touch the stored model signals (test_smart_mix_track_signals.py).
    from crate.worker_handlers import analysis

    monkeypatch.setattr(analysis, "get_track_mix_signals", lambda _track_id: None)
    monkeypatch.setattr(analysis, "store_track_mix_beats", lambda *_a, **_k: None)
    monkeypatch.setattr(analysis, "store_track_mix_voice", lambda *_a, **_k: None)


def _capture():
    from crate.db.jobs.analysis_storage import SmartMixCapture

    return SmartMixCapture(
        track_id=7,
        path="/music/artist/album/track.flac",
        source_revision="source",
        expected_profile_revision=None,
    )


def _profile_task_harness(monkeypatch, draft: TrackMixProfileDraft) -> list:
    from crate.worker_handlers import analysis

    _without_stored_signals(monkeypatch)
    monkeypatch.setattr(
        analysis,
        "resolve_smart_mix_track",
        lambda **_kwargs: {"id": 7, "path": "/music/artist/album/track.flac"},
        raising=False,
    )
    monkeypatch.setattr(
        "crate.smart_mix.vocals.add_vocal_presence",
        lambda value, _path, **_kwargs: value,
    )
    monkeypatch.setattr(
        analysis, "capture_smart_mix_source", lambda *_args, **_kwargs: _capture()
    )
    published: list[TrackMixProfileDraft] = []
    monkeypatch.setattr(
        analysis,
        "publish_smart_mix_profile",
        lambda _capture, value: (
            published.append(value) or analysis.SmartMixPublication.PUBLISHED
        ),
    )
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(analysis, "refresh_live_smart_mix_coverage", lambda: None)
    return published


def test_profile_task_runs_the_beat_model_before_the_analysis(monkeypatch) -> None:
    # Beat This! gives the beats and downbeats to the analysis, Rust or Python
    # (SM3-D14).
    from crate.smart_mix.beat_model import BeatTrack
    from crate.worker_handlers import analysis

    draft = _current_draft()
    published = _profile_task_harness(monkeypatch, draft)
    beats = BeatTrack(
        tracker="beat-this-small0-dbn", beats_ms=(500, 1_000), downbeats_ms=(500,)
    )
    calls: list[tuple[str, object]] = []
    monkeypatch.setattr(
        "crate.smart_mix.beat_model.track_file_beats",
        lambda path: calls.append(("beats", str(path))) or beats,
    )
    monkeypatch.setattr(
        "crate.audio_analysis.analyze_mix_profile",
        lambda path, beats=None: calls.append(("analysis", beats)) or draft,
    )

    result = analysis._handle_compute_smart_mix_profile("task-1", {"track_id": 7}, {})

    assert calls == [
        ("beats", "/music/artist/album/track.flac"),
        ("analysis", beats),
    ]
    assert result["stored"] is True
    assert published == [draft]


def test_profile_falls_back_when_beat_model_fails(monkeypatch, caplog) -> None:
    import logging

    from crate.worker_handlers import analysis

    draft = _current_draft()
    published = _profile_task_harness(monkeypatch, draft)

    def broken(_path):
        raise RuntimeError("torch exploded")

    monkeypatch.setattr("crate.smart_mix.beat_model.track_file_beats", broken)
    analysed: list[object] = []
    monkeypatch.setattr(
        "crate.audio_analysis.analyze_mix_profile",
        lambda _path, beats=None: analysed.append(beats) or draft,
    )

    with caplog.at_level(logging.WARNING):
        result = analysis._handle_compute_smart_mix_profile(
            "task-1", {"track_id": 7}, {}
        )

    # The analysis runs as before, with its own beat tracker, and the profile ships.
    assert analysed == [None]
    assert result["stored"] is True
    assert published == [draft]
    assert "Beat This!" in caplog.text


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
