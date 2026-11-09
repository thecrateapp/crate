from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import uuid

from sqlalchemy import text

from crate.db.jobs.analysis_storage import (
    record_smart_mix_failure,
    store_analysis_result,
    store_smart_mix_profile_result,
)
from crate.db.repositories.library_processing_state import (
    ensure_track_processing_rows,
)
from crate.db.repositories.smart_mix import get_track_mix_profile
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.models import MixProfileQuality, Phrase, TrackMixProfileDraft
from crate.smart_mix.versions import ANALYZER_VERSION, READABLE_ANALYZER_VERSIONS


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


STRUCTURE_PHRASES = (
    Phrase(
        start_beat=0,
        start_ms=500,
        bars=8,
        energy=0.61,
        delta_energy=None,
        kind="intro",
    ),
    Phrase(
        start_beat=32,
        start_ms=16_500,
        bars=16,
        energy=0.8125,
        delta_energy=0.2025,
        kind="peak",
    ),
)
STRUCTURE_CURVE = bytes((0, 12, 200, 255, 128, 64))


def test_persists_structure_fields(pg_db, tmp_path: Path) -> None:
    del pg_db
    path = tmp_path / "structure.flac"
    path.write_bytes(b"structured-source")
    track_id, _track_uid = _create_track(path)
    draft = replace(
        _draft(),
        phrases=STRUCTURE_PHRASES,
        energy_curve=STRUCTURE_CURVE,
        vocal_presence=bytes((12, 240)),
        vocal_detector="yamnet-1",
        structure_confidence=0.8234,
    )

    assert store_smart_mix_profile_result(track_id, path, draft) is True

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert profile.phrases == STRUCTURE_PHRASES
    assert profile.energy_curve == STRUCTURE_CURVE
    assert profile.vocal_presence == bytes((12, 240))
    assert profile.vocal_detector == "yamnet-1"
    assert profile.structure_confidence == 0.8234
    # Readers that do not plan by phrase never load the structure.
    summary = get_track_mix_profile(track_id)
    assert summary is not None
    assert (
        summary.phrases,
        summary.energy_curve,
        summary.vocal_presence,
        summary.vocal_detector,
        summary.structure_confidence,
    ) == (None, None, None, None, None)
    with read_scope() as session:
        stored = (
            session.execute(
                text(
                    """
                    SELECT phrases, energy_curve
                    FROM track_mix_profiles WHERE track_id = :track_id
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .one()
        )
    assert stored["phrases"] == [phrase.to_dict() for phrase in STRUCTURE_PHRASES]
    assert bytes(stored["energy_curve"]) == STRUCTURE_CURVE


def test_persists_beat_tracker(pg_db, tmp_path: Path) -> None:
    del pg_db
    path = tmp_path / "tracked.flac"
    path.write_bytes(b"tracked-source")
    track_id, _track_uid = _create_track(path)
    plain = replace(_draft(), analyzer_version=ANALYZER_VERSION)
    tracked = replace(plain, beat_tracker="beat-this-small0-dbn")
    assert store_smart_mix_profile_result(track_id, path, plain) is True
    before = get_track_mix_profile(track_id)
    assert before is not None

    assert store_smart_mix_profile_result(track_id, path, tracked) is True

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert profile.beat_tracker == "beat-this-small0-dbn"
    # The tracker is part of the revision: the same values from another tracker are
    # another profile.
    assert profile.profile_revision != before.profile_revision
    # Like the voice detector, it is read with the structure, never by plan reads.
    summary = get_track_mix_profile(track_id)
    assert summary is not None and summary.beat_tracker is None
    with read_scope() as session:
        stored = session.execute(
            text("SELECT beat_tracker FROM track_mix_profiles WHERE track_id = :id"),
            {"id": track_id},
        ).scalar_one()
    assert stored == "beat-this-small0-dbn"


def test_draft_with_tracker_replaces_same_version(pg_db, tmp_path: Path) -> None:
    # Beat This! ships inside the analyzer version (SM3-D14), like the voice: a draft
    # that brings a tracker, or another one (the DBN over the first builds' peak
    # picking), replaces a profile of the same version and quality; a draft without
    # one never strips it.
    del pg_db
    path = tmp_path / "replace.flac"
    path.write_bytes(b"replace-source")
    track_id, _track_uid = _create_track(path)
    own = replace(_draft(), analyzer="crate-python", analyzer_version=ANALYZER_VERSION)
    small = replace(own, downbeat_anchor_ms=1_000, beat_tracker="beat-this-small0")
    dbn = replace(small, beat_tracker="beat-this-small0-dbn")

    assert store_smart_mix_profile_result(track_id, path, own) is True
    assert store_smart_mix_profile_result(track_id, path, small) is True
    assert store_smart_mix_profile_result(track_id, path, small) is False
    assert store_smart_mix_profile_result(track_id, path, own) is False
    # Not even a Rust draft, which otherwise promotes a Python profile.
    rust_own = replace(own, analyzer="crate-rust")
    assert store_smart_mix_profile_result(track_id, path, rust_own) is False
    # A tracker never downgrades a full profile.
    partial = replace(dbn, quality=MixProfileQuality.PARTIAL)
    assert store_smart_mix_profile_result(track_id, path, partial) is False
    assert store_smart_mix_profile_result(track_id, path, dbn) is True

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert (profile.beat_tracker, profile.downbeat_anchor_ms) == (
        "beat-this-small0-dbn",
        1_000,
    )


def test_draft_without_tracker_never_replaces_model_beats_of_a_higher_quality(
    pg_db, tmp_path: Path
) -> None:
    # The analyzer's own tracker can rate a track higher than Beat This!'s beats do
    # (a constant grid it fits to its own beats looks steadier), but its grid is the
    # weaker one: a same-version draft without a tracker never replaces a profile whose
    # beats came from the model, whatever its quality.
    del pg_db
    path = tmp_path / "model-beats.flac"
    path.write_bytes(b"model-beats-source")
    track_id, _track_uid = _create_track(path)
    model = replace(
        _draft(),
        analyzer="crate-rust",
        analyzer_version=ANALYZER_VERSION,
        quality=MixProfileQuality.PARTIAL,
        beat_tracker="beat-this-small0-dbn",
    )
    own_full = replace(
        model,
        quality=MixProfileQuality.FULL,
        downbeat_anchor_ms=1_000,
        beat_tracker=None,
    )

    assert store_smart_mix_profile_result(track_id, path, model) is True
    assert store_smart_mix_profile_result(track_id, path, own_full) is False

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert (profile.beat_tracker, profile.quality, profile.downbeat_anchor_ms) == (
        "beat-this-small0-dbn",
        MixProfileQuality.PARTIAL,
        500,
    )


def test_library_analysis_keeps_a_model_profile_of_the_same_version(
    pg_db, tmp_path: Path
) -> None:
    # The library analysis embeds crate-cli's profile, built without Beat This!: a
    # reanalysis of the library (BPM, key, loudness) must not strip the model's beats
    # from the Smart Mix profile, even when its own profile rates full.
    del pg_db
    path = tmp_path / "library.m4a"
    path.write_bytes(b"library-source")
    track_id, _track_uid = _create_track(path)
    model = replace(
        _draft(),
        analyzer="crate-rust",
        analyzer_version=ANALYZER_VERSION,
        quality=MixProfileQuality.PARTIAL,
        beat_tracker="beat-this-small0-dbn",
    )
    assert store_smart_mix_profile_result(track_id, path, model) is True

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
                "analyzerVersion": ANALYZER_VERSION,
                "durationMs": 180_000,
                "quality": "full",
                "bpm": 120.0,
                "bpmConfidence": 0.95,
                "tempoStability": 0.97,
                "beatAnchorMs": 500,
                "downbeatAnchorMs": 1_000,
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

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert (profile.beat_tracker, profile.quality, profile.downbeat_anchor_ms) == (
        "beat-this-small0-dbn",
        MixProfileQuality.PARTIAL,
        500,
    )
    with read_scope() as session:
        bpm = session.execute(
            text("SELECT bpm FROM library_tracks WHERE id = :track_id"),
            {"track_id": track_id},
        ).scalar_one()
    # The library fields still take the reanalysis.
    assert bpm == 120.0


PREVIOUS_ANALYZER_VERSION = READABLE_ANALYZER_VERSIONS[1]


def _model_profile(version: str) -> TrackMixProfileDraft:
    return replace(
        _draft(),
        analyzer="crate-rust",
        analyzer_version=version,
        quality=MixProfileQuality.PARTIAL,
        beat_tracker="beat-this-small0-dbn",
    )


def test_draft_without_tracker_never_replaces_model_beats_of_an_older_version(
    pg_db, tmp_path: Path
) -> None:
    # Across versions too: the track keeps its older profile with the model's beats,
    # which the backfill still claims (its version is not the target) and recomputes
    # with Beat This!. Replacing it would leave a current own-tracker profile the
    # backfill never claims again.
    del pg_db
    path = tmp_path / "older-model.flac"
    path.write_bytes(b"older-model-source")
    track_id, _track_uid = _create_track(path)
    older = _model_profile(PREVIOUS_ANALYZER_VERSION)
    own_full = replace(
        older,
        analyzer_version=ANALYZER_VERSION,
        quality=MixProfileQuality.FULL,
        beat_tracker=None,
    )

    assert store_smart_mix_profile_result(track_id, path, older) is True
    assert store_smart_mix_profile_result(track_id, path, own_full) is False

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert (profile.analyzer_version, profile.beat_tracker) == (
        PREVIOUS_ANALYZER_VERSION,
        "beat-this-small0-dbn",
    )


def test_model_draft_of_a_newer_version_replaces_older_model_beats(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path = tmp_path / "newer-model.flac"
    path.write_bytes(b"newer-model-source")
    track_id, _track_uid = _create_track(path)
    older = _model_profile(PREVIOUS_ANALYZER_VERSION)
    newer = replace(older, analyzer_version=ANALYZER_VERSION, downbeat_anchor_ms=1_000)

    assert store_smart_mix_profile_result(track_id, path, older) is True
    assert store_smart_mix_profile_result(track_id, path, newer) is True

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert (profile.analyzer_version, profile.downbeat_anchor_ms) == (
        ANALYZER_VERSION,
        1_000,
    )


def test_a_changed_file_still_takes_a_draft_without_tracker(
    pg_db, tmp_path: Path
) -> None:
    # The model's beats described the old file: a draft of the new file replaces them
    # whatever its tracker.
    del pg_db
    path = tmp_path / "changed.flac"
    path.write_bytes(b"first-source")
    track_id, _track_uid = _create_track(path)
    assert store_smart_mix_profile_result(
        track_id, path, _model_profile(ANALYZER_VERSION)
    )
    path.write_bytes(b"second-source, longer")
    own = replace(_model_profile(ANALYZER_VERSION), beat_tracker=None)

    assert store_smart_mix_profile_result(track_id, path, own) is True

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None and profile.beat_tracker is None


def test_library_analysis_keeps_model_beats_of_an_older_version(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path = tmp_path / "library-older.m4a"
    path.write_bytes(b"library-older-source")
    track_id, _track_uid = _create_track(path)
    assert store_smart_mix_profile_result(
        track_id, path, _model_profile(PREVIOUS_ANALYZER_VERSION)
    )

    store_analysis_result(
        track_id,
        str(path),
        {
            "bpm": 121.0,
            "key": "A",
            "scale": "minor",
            "energy": 0.7,
            "mood": None,
            "mix_profile": {
                "schemaVersion": 1,
                "analyzer": "crate-rust",
                "analyzerVersion": ANALYZER_VERSION,
                "durationMs": 180_000,
                "quality": "full",
                "bpm": 121.0,
                "bpmConfidence": 0.95,
                "tempoStability": 0.97,
                "beatAnchorMs": 500,
                "downbeatAnchorMs": 1_000,
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

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert (profile.analyzer_version, profile.beat_tracker) == (
        PREVIOUS_ANALYZER_VERSION,
        "beat-this-small0-dbn",
    )
    with read_scope() as session:
        bpm = session.execute(
            text("SELECT bpm FROM library_tracks WHERE id = :track_id"),
            {"track_id": track_id},
        ).scalar_one()
    assert bpm == 121.0


def test_unsegmented_structure_stays_distinct_from_no_structure(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path = tmp_path / "unsegmented.flac"
    path.write_bytes(b"unsegmented-source")
    track_id, _track_uid = _create_track(path)
    draft = replace(
        _draft(), phrases=(), energy_curve=bytes(4), structure_confidence=0.0
    )

    assert store_smart_mix_profile_result(track_id, path, draft) is True

    profile = get_track_mix_profile(track_id, include_structure=True)
    assert profile is not None
    assert profile.phrases == ()
    assert profile.energy_curve == bytes(4)
    assert profile.structure_confidence == 0.0


def test_v1_profile_reads_with_null_structure(pg_db, tmp_path: Path) -> None:
    del pg_db
    path = tmp_path / "schema-one.flac"
    path.write_bytes(b"schema-one-source")
    track_id, _track_uid = _create_track(path)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, bpm, analyzed_at
                )
                VALUES (
                    :track_id, 1, 'schema-one', 'crate-rust', 'smart-mix-audio-v6',
                    'source', 'full', 126.0, NOW()
                )
                """
            ),
            {"track_id": track_id},
        )

    profile = get_track_mix_profile(track_id, include_structure=True)

    assert profile is not None
    assert profile.profile_version == 1
    assert profile.analyzer_version == "smart-mix-audio-v6"
    assert profile.bpm == 126.0
    assert (
        profile.phrases,
        profile.energy_curve,
        profile.vocal_presence,
        profile.structure_confidence,
    ) == (None, None, None, None)


def test_profile_revision_hashes_the_stored_values(pg_db, tmp_path: Path) -> None:
    del pg_db
    from crate.db.repositories.library_analysis_writes import (
        upsert_track_mix_profile_draft,
    )

    first_path = tmp_path / "first.flac"
    second_path = tmp_path / "second.flac"
    first_path.write_bytes(b"first")
    second_path.write_bytes(b"second")
    first_id, _ = _create_track(first_path)
    second_id, _ = _create_track(second_path)
    structured = replace(
        _draft(), phrases=STRUCTURE_PHRASES, energy_curve=STRUCTURE_CURVE
    )

    # The confidence column is a REAL that holds four decimals: both drafts store the
    # same row, so they must carry the same revision.
    assert upsert_track_mix_profile_draft(
        first_id, "same-source", replace(structured, structure_confidence=0.82341234)
    )
    assert upsert_track_mix_profile_draft(
        second_id, "same-source", replace(structured, structure_confidence=0.82341236)
    )

    first = get_track_mix_profile(first_id, include_structure=True)
    second = get_track_mix_profile(second_id, include_structure=True)
    assert first is not None and second is not None
    assert first.structure_confidence == second.structure_confidence == 0.8234
    assert first.profile_revision == second.profile_revision


def test_draft_upsert_writes_the_current_profile_schema(
    pg_db, tmp_path: Path, monkeypatch
) -> None:
    del pg_db
    from crate.db.repositories import library_analysis_writes

    current_path = tmp_path / "current-schema.flac"
    next_path = tmp_path / "next-schema.flac"
    current_path.write_bytes(b"current")
    next_path.write_bytes(b"next")
    current_id, _ = _create_track(current_path)
    next_id, _ = _create_track(next_path)

    assert library_analysis_writes.upsert_track_mix_profile_draft(
        current_id, "same-source", _draft()
    )
    monkeypatch.setattr(
        library_analysis_writes,
        "PROFILE_SCHEMA_VERSION",
        library_analysis_writes.PROFILE_SCHEMA_VERSION + 1,
    )
    assert library_analysis_writes.upsert_track_mix_profile_draft(
        next_id, "same-source", _draft()
    )

    current = get_track_mix_profile(current_id)
    upgraded = get_track_mix_profile(next_id)
    assert current is not None and upgraded is not None
    assert upgraded.profile_version == current.profile_version + 1
    assert upgraded.profile_revision != current.profile_revision


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
        # Library upserts always create the analysis/bliss processing rows; the
        # generation fence only accepts claim-less writes for those rows.
        ensure_track_processing_rows(session, int(track_id))
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


def test_rust_payload_carries_measurement_provenance_into_the_draft() -> None:
    from crate.smart_mix.models import mix_profile_draft_from_payload

    draft = mix_profile_draft_from_payload(
        {
            "analyzer": "crate-rust",
            "analyzerVersion": "smart-mix-v1",
            "durationMs": 176_512,
            "quality": "full",
            "activeStartMs": 40,
            "activeEndMs": 175_900,
            "integratedLufs": -8.75,
            "measurementVersion": "bs1770-v1",
        }
    )

    assert draft.duration_ms == 176_512
    assert draft.active_start_ms == 40
    assert draft.active_end_ms == 175_900
    assert draft.integrated_lufs == -8.75
    assert draft.measurement_version == "bs1770-v1"
