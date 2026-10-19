from __future__ import annotations

from pathlib import Path

from sqlalchemy import text

from crate.db.jobs.analysis_storage import (
    SmartMixPublication,
    capture_smart_mix_source,
    publish_smart_mix_profile,
)
from crate.db.jobs.smart_mix_backfill import refresh_smart_mix_coverage
from crate.db.queries.smart_mix_compatible import compatible_candidate_statement
from crate.db.repositories.library_writes import upsert_track
from crate.db.repositories.smart_mix import (
    get_track_mix_profile,
    get_track_mix_profile_by_entity_uid,
)
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.source import smart_mix_source_revision
from tests.test_smart_mix_publication import _claim, _draft, _processing, _track


def test_changed_audio_bytes_stop_serving_the_profile_and_requeue_analysis(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path, track_id = _published_track(tmp_path, "rewritten")
    path.write_bytes(b"rewritten audio bytes that change the size")

    _sync(track_id, path)

    assert get_track_mix_profile(track_id) is None
    assert get_track_mix_profile_by_entity_uid(_entity_uid(track_id)) is None
    processing = _processing(track_id)
    assert processing["state"] == "pending"
    assert processing["claimed_by"] is None
    assert [row["id"] for row in _claim(track_id)] == [track_id]


def test_unchanged_source_keeps_the_profile_current(pg_db, tmp_path: Path) -> None:
    del pg_db
    path, track_id = _published_track(tmp_path, "untouched")

    _sync(track_id, path)

    assert get_track_mix_profile(track_id) is not None
    assert _processing(track_id)["state"] == "done"


def test_source_change_does_not_steal_an_active_claim(pg_db, tmp_path: Path) -> None:
    del pg_db
    path, track_id = _published_track(tmp_path, "claimed")
    assert len(_claim_after_reanalysis_request(track_id)) == 1
    claim_token = _processing(track_id)["claimed_by"]
    path.write_bytes(b"changed while a worker holds the claim")

    _sync(track_id, path)

    processing = _processing(track_id)
    assert processing["state"] == "analyzing"
    assert processing["claimed_by"] == claim_token
    assert get_track_mix_profile(track_id) is None


def test_publishing_the_new_source_serves_the_profile_again(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    path, track_id = _published_track(tmp_path, "republished")
    path.write_bytes(b"new audio after a retag")
    _sync(track_id, path)

    outcome = publish_smart_mix_profile(
        capture_smart_mix_source(track_id, path), _draft()
    )

    assert outcome is SmartMixPublication.PUBLISHED
    stored = get_track_mix_profile(track_id)
    assert stored is not None
    assert stored.source_revision == smart_mix_source_revision(path)


def test_coverage_counts_a_stale_source_as_stale(pg_db, tmp_path: Path) -> None:
    del pg_db
    path, track_id = _published_track(tmp_path, "coverage")
    before = refresh_smart_mix_coverage()
    path.write_bytes(b"coverage changed bytes")

    _sync(track_id, path)
    after = refresh_smart_mix_coverage()

    assert after["current_profiles"] == before["current_profiles"] - 1
    assert after["stale_profiles"] == before["stale_profiles"] + 1


def test_compatible_queries_ignore_stale_profiles() -> None:
    assert "source_stale_at IS NULL" in compatible_candidate_statement().text


def _published_track(tmp_path: Path, name: str) -> tuple[Path, int]:
    path, track_id = _track(tmp_path, name)
    outcome = publish_smart_mix_profile(
        capture_smart_mix_source(track_id, path), _draft()
    )
    assert outcome is SmartMixPublication.PUBLISHED
    return path, track_id


def _sync(track_id: int, path: Path) -> None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT album_id, artist, album, filename, title, entity_uid
                    FROM library_tracks WHERE id = :track_id
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .one()
        )
    upsert_track(
        {
            "album_id": row["album_id"],
            "artist": row["artist"],
            "album": row["album"],
            "filename": row["filename"],
            "title": row["title"],
            "entity_uid": str(row["entity_uid"]),
            "path": str(path),
            "size": path.stat().st_size,
            "duration": 180.0,
            "smart_mix_source_revision": smart_mix_source_revision(path),
        }
    )


def _claim_after_reanalysis_request(track_id: int) -> list[dict]:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE track_mix_profiles SET analyzer_version = 'smart-mix-v1'
                WHERE track_id = :track_id
                """
            ),
            {"track_id": track_id},
        )
    return _claim(track_id)


def _entity_uid(track_id: int) -> str:
    with read_scope() as session:
        return str(
            session.execute(
                text("SELECT entity_uid FROM library_tracks WHERE id = :track_id"),
                {"track_id": track_id},
            ).scalar_one()
        )
