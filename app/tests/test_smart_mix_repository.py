from __future__ import annotations

from datetime import UTC, datetime
import uuid

from sqlalchemy import text

from crate.db.repositories.smart_mix import (
    get_track_mix_profile,
    get_track_mix_profiles,
    upsert_track_mix_profile,
)
from crate.db.tx import transaction_scope
from crate.smart_mix.models import MixProfileQuality, TrackMixProfile


def test_repository_upserts_reads_and_skips_unchanged_revision(pg_db) -> None:
    del pg_db
    track_id, track_uid = _create_track("first")
    mix_profile = _profile(track_uid, revision="profile-v1")

    assert upsert_track_mix_profile(track_id, mix_profile) is True
    assert upsert_track_mix_profile(track_id, mix_profile) is False

    summary = get_track_mix_profile(track_id)
    full = get_track_mix_profile(track_id, include_beat_grid=True)

    assert summary is not None
    assert summary.profile_revision == "profile-v1"
    assert summary.beat_grid_ms == ()
    assert full is not None
    assert full.beat_grid_ms == (500, 1_000, 1_500)


def test_batch_read_preserves_requested_order_and_missing_slots(pg_db) -> None:
    del pg_db
    first_id, first_uid = _create_track("first")
    second_id, second_uid = _create_track("second")
    upsert_track_mix_profile(first_id, _profile(first_uid, revision="first"))
    upsert_track_mix_profile(second_id, _profile(second_uid, revision="second"))

    profiles = get_track_mix_profiles(
        [second_id, 9_999_999, first_id], include_beat_grid=True
    )

    assert [
        item.profile_revision if item is not None else None for item in profiles
    ] == ["second", None, "first"]


def test_profile_is_deleted_with_its_library_track(pg_db) -> None:
    del pg_db
    track_id, track_uid = _create_track("cascade")
    upsert_track_mix_profile(track_id, _profile(track_uid))

    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_tracks WHERE id = :track_id"),
            {"track_id": track_id},
        )

    assert get_track_mix_profile(track_id) is None


def _create_track(name: str) -> tuple[int, str]:
    artist = f"Smart Mix Artist {name}"
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, entity_uid)
                VALUES (:artist, CAST(:artist_uid AS UUID))
                """
            ),
            {"artist": artist, "artist_uid": artist_uid},
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums
                    (artist, name, path, entity_uid)
                VALUES
                    (:artist, :album, :path, CAST(:album_uid AS UUID))
                RETURNING id
                """
            ),
            {
                "artist": artist,
                "album": f"Album {name}",
                "path": f"/music/smart-mix/{name}",
                "album_uid": album_uid,
            },
        ).scalar_one()
        track_id = session.execute(
            text(
                """
                INSERT INTO library_tracks
                    (
                        album_id, artist, album, filename, title, path,
                        entity_uid, duration
                    )
                VALUES
                    (
                        :album_id, :artist, :album, :filename, :title, :path,
                        CAST(:track_uid AS UUID), 180.0
                    )
                RETURNING id
                """
            ),
            {
                "album_id": album_id,
                "artist": artist,
                "album": f"Album {name}",
                "filename": f"{name}.flac",
                "title": f"Track {name}",
                "path": f"/music/smart-mix/{name}/{name}.flac",
                "track_uid": track_uid,
            },
        ).scalar_one()
    return int(track_id), track_uid


def _profile(track_uid: str, *, revision: str = "profile-v1") -> TrackMixProfile:
    return TrackMixProfile(
        track_entity_uid=track_uid,
        profile_version=1,
        profile_revision=revision,
        analyzer="crate-rust",
        analyzer_version="1.0.0",
        source_revision="source-v1",
        duration_ms=180_000,
        quality=MixProfileQuality.FULL,
        bpm=120.0,
        bpm_confidence=0.95,
        tempo_stability=0.97,
        beat_anchor_ms=500,
        downbeat_anchor_ms=500,
        time_signature=4,
        beat_grid_format="delta-ms-v1",
        beat_grid_ms=(500, 1_000, 1_500),
        key="A",
        scale="minor",
        camelot="8A",
        key_confidence=0.9,
        intro_cue_ms=8_000,
        outro_cue_ms=165_000,
        global_energy=0.7,
        danceability=0.6,
        valence=0.4,
        analyzed_at=datetime(2026, 7, 28, tzinfo=UTC),
    )
