from __future__ import annotations

from pathlib import Path
import uuid

from sqlalchemy import text

from crate.db.jobs.smart_mix_backfill import claim_smart_mix_backfill_batch
from crate.db.tx import transaction_scope


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
                    track_id, pipeline, state, attempts, priority, last_error
                )
                VALUES (:track_id, 'smart_mix', 'failed', 3, 5, 'permanent')
                """
            ),
            {"track_id": track_id},
        )

    assert (
        claim_smart_mix_backfill_batch(
            limit=10,
            max_attempts=3,
            claimed_by="test-worker",
        )
        == []
    )


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
    stored: list[tuple[int, str]] = []
    monkeypatch.setattr(
        analysis,
        "store_smart_mix_profile_result",
        lambda track_id, path, _draft: stored.append((track_id, str(path))) or True,
        raising=False,
    )
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)

    result = analysis._handle_compute_smart_mix_profile(
        "task-1", {"track_entity_uid": str(uuid.uuid4())}, {}
    )

    assert result == {"track_id": 7, "stored": True, "quality": "partial"}
    assert stored == [(7, "/music/artist/album/track.flac")]


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
