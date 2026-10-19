from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import threading
import uuid

from sqlalchemy import text

from crate.db.jobs.analysis_storage import (
    SmartMixPublication,
    capture_smart_mix_source,
    publish_smart_mix_profile,
    record_smart_mix_failure,
)
from crate.db.jobs.smart_mix_backfill import claim_smart_mix_backfill_batch
from crate.db.repositories.smart_mix import get_track_mix_profile
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft
from crate.smart_mix.versions import ANALYZER_VERSION


def test_full_rust_profile_promotes_partial_python_profile(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "promotion")

    python = capture_smart_mix_source(track_id, path)
    assert (
        publish_smart_mix_profile(python, _draft(quality=MixProfileQuality.PARTIAL))
        is SmartMixPublication.PUBLISHED
    )
    rust = capture_smart_mix_source(track_id, path)

    outcome = publish_smart_mix_profile(rust, _draft(analyzer="crate-rust"))

    assert outcome is SmartMixPublication.PUBLISHED
    stored = get_track_mix_profile(track_id)
    assert stored is not None
    assert stored.analyzer == "crate-rust"
    assert stored.quality is MixProfileQuality.FULL


def test_partial_result_never_replaces_a_full_profile_of_the_same_source(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "no-downgrade")
    publish_smart_mix_profile(capture_smart_mix_source(track_id, path), _draft())

    outcome = publish_smart_mix_profile(
        capture_smart_mix_source(track_id, path),
        _draft(analyzer="crate-rust", quality=MixProfileQuality.PARTIAL),
    )

    assert outcome is SmartMixPublication.UNCHANGED
    stored = get_track_mix_profile(track_id)
    assert stored is not None
    assert stored.quality is MixProfileQuality.FULL


def test_older_analyzer_never_replaces_a_current_generation_profile(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "rolling-deploy")
    publish_smart_mix_profile(capture_smart_mix_source(track_id, path), _draft())

    outcome = publish_smart_mix_profile(
        capture_smart_mix_source(track_id, path),
        replace(_draft(analyzer="crate-rust"), analyzer_version="smart-mix-v1"),
    )

    assert outcome is SmartMixPublication.UNCHANGED
    stored = get_track_mix_profile(track_id)
    assert stored is not None
    assert stored.analyzer_version == ANALYZER_VERSION


def test_current_generation_replaces_an_older_analyzer_profile(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "generation-upgrade")
    publish_smart_mix_profile(
        capture_smart_mix_source(track_id, path),
        replace(_draft(), analyzer_version="smart-mix-v1"),
    )

    outcome = publish_smart_mix_profile(
        capture_smart_mix_source(track_id, path),
        _draft(quality=MixProfileQuality.PARTIAL),
    )

    assert outcome is SmartMixPublication.PUBLISHED
    stored = get_track_mix_profile(track_id)
    assert stored is not None
    assert stored.analyzer_version == ANALYZER_VERSION


def test_changed_source_during_analysis_discards_the_draft(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "changed-source")
    capture = capture_smart_mix_source(track_id, path)
    path.write_bytes(b"replaced audio with a different size")

    outcome = publish_smart_mix_profile(capture, _draft())

    assert outcome is SmartMixPublication.SOURCE_CHANGED
    assert get_track_mix_profile(track_id) is None


def test_reassigned_track_path_discards_the_draft(pg_db, tmp_path: Path) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "moved")
    capture = capture_smart_mix_source(track_id, path)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET path = :path WHERE id = :id"),
            {"path": str(tmp_path / "elsewhere.flac"), "id": track_id},
        )

    outcome = publish_smart_mix_profile(capture, _draft())

    assert outcome is SmartMixPublication.TRACK_MOVED
    assert get_track_mix_profile(track_id) is None


def test_stale_capture_loses_to_a_newer_publication(pg_db, tmp_path: Path) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "stale-capture")
    first = capture_smart_mix_source(track_id, path)
    second = capture_smart_mix_source(track_id, path)
    publish_smart_mix_profile(second, _draft(analyzer="crate-rust"))

    outcome = publish_smart_mix_profile(first, _draft(bpm=99.0))

    assert outcome is SmartMixPublication.SUPERSEDED
    stored = get_track_mix_profile(track_id)
    assert stored is not None
    assert stored.analyzer == "crate-rust"
    assert stored.bpm == 120.0


