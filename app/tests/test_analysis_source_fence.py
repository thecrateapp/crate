"""Persist DSP output only for the physical source captured by the claim."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from queue import Queue

import pytest
from sqlalchemy import text

from tests.test_agent_analysis_sync import _payload, _processing, _requeue, _seed_track
from tests.test_agent_library_operations import _assert_backend_waits_for


def _claimed(pg_db, tmp_path, pipeline, suffix="source"):
    from crate.analysis_provenance import result_signature, source_identity
    from crate.db.jobs.analysis_claims import claim_track

    track = _seed_track(pg_db, f"{suffix}-{pipeline}", library_path=str(tmp_path))
    path = Path(track["path"])
    path.parent.mkdir(parents=True)
    path.write_bytes(b"original audio source")
    _requeue(track["id"], pipeline)
    claim = claim_track(f"{pipeline}_state")
    assert claim is not None and claim["id"] == track["id"]
    assert claim["generation"] > 0
    claim["_source"] = source_identity(str(path))
    return track, claim, result_signature(pipeline, claim["_source"], [])


def _persist(track, claim, signature, pipeline, entrypoint):
    from crate.db.jobs import analysis_storage as storage

    track_id = track["id"]
    if entrypoint == "mark_done":
        storage.mark_done(track_id, f"{pipeline}_state", claim=claim)
    elif pipeline == "analysis":
        if entrypoint == "single":
            storage.store_analysis_result(
                track_id,
                track["path"],
                {"bpm": 123.0},
                claim=claim,
                signature=signature,
            )
        else:
            storage.store_analysis_results(
                [(track_id, track["path"], {"bpm": 123.0})],
                claims={track_id: claim},
                signatures={track_id: signature},
            )
    elif entrypoint == "single":
        storage.store_bliss_vector(
            track_id, [123.0] * 20, claim=claim, signature=signature
        )
    else:
        storage.store_bliss_vectors(
            {track_id: [123.0] * 20},
            claims={track_id: claim},
            signatures={track_id: signature},
        )


def _change_source(path, change):
    if change == "replaced":
        replacement = path.with_name("replacement.tmp")
        replacement.write_bytes(b"different audio recording")
        replacement.replace(path)
    elif change == "missing":
        path.unlink()
    else:
        target = path.with_name("linked.flac")
        target.write_bytes(b"untrusted linked source")
        path.unlink()
        path.symlink_to(target)


def _assert_rejected(track, pipeline):
    processing = _processing(track["id"], pipeline)
    assert processing["state"] == "failed"
    assert processing["claim_token"] is None
    assert processing["claimed_at"] is None
    assert processing["claimed_by"] is None
    assert processing["last_error"] == "SOURCE_CHANGED"
    assert processing["pipeline_signature"] is None
    payload = _payload(track["id"], pipeline)
    assert payload["state"] == "failed"
    assert payload["shadow_value"] is None
    assert payload["bpm" if pipeline == "analysis" else "vector"] is None


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
@pytest.mark.parametrize("entrypoint", ["single", "batch", "mark_done"])
@pytest.mark.parametrize("change", ["replaced", "missing", "symlink"])
def test_successful_persistence_rejects_changed_physical_source(
    pg_db, tmp_path, pipeline, entrypoint, change
):
    from crate.analysis_daemon import _source_unchanged

    track, claim, signature = _claimed(pg_db, tmp_path, pipeline)
    assert _source_unchanged(claim, f"{pipeline}_state") is True
    _change_source(Path(track["path"]), change)

    _persist(track, claim, signature, pipeline, entrypoint)

    _assert_rejected(track, pipeline)


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
@pytest.mark.parametrize("entrypoint", ["single", "batch", "mark_done"])
def test_successful_persistence_accepts_unchanged_physical_source(
    pg_db, tmp_path, pipeline, entrypoint
):
    track, claim, signature = _claimed(pg_db, tmp_path, pipeline)

    _persist(track, claim, signature, pipeline, entrypoint)

    processing = _processing(track["id"], pipeline)
    assert processing["state"] == "done"
    assert processing["claim_token"] is None
    assert processing["pipeline_signature"] == (
        None if entrypoint == "mark_done" else signature
    )
    payload = _payload(track["id"], pipeline)
    assert payload["state"] == "done"
    if entrypoint != "mark_done":
        assert payload["shadow_value"] == (
            123.0 if pipeline == "analysis" else [123.0] * 20
        )


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
@pytest.mark.parametrize("replace_source", [True, False])
def test_source_is_rechecked_after_waiting_for_the_real_track_row_lock(
    pg_db, tmp_path, monkeypatch, pipeline, replace_source
):
    from crate.analysis_daemon import _source_unchanged
    from crate.db.jobs import analysis_storage
    from crate.db.tx import transaction_scope

    track, claim, signature = _claimed(pg_db, tmp_path, pipeline)
    assert _source_unchanged(claim, f"{pipeline}_state") is True
    pids = Queue()

    @contextmanager
    def observed_storage_transaction():
        with transaction_scope() as session:
            session.execute(text("SET LOCAL lock_timeout = '10s'"))
            pids.put(session.execute(text("SELECT pg_backend_pid()")).scalar_one())
            yield session

    monkeypatch.setattr(
        analysis_storage, "transaction_scope", observed_storage_transaction
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction_scope() as writer:
            writer.execute(
                text("SELECT id FROM library_tracks WHERE id=:id FOR UPDATE"),
                {"id": track["id"]},
            )
            writer_pid = writer.execute(text("SELECT pg_backend_pid()")).scalar_one()
            future = pool.submit(_persist, track, claim, signature, pipeline, "batch")
            _assert_backend_waits_for(future, pids.get(timeout=5), writer_pid)
            if replace_source:
                _change_source(Path(track["path"]), "replaced")
            writer.execute(
                text(
                    "UPDATE library_tracks SET size=:size, updated_at=clock_timestamp() "
                    "WHERE id=:id"
                ),
                {"size": Path(track["path"]).stat().st_size, "id": track["id"]},
            )
        future.result(timeout=10)

    if replace_source:
        _assert_rejected(track, pipeline)
    else:
        assert _processing(track["id"], pipeline)["state"] == "done"
        assert _processing(track["id"], pipeline)["pipeline_signature"] == signature
        assert _payload(track["id"], pipeline)["shadow_value"] is not None


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
@pytest.mark.parametrize("cleanup", ["failed", "release"])
def test_source_change_does_not_prevent_claim_cleanup(
    pg_db, tmp_path, pipeline, cleanup
):
    from crate.db.jobs.analysis_claims import release_claims
    from crate.db.jobs.analysis_storage import mark_failed

    track, claim, _signature = _claimed(pg_db, tmp_path, pipeline)
    Path(track["path"]).unlink()
    if cleanup == "failed":
        mark_failed(track["id"], f"{pipeline}_state", "DSP failed", claim=claim)
    else:
        assert (
            release_claims(
                [track["id"]], f"{pipeline}_state", claims={track["id"]: claim}
            )
            == 1
        )

    processing = _processing(track["id"], pipeline)
    assert processing["state"] == ("failed" if cleanup == "failed" else "pending")
    assert processing["claim_token"] is None
    assert _payload(track["id"], pipeline)["shadow_value"] is None


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
def test_batch_preserves_valid_neighbors_when_one_source_changes(
    pg_db, tmp_path, pipeline
):
    from crate.db.jobs import analysis_storage as storage

    changed, changed_claim, changed_signature = _claimed(
        pg_db, tmp_path, pipeline, "changed"
    )
    valid, valid_claim, valid_signature = _claimed(pg_db, tmp_path, pipeline, "valid")
    _change_source(Path(changed["path"]), "replaced")
    claims = {changed["id"]: changed_claim, valid["id"]: valid_claim}
    signatures = {changed["id"]: changed_signature, valid["id"]: valid_signature}
    if pipeline == "analysis":
        storage.store_analysis_results(
            [(t["id"], t["path"], {"bpm": 99.0}) for t in (changed, valid)],
            claims=claims,
            signatures=signatures,
        )
    else:
        storage.store_bliss_vectors(
            {t["id"]: [99.0] * 20 for t in (changed, valid)},
            claims=claims,
            signatures=signatures,
        )

    _assert_rejected(changed, pipeline)
    processing = _processing(valid["id"], pipeline)
    assert processing["state"] == "done"
    assert processing["claim_token"] is None
    assert processing["pipeline_signature"] == valid_signature
    assert _payload(valid["id"], pipeline)["shadow_value"] == (
        99.0 if pipeline == "analysis" else [99.0] * 20
    )
