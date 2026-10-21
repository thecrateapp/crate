"""Exact repairs preserve identity locks without deadlocking Bliss centroids."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from queue import Queue
from threading import Event

import pytest
from sqlalchemy import text

from tests.test_agent_library_operations import _assert_backend_waits_for
from tests.test_agent_metadata import _flac
from tests.test_agent_analysis_sync import _album_for
from tests.test_agent_repairs import (
    _issue,
    _plan,
    repair_world as repair_world,
)
from tests.test_bliss_writer_serialization import _authorize, _bliss_claim


def _tag_repair(pg_db, tmp_path, has_centroid=False):
    from crate import agent_repairs
    from crate.analysis_provenance import source_identity
    from crate.db.health import upsert_health_issue

    track, claim = _bliss_claim(pg_db, tmp_path, has_centroid)
    track["album_id"] = _album_for(track)["id"]
    path = Path(track["path"])
    _flac(
        path,
        title="Track",
        album="Album",
        artist=track["artist"],
        albumartist="Reviewed tagged artist",
    )
    claim["_source"] = source_identity(str(path))
    issue_id = upsert_health_issue(
        "tag_mismatch",
        "medium",
        "Canonical tag mismatch",
        {"artist": track["artist"], "track_path": str(path)},
        auto_fixable=True,
    )
    assert issue_id is not None
    config = {"library_path": str(tmp_path)}
    plan = agent_repairs.compile_operation("repairs", {"issue_ids": [issue_id]}, config)
    assert plan["document"]["executable"], plan
    return track, claim, config, plan


@pytest.mark.parametrize("has_centroid", [False, True])
def test_exact_repair_serializes_with_first_and_existing_bliss_centroid(
    pg_db, tmp_path, monkeypatch, has_centroid
):
    from crate import agent_repairs
    from crate.db.jobs import analysis_storage
    from crate.db.repositories import agent_repairs as repair_repo
    from crate.db.tx import optional_scope, read_scope

    track, claim, config, plan = _tag_repair(pg_db, tmp_path, has_centroid)
    path = Path(track["path"])
    original_file = path.read_bytes()
    before_centroid, resume_centroid = Event(), Event()
    store_pids, repair_pids = Queue(), Queue()
    real_centroid = analysis_storage.refresh_artist_bliss_centroids_for_track_ids

    def paused_centroid(current, ids):
        store_pids.put(current.execute(text("SELECT pg_backend_pid()")).scalar_one())
        before_centroid.set()
        assert resume_centroid.wait(10), "Test did not release centroid persistence"
        return real_centroid(current, ids)

    @contextmanager
    def observed_repair_scope(session=None):
        with optional_scope(session) as current:
            current.execute(text("SET LOCAL statement_timeout='15s'"))
            repair_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            yield current

    monkeypatch.setattr(
        analysis_storage,
        "refresh_artist_bliss_centroids_for_track_ids",
        paused_centroid,
    )
    monkeypatch.setattr(repair_repo, "optional_scope", observed_repair_scope)

    with ThreadPoolExecutor(max_workers=2) as pool:
        stored = pool.submit(
            analysis_storage.store_bliss_vector,
            track["id"],
            [0.75] * 20,
            claim=claim,
            signature="current-bliss",
        )
        try:
            assert before_centroid.wait(5), "Bliss never reached centroid persistence"
            repaired = pool.submit(
                agent_repairs.apply_operation,
                "repairs",
                plan["execution"],
                config,
                task_id="repair-bliss",
                authorize=_authorize,
            )
            _assert_backend_waits_for(
                repaired, repair_pids.get(timeout=5), store_pids.get(timeout=5)
            )
        finally:
            resume_centroid.set()
        stored.result(timeout=16)
        result = repaired.result(timeout=16)

    assert result["execution"]["items"][0]["status"] == "conflict", result
    assert result["execution"]["items"][0]["code"] == "SOURCE_CHANGED"
    assert path.read_bytes() == original_file
    with read_scope() as current:
        row = (
            current.execute(
                text("""SELECT t.entity_uid::text,t.title,t.bliss_vector,t.bliss_state,
                ps.state,ps.generation,ps.claim_token,ps.pipeline_signature,
                c.bliss_vector AS centroid,c.track_count,i.status AS issue_status
                FROM library_tracks t JOIN track_processing_state ps ON ps.track_id=t.id
                JOIN library_albums a ON a.id=t.album_id
                JOIN library_artists ar ON ar.name=a.artist
                JOIN artist_bliss_centroids c ON c.artist_id=ar.id
                JOIN health_issues i ON i.id=:issue
                WHERE t.id=:id AND ps.pipeline='bliss'"""),
                {"id": track["id"], "issue": plan["execution"]["items"][0]["issue_id"]},
            )
            .mappings()
            .one()
        )
    assert row["entity_uid"] == track["entity_uid"]
    assert row["bliss_state"] == row["state"] == "done"
    assert row["generation"] == claim["generation"]
    assert row["claim_token"] is None
    assert row["pipeline_signature"] == "current-bliss"
    assert row["bliss_vector"] == row["centroid"] == [0.75] * 20
    assert row["track_count"] == 1
    assert row["title"] == "Track"
    assert row["issue_status"] == "open"


@pytest.mark.parametrize("entity", ["artist", "album", "track"])
def test_exact_repair_keeps_library_identity_locked_during_filesystem_check(
    pg_db, tmp_path, monkeypatch, entity
):
    from crate.db.repositories.agent_repairs import apply_repair_item
    from crate.db.tx import transaction_scope

    track, _, _, plan = _tag_repair(pg_db, tmp_path)
    item = plan["execution"]["items"][0]
    locked, resume = Event(), Event()
    repair_pids, change_pids = Queue(), Queue()

    def check_files():
        locked.set()
        assert resume.wait(10), "Test did not release the repair filesystem check"
        return {"status": "conflict", "code": "NO_FILESYSTEM_EFFECT"}

    def repair():
        with transaction_scope() as current:
            repair_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            return apply_repair_item(
                item,
                check_files=check_files,
                task_id="repair-identity",
                session=current,
            )

    def change_identity():
        queries = {
            "artist": "UPDATE library_artists SET folder_name='moved' WHERE name=:artist",
            "album": "UPDATE library_albums SET path=path || '-moved' WHERE id=:album",
            "track": "UPDATE library_tracks SET path=path || '-moved' WHERE id=:track",
        }
        with transaction_scope() as current:
            current.execute(text("SET LOCAL statement_timeout='15s'"))
            change_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            current.execute(
                text(queries[entity]),
                {
                    "artist": track["artist"],
                    "album": track["album_id"],
                    "track": track["id"],
                },
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        repairing = pool.submit(repair)
        try:
            assert locked.wait(5), "Repair never reached its locked filesystem check"
            changing = pool.submit(change_identity)
            _assert_backend_waits_for(
                changing, change_pids.get(timeout=5), repair_pids.get(timeout=5)
            )
        finally:
            resume.set()
        assert repairing.result(timeout=16) == {
            "status": "conflict",
            "code": "NO_FILESYSTEM_EFFECT",
        }
        changing.result(timeout=16)


def test_artist_delete_repair_blocks_new_foreign_keys_before_filesystem_effects(
    repair_world,
):
    from crate.db.repositories.agent_repairs import apply_repair_item
    from crate.db.tx import transaction_scope

    world = repair_world
    issue = _issue(world, "stale_artists")
    plan = _plan(world, issue)
    assert plan["document"]["executable"], plan
    item = plan["execution"]["items"][0]
    locked, resume = Event(), Event()
    repair_pids, insert_pids = Queue(), Queue()

    def check_files():
        locked.set()
        assert resume.wait(10), "Test did not release the artist delete check"
        return {"status": "conflict", "code": "NO_FILESYSTEM_EFFECT"}

    def repair():
        with transaction_scope() as current:
            repair_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            return apply_repair_item(
                item, check_files=check_files, task_id="delete-fk", session=current
            )

    def insert_centroid():
        with transaction_scope() as current:
            current.execute(text("SET LOCAL statement_timeout='15s'"))
            insert_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            current.execute(
                text(
                    "INSERT INTO artist_bliss_centroids(artist_id,artist_name,track_count,bliss_vector) "
                    "VALUES (:id,'Artist',1,CAST(:vector AS double precision[]))"
                ),
                {"id": world["artist_id"], "vector": [0.75] * 20},
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        repairing = pool.submit(repair)
        try:
            assert locked.wait(5), "Repair never reached its delete filesystem check"
            inserting = pool.submit(insert_centroid)
            _assert_backend_waits_for(
                inserting, insert_pids.get(timeout=5), repair_pids.get(timeout=5)
            )
        finally:
            resume.set()
        assert repairing.result(timeout=16) == {
            "status": "conflict",
            "code": "NO_FILESYSTEM_EFFECT",
        }
        inserting.result(timeout=16)


def test_non_delete_repair_allows_first_centroid_foreign_key_after_locked_reload(
    pg_db,
    tmp_path,
):
    from crate.db.repositories.agent_repairs import apply_repair_item
    from crate.db.tx import transaction_scope

    track, _, _, plan = _tag_repair(pg_db, tmp_path)
    item = plan["execution"]["items"][0]
    assert item["action"] != "delete_artist"
    locked, resume = Event(), Event()

    def check_files():
        locked.set()
        assert resume.wait(10), "Test did not release the non-delete repair check"
        return {"status": "conflict", "code": "NO_FILESYSTEM_EFFECT"}

    def repair():
        return apply_repair_item(
            item, check_files=check_files, task_id="repair-centroid-fk"
        )

    def insert_centroid():
        with transaction_scope() as current:
            current.execute(text("SET LOCAL statement_timeout='8s'"))
            return current.execute(
                text(
                    "INSERT INTO artist_bliss_centroids(artist_id,artist_name,track_count,bliss_vector) "
                    "SELECT id,name,1,CAST(:vector AS double precision[]) "
                    "FROM library_artists WHERE name=:artist RETURNING artist_id"
                ),
                {"artist": track["artist"], "vector": [0.75] * 20},
            ).scalar_one()

    with ThreadPoolExecutor(max_workers=2) as pool:
        repairing = pool.submit(repair)
        try:
            assert locked.wait(5), "Repair never completed its locked source reload"
            inserting = pool.submit(insert_centroid)
            assert inserting.result(timeout=5) is not None
            assert not repairing.done(), "Repair released its identity locks too early"
        finally:
            resume.set()
        assert repairing.result(timeout=16) == {
            "status": "conflict",
            "code": "NO_FILESYSTEM_EFFECT",
        }