def test_concurrent_publishers_produce_a_single_winner(pg_db, tmp_path: Path) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "race")
    captures = [capture_smart_mix_source(track_id, path) for _ in range(2)]
    drafts = [_draft(bpm=121.0), _draft(bpm=122.0)]
    barrier = threading.Barrier(2)
    outcomes: list[SmartMixPublication] = []

    def publish(index: int) -> None:
        barrier.wait()
        outcomes.append(publish_smart_mix_profile(captures[index], drafts[index]))

    threads = [threading.Thread(target=publish, args=(index,)) for index in (0, 1)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(outcomes) == sorted(
        [SmartMixPublication.PUBLISHED, SmartMixPublication.SUPERSEDED]
    )
    stored = get_track_mix_profile(track_id)
    assert stored is not None
    assert stored.bpm in {121.0, 122.0}


def test_lost_claim_neither_publishes_nor_completes_the_new_claim(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "lost-claim")
    [claimed] = _claim(track_id)
    capture = capture_smart_mix_source(
        track_id, path, claim_token=claimed["claim_token"]
    )
    _reassign_claim(track_id, "worker:newer-claim")

    outcome = publish_smart_mix_profile(capture, _draft())

    assert outcome is SmartMixPublication.LOST_CLAIM
    assert get_track_mix_profile(track_id) is None
    assert _processing(track_id) == {
        "state": "analyzing",
        "claimed_by": "worker:newer-claim",
    }


def test_owned_claim_is_completed_after_publication(pg_db, tmp_path: Path) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "owned-claim")
    [claimed] = _claim(track_id)
    capture = capture_smart_mix_source(
        track_id, path, claim_token=claimed["claim_token"]
    )

    outcome = publish_smart_mix_profile(capture, _draft())

    assert outcome is SmartMixPublication.PUBLISHED
    assert _processing(track_id) == {"state": "done", "claimed_by": None}


def test_late_failure_does_not_fail_a_newer_claim(pg_db, tmp_path: Path) -> None:
    del pg_db
    path, track_id = _track(tmp_path, "late-failure")
    [claimed] = _claim(track_id)
    _reassign_claim(track_id, "worker:newer-claim")

    record_smart_mix_failure(
        track_id, path, "decoder exploded", claim_token=claimed["claim_token"]
    )

    assert _processing(track_id) == {
        "state": "analyzing",
        "claimed_by": "worker:newer-claim",
    }
    assert get_track_mix_profile(track_id) is None


def _claim(track_id: int) -> list[dict]:
    claimed = claim_smart_mix_backfill_batch(
        limit=1, offline_track_ids=[track_id], claimed_by="worker:first"
    )
    return [row for row in claimed if int(row["id"]) == track_id]


def _reassign_claim(track_id: int, claimed_by: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE track_processing_state
                SET claimed_by = :claimed_by, claimed_at = NOW()
                WHERE track_id = :track_id AND pipeline = 'smart_mix'
                """
            ),
            {"track_id": track_id, "claimed_by": claimed_by},
        )


def _processing(track_id: int) -> dict:
    with read_scope() as session:
        return dict(
            session.execute(
                text(
                    """
                    SELECT state, claimed_by
                    FROM track_processing_state
                    WHERE track_id = :track_id AND pipeline = 'smart_mix'
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .one()
        )


def _draft(
    *,
    analyzer: str = "crate-python",
    quality: MixProfileQuality = MixProfileQuality.FULL,
    bpm: float = 120.0,
) -> TrackMixProfileDraft:
    return replace(
        TrackMixProfileDraft(
            analyzer="crate-python",
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
            intro_cue_ms=500,
            outro_cue_ms=175_000,
        ),
        analyzer=analyzer,
        quality=quality,
        bpm=bpm,
    )


def _track(tmp_path: Path, name: str) -> tuple[Path, int]:
    path = tmp_path / f"{name}.flac"
    path.write_bytes(f"audio-{name}".encode())
    suffix = uuid.uuid4().hex
    artist = f"Publication Artist {suffix}"
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
        track_id = session.execute(
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
                "title": f"Track {suffix}",
                "path": str(path),
                "track_uid": str(uuid.uuid4()),
            },
        ).scalar_one()
    return path, int(track_id)


def test_embedded_profile_with_a_stale_captured_source_is_discarded(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    from crate.db.jobs.analysis_storage import (
        smart_mix_source_revision,
        store_analysis_result,
    )

    path, track_id = _track(tmp_path, "embedded-stale")
    captured = smart_mix_source_revision(path)
    path.write_bytes(b"audio replaced while the daemon was analysing")

    store_analysis_result(
        track_id,
        str(path),
        {
            "bpm": 120.0,
            "key": "A",
            "scale": "minor",
            "energy": 0.7,
            "mood": None,
            "smart_mix_source_revision": captured,
            "mix_profile": {
                "analyzer": "crate-rust",
                "analyzerVersion": ANALYZER_VERSION,
                "durationMs": 180_000,
                "quality": "full",
            },
        },
    )

    assert get_track_mix_profile(track_id) is None
