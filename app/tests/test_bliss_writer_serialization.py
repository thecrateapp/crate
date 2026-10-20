"""Bliss centroid persistence and library writers share compatible parent locks."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from queue import Queue
from threading import Event

import pytest
from sqlalchemy import text

from tests.test_agent_analysis_sync import (
    _album_for,
    _frozen_scan,
    _requeue,
    _seed_track,
)
from tests.test_agent_library_operations import _assert_backend_waits_for
from tests.test_agent_metadata import _flac


def _bliss_claim(pg_db, tmp_path, has_centroid):
    from crate.analysis_provenance import source_identity
    from crate.db.jobs import analysis_storage
    from crate.db.jobs.analysis_claims import claim_tracks
    from crate.db.tx import transaction_scope

    track = _seed_track(pg_db, "centroid-writer", library_path=str(tmp_path))
    track["artist"] = _album_for(track)["artist"]
    path = Path(track["path"])
    _flac(path, title="Track", album="Album", artist=track["artist"])
    if has_centroid:
        with transaction_scope() as current:
            current.execute(
                text(
                    "UPDATE library_tracks SET bliss_vector=CAST(:vector AS double precision[]) WHERE id=:id"
                ),
                {"vector": [0.25] * 20, "id": track["id"]},
            )
            analysis_storage.refresh_artist_bliss_centroids_for_track_ids(
                current, [track["id"]]
            )
    _requeue(track["id"], "bliss")
    claim = claim_tracks("bliss_state", limit=1)[0]
    assert claim["id"] == track["id"] and claim["generation"] > 0
    claim["_source"] = source_identity(str(path))
    return track, claim


def _authorize(effect=None):
    return effect() if effect is not None else None


@pytest.mark.parametrize("has_centroid", [False, True])
@pytest.mark.parametrize("writer", ["track_metadata", "album_metadata", "sync"])
def test_bliss_centroid_serializes_with_library_writers(
    pg_db, tmp_path, monkeypatch, writer, has_centroid
):
    from crate import agent_metadata
    from crate.db.jobs import analysis_storage
    from crate.db.queries.agent_sync import read_sync_state, sync_state_version
    from crate.db.repositories import agent_metadata as metadata_repo
    from crate.db.repositories import agent_sync
    from crate.db.tx import optional_scope, read_scope

    track, claim = _bliss_claim(pg_db, tmp_path, has_centroid)
    album = _album_for(track)
    config = {"library_path": str(tmp_path)}
    path = Path(track["path"])
    if writer == "sync":
        state = read_sync_state(album["entity_uid"])
        version = sync_state_version(state)
        prepared = _frozen_scan(path.parent, track["artist"])
        prepared["track_payloads"] = state["tracks"]
    else:
        kind = "track" if writer == "track_metadata" else "album"
        uid = track["entity_uid"] if kind == "track" else album["entity_uid"]
        plan = agent_metadata.compile_operation(
            "metadata_update",
            {
                "entity_type": kind,
                "entity_uid": uid,
                "patch": {"genre": "Reviewed genre"},
            },
            config,
        )

    before_centroid, resume_centroid = Event(), Event()
    store_pids, writer_pids = Queue(), Queue()
    real_centroid = analysis_storage.refresh_artist_bliss_centroids_for_track_ids

    def paused_centroid(current, ids):
        store_pids.put(current.execute(text("SELECT pg_backend_pid()")).scalar_one())
        before_centroid.set()
        assert resume_centroid.wait(10), (
            "Writer test did not release centroid persistence"
        )
        return real_centroid(current, ids)

    @contextmanager
    def observed_writer_scope(session=None):
        with optional_scope(session) as current:
            current.execute(text("SET LOCAL statement_timeout='15s'"))
            writer_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            yield current

    monkeypatch.setattr(
        analysis_storage,
        "refresh_artist_bliss_centroids_for_track_ids",
        paused_centroid,
    )
    module = agent_sync if writer == "sync" else metadata_repo
    monkeypatch.setattr(module, "optional_scope", observed_writer_scope)

    def write_library():
        if writer == "sync":
            return agent_sync.apply_sync_album(
                album["entity_uid"],
                expected_version=version,
                prepared=prepared,
                validate_source=lambda: True,
            )
        return agent_metadata.apply_operation(
            "metadata_update",
            plan["execution"],
            config,
            task_id="centroid-writer",
            authorize=_authorize,
        )

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
            edited = pool.submit(write_library)
            _assert_backend_waits_for(
                edited, writer_pids.get(timeout=5), store_pids.get(timeout=5)
            )
        finally:
            resume_centroid.set()
        stored.result(timeout=16)
        result = edited.result(timeout=16)

    if writer == "sync":
        assert result["status"] == "applied", result
    else:
        assert result["execution"]["status"] == "conflict", result
        assert result["execution"]["code"] == "SOURCE_CHANGED"
    with read_scope() as current:
        row = (
            current.execute(
                text("""SELECT t.entity_uid::text,t.title,t.bliss_vector,t.bliss_state,
                ps.state,ps.generation,ps.claim_token,ps.pipeline_signature,
                c.bliss_vector AS centroid,c.track_count
                FROM library_tracks t JOIN track_processing_state ps ON ps.track_id=t.id
                JOIN library_albums a ON a.id=t.album_id
                JOIN library_artists ar ON ar.name=a.artist
                JOIN artist_bliss_centroids c ON c.artist_id=ar.id
                WHERE t.id=:id AND ps.pipeline='bliss'"""),
                {"id": track["id"]},
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


@pytest.mark.parametrize("writer", ["track_metadata", "album_metadata", "sync"])
def test_library_writer_keeps_parent_identity_locked_until_commit(
    pg_db, tmp_path, monkeypatch, writer
):
    from crate import agent_metadata
    from crate.db.queries.agent_sync import read_sync_state, sync_state_version
    from crate.db.repositories import agent_metadata as metadata_repo
    from crate.db.repositories import agent_sync
    from crate.db.tx import read_scope, transaction_scope

    track = _seed_track(pg_db, "parent-identity", library_path=str(tmp_path))
    album = _album_for(track)
    path = Path(track["path"])
    _flac(path, title="Track", album="Album", artist=album["artist"])
    config = {"library_path": str(tmp_path)}
    if writer == "sync":
        state = read_sync_state(album["entity_uid"])
        version = sync_state_version(state)
        prepared = _frozen_scan(path.parent, album["artist"])
        prepared["track_payloads"] = state["tracks"]
    else:
        kind = "track" if writer == "track_metadata" else "album"
        uid = track["entity_uid"] if kind == "track" else album["entity_uid"]
        plan = agent_metadata.compile_operation(
            "metadata_update",
            {
                "entity_type": kind,
                "entity_uid": uid,
                "patch": {"genre": "Reviewed genre"},
            },
            config,
        )
    locked, resume = Event(), Event()
    writer_pids, change_pids = Queue(), Queue()
    module = agent_sync if writer == "sync" else metadata_repo
    method = "read_sync_state" if writer == "sync" else "_load"
    original_read = getattr(module, method)

    def observe_locked_read(*args, **kwargs):
        result = original_read(*args, **kwargs)
        if kwargs.get("locked"):
            current = kwargs["session"] if writer == "sync" else args[0]
            writer_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            locked.set()
            assert resume.wait(10), "Test did not release the library writer"
        return result

    monkeypatch.setattr(module, method, observe_locked_read)

    def write_library():
        if writer == "sync":
            return agent_sync.apply_sync_album(
                album["entity_uid"],
                expected_version=version,
                prepared=prepared,
                validate_source=lambda: True,
            )
        return agent_metadata.apply_operation(
            "metadata_update",
            plan["execution"],
            config,
            task_id="parent-identity",
            authorize=_authorize,
        )

    def change_folder():
        with transaction_scope() as current:
            current.execute(text("SET LOCAL statement_timeout='15s'"))
            change_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            current.execute(
                text(
                    "UPDATE library_artists SET folder_name='new-parent-folder' WHERE name=:name"
                ),
                {"name": album["artist"]},
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        editing = pool.submit(write_library)
        try:
            assert locked.wait(5), "Writer did not acquire its identity locks"
            changing = pool.submit(change_folder)
            _assert_backend_waits_for(
                changing, change_pids.get(timeout=5), writer_pids.get(timeout=5)
            )
        finally:
            resume.set()
        result = editing.result(timeout=16)
        changing.result(timeout=16)
    assert (
        result["status"] if writer == "sync" else result["execution"]["status"]
    ) == ("applied" if writer == "sync" else "completed")
    with read_scope() as current:
        folder = current.execute(
            text("SELECT folder_name FROM library_artists WHERE name=:name"),
            {"name": album["artist"]},
        ).scalar_one()
    assert folder == "new-parent-folder"
