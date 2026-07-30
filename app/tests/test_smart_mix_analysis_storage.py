from __future__ import annotations

from pathlib import Path
import uuid

from sqlalchemy import text

from crate.db.jobs.analysis_storage import (
    record_smart_mix_failure,
    store_analysis_result,
    store_smart_mix_profile_result,
)
from crate.db.repositories.smart_mix import get_track_mix_profile
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft


def test_smart_mix_storage_upserts_without_mutating_legacy_analysis(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path = tmp_path / "track.flac"
    path.write_bytes(b"audio-source")
    track_id, _track_uid = _create_track(path, bpm=87.0)

    assert store_smart_mix_profile_result(track_id, path, _draft()) is True

    profile = get_track_mix_profile(track_id, include_beat_grid=True)
    assert profile is not None
    assert profile.quality is MixProfileQuality.FULL
    assert profile.beat_grid_ms == (500, 1_000, 1_500)
    with read_scope() as session:
        legacy_bpm = session.execute(
            text("SELECT bpm FROM library_tracks WHERE id = :track_id"),
            {"track_id": track_id},
        ).scalar_one()
    assert legacy_bpm == 87.0


def test_smart_mix_storage_skips_unchanged_source_revision(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path = tmp_path / "unchanged.flac"
    path.write_bytes(b"same-source")
    track_id, _track_uid = _create_track(path)

    assert store_smart_mix_profile_result(track_id, path, _draft()) is True
    assert store_smart_mix_profile_result(track_id, path, _draft()) is False


def test_failed_reanalysis_preserves_valid_profile_and_records_reason(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path = tmp_path / "failure.flac"
    path.write_bytes(b"valid-source")
    track_id, _track_uid = _create_track(path)
    store_smart_mix_profile_result(track_id, path, _draft())
    previous = get_track_mix_profile(track_id)
    assert previous is not None

    record_smart_mix_failure(track_id, path, "decoder exploded")

    current = get_track_mix_profile(track_id)
    assert current is not None
    assert current.profile_revision == previous.profile_revision
    assert current.quality is MixProfileQuality.FULL
    with read_scope() as session:
        processing = (
            session.execute(
                text(
                    """
                    SELECT state, last_error
                    FROM track_processing_state
                    WHERE track_id = :track_id AND pipeline = 'smart_mix'
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .one()
        )
    assert processing == {"state": "failed", "last_error": "decoder exploded"}


def test_successful_retry_replaces_unavailable_profile(pg_db, tmp_path: Path) -> None:
    del pg_db
    path = tmp_path / "retry.flac"
    path.write_bytes(b"retry-source")
    track_id, _track_uid = _create_track(path)

    record_smart_mix_failure(track_id, path, "temporary decoder failure")
    unavailable = get_track_mix_profile(track_id)
    assert unavailable is not None
    assert unavailable.quality is MixProfileQuality.UNAVAILABLE

    assert store_smart_mix_profile_result(track_id, path, _draft()) is True
    recovered = get_track_mix_profile(track_id)
    assert recovered is not None
    assert recovered.quality is MixProfileQuality.FULL


def test_legacy_analysis_pipeline_persists_embedded_rust_mix_profile(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path = tmp_path / "pipeline.flac"
    path.write_bytes(b"pipeline-source")
    track_id, _track_uid = _create_track(path)

    store_analysis_result(
        track_id,
        str(path),
        {
            "bpm": 120.0,
            "key": "A",
            "scale": "minor",
            "energy": 0.7,
            "mood": None,
            "mix_profile": {
                "schemaVersion": 1,
                "analyzer": "crate-rust",
                "analyzerVersion": "smart-mix-v1",
                "durationMs": 180_000,
                "quality": "full",
                "bpm": 120.0,
                "bpmConfidence": 0.95,
                "tempoStability": 0.97,
                "beatAnchorMs": 500,
                "downbeatAnchorMs": 500,
                "timeSignature": 4,
                "beatGridMs": [500, 1_000, 1_500],
                "key": "A",
                "scale": "minor",
                "camelot": "8A",
                "keyConfidence": 0.9,
                "introCueMs": 500,
                "outroCueMs": 175_000,
            },
        },
    )

    profile = get_track_mix_profile(track_id, include_beat_grid=True)
    assert profile is not None
    assert profile.analyzer == "crate-rust"
    assert profile.camelot == "8A"


def test_invalid_embedded_profile_does_not_rollback_legacy_analysis(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path = tmp_path / "invalid-profile.flac"
    path.write_bytes(b"pipeline-source")
    track_id, _track_uid = _create_track(path)

    store_analysis_result(
        track_id,
        str(path),
        {
            "bpm": 123.0,
            "key": "D",
            "scale": "minor",
            "energy": 0.6,
            "mood": None,
            "mix_profile": {
                "quality": "not-a-quality",
                "analyzerVersion": "smart-mix-v1",
            },
        },
    )

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT lt.bpm, profile.quality, processing.state
                    FROM library_tracks lt
                    LEFT JOIN track_mix_profiles profile
                        ON profile.track_id = lt.id
                    LEFT JOIN track_processing_state processing
                        ON processing.track_id = lt.id
                       AND processing.pipeline = 'smart_mix'
                    WHERE lt.id = :track_id
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .one()
        )
    assert row["bpm"] == 123.0
    assert row["quality"] == "unavailable"
    assert row["state"] == "failed"


def _create_track(path: Path, *, bpm: float | None = None) -> tuple[int, str]:
    suffix = uuid.uuid4().hex
    artist = f"Storage Artist {suffix}"
    track_uid = str(uuid.uuid4())
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
                "path": str(path.parent / f"album-{suffix}"),
                "album_uid": str(uuid.uuid4()),
            },
        ).scalar_one()
        track_id = session.execute(
            text(
                """
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path,
                    entity_uid, duration, bpm
                )
                VALUES (
                    :album_id, :artist, :album, :filename, :title, :path,
                    CAST(:track_uid AS uuid), 180.0, :bpm
                )
                RETURNING id
                """
            ),
            {
                "album_id": album_id,
                "artist": artist,
                "album": f"Album {suffix}",
                "filename": path.name,
                "title": f"Track {suffix}",
                "path": str(path),
                "track_uid": track_uid,
                "bpm": bpm,
            },
        ).scalar_one()
    return int(track_id), track_uid


def _draft() -> TrackMixProfileDraft:
    return TrackMixProfileDraft(
        analyzer="crate-python",
        analyzer_version="smart-mix-v1",
        duration_ms=180_000,
        quality=MixProfileQuality.FULL,
        bpm=120.0,
        bpm_confidence=0.95,
        tempo_stability=0.97,
        beat_anchor_ms=500,
        downbeat_anchor_ms=500,
        time_signature=4,
        beat_grid_ms=(500, 1_000, 1_500),
        key="A",
        scale="minor",
        camelot="8A",
        key_confidence=0.9,
        intro_cue_ms=500,
        outro_cue_ms=175_000,
    )
