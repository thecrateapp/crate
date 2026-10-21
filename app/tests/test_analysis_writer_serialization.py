"""DSP lifecycle operations serialize with library writers without lock cycles."""

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
    _payload,
    _requeue,
    _seed_track,
    _store,
)
from tests.test_agent_library_operations import _assert_backend_waits_for


def _sync_removal(pg_db, tmp_path, pipeline):
    from crate.analysis_provenance import source_identity
    from crate.db.jobs.analysis_claims import claim_tracks
    from crate.db.queries.agent_sync import read_sync_state, sync_state_version

    track = _seed_track(pg_db, "sync-dsp-delete", library_path=str(tmp_path))
    path = Path(track["path"])
    path.parent.mkdir(parents=True)
    path.write_bytes(b"original audio")
    album = _album_for(track)
    kept_path = path.with_name("kept.flac")
    kept_path.write_bytes(b"kept audio")
    pg_db.upsert_track(
        {
            "album_id": album["id"],
            "artist": album["artist"],
            "album": "Album",
            "filename": kept_path.name,
            "title": "Kept",
            "path": str(kept_path),
            "duration": 180.0,
            "format": "flac",
        }
    )
    _requeue(track["id"], pipeline)
    claim = next(
        row
        for row in claim_tracks(f"{pipeline}_state", limit=2)
        if row["id"] == track["id"]
    )
    assert claim["generation"] > 0
    claim["_source"] = source_identity(str(path))
    state = read_sync_state(album["entity_uid"])
    prepared = _frozen_scan(path.parent, album["artist"])
    kept = next(row for row in state["tracks"] if row["path"] == str(kept_path))
    prepared["track_payloads"] = [kept]
    prepared["album_payload"]["total_size"] = kept_path.stat().st_size
    path.unlink()
    return track, claim, kept, album, prepared, sync_state_version(state)


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
@pytest.mark.parametrize(
    "operation", ["store", "refresh", "legacy_refresh", "reset", "release", "fail"]
)
def test_sync_removal_serializes_with_pipeline_lifecycle(
    pg_db, tmp_path, monkeypatch, pipeline, operation
):
    from crate.db.jobs import analysis_claims, analysis_popularity, analysis_storage
    from crate.db.jobs.agent_analysis import requeue_analysis_targets
    from crate.db.queries.agent_analysis import (
        analysis_targets_version,
        read_analysis_targets,
    )
    from crate.db.repositories import agent_sync
    from crate.db.tx import read_scope, transaction_scope

    track, claim, kept, album, prepared, version = _sync_removal(
        pg_db, tmp_path, pipeline
    )
    expected = analysis_targets_version(
        read_analysis_targets([track["entity_uid"]], [pipeline])
    )
    sync_locked, resume_sync = Event(), Event()
    writer_pids, pipeline_pids = Queue(), Queue()
    original_read = agent_sync.read_sync_state

    def observe_locked_sync(*args, **kwargs):
        result = original_read(*args, **kwargs)
        if kwargs.get("locked"):
            sync_locked.set()
            assert resume_sync.wait(10), "Test did not release the sync writer"
        return result

    @contextmanager
    def pipeline_transaction():
        with transaction_scope() as current:
            current.execute(text("SET LOCAL statement_timeout='15s'"))
            pipeline_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            yield current

    for module in (analysis_claims, analysis_popularity, analysis_storage):
        monkeypatch.setattr(module, "transaction_scope", pipeline_transaction)
    monkeypatch.setattr(agent_sync, "read_sync_state", observe_locked_sync)

    def sync_album():
        with transaction_scope() as current:
            current.execute(text("SET LOCAL statement_timeout='15s'"))
            writer_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            return agent_sync.apply_sync_album(
                album["entity_uid"],
                expected_version=version,
                prepared=prepared,
                validate_source=lambda: True,
                session=current,
            )

    def pipeline_effect():
        if operation == "store":
            return _store(track, pipeline, claim=claim, signature="removed-source")
        if operation == "fail":
            return analysis_storage.mark_failed(
                track["id"], f"{pipeline}_state", "DSP failed", claim=claim
            )
        if operation == "release":
            return analysis_claims.release_claims(
                [track["id"]], f"{pipeline}_state", claims={track["id"]: claim}
            )
        if operation == "reset":
            return analysis_claims.reset_stale_claims(f"{pipeline}_state")
        if operation == "legacy_refresh":
            return analysis_popularity.requeue_tracks(
                f"{pipeline}_state='pending'",
                track_id=track["id"],
                pipelines=[pipeline],
            )
        with pipeline_transaction() as current:
            return requeue_analysis_targets(
                [track["entity_uid"]],
                [pipeline],
                expected_version=expected,
                mode="refresh",
                session=current,
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        writer = pool.submit(sync_album)
        try:
            assert sync_locked.wait(5), "Sync never acquired its real track locks"
            pending = pool.submit(pipeline_effect)
            _assert_backend_waits_for(
                pending, pipeline_pids.get(timeout=5), writer_pids.get(timeout=5)
            )
        finally:
            resume_sync.set()
        synced = writer.result(timeout=12)
        result = pending.result(timeout=12)

    assert synced["status"] == "applied" and synced["removed_tracks"] == 1
    if operation == "refresh":
        assert result == {
            "status": "conflict",
            "code": "SOURCE_CHANGED",
            "references": [],
        }
    elif operation in {"release", "legacy_refresh"}:
        assert result == 0
    with read_scope() as current:
        for table in (
            "library_tracks",
            "track_processing_state",
            "track_analysis_features",
            "track_bliss_embeddings",
        ):
            column = "id" if table == "library_tracks" else "track_id"
            assert (
                current.execute(
                    text(f"SELECT 1 FROM {table} WHERE {column}=:id"),
                    {"id": track["id"]},
                ).first()
                is None
            )
        remaining = current.execute(
            text("SELECT entity_uid::text FROM library_tracks WHERE id=:id"),
            {"id": kept["id"]},
        ).scalar_one()
    assert remaining == kept["entity_uid"]
    assert _payload(kept["id"], pipeline)["shadow_value"] is None


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
def test_claim_skips_tracks_locked_by_a_library_writer(pg_db, tmp_path, pipeline):
    from crate.db.jobs.analysis_claims import claim_tracks, release_claims
    from crate.db.tx import transaction_scope

    track, claim, _kept, _album, _prepared, _version = _sync_removal(
        pg_db, tmp_path, pipeline
    )
    assert (
        release_claims([track["id"]], f"{pipeline}_state", claims={track["id"]: claim})
        == 1
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction_scope() as writer:
            writer.execute(text("SELECT id FROM library_tracks ORDER BY id FOR UPDATE"))
            pending = pool.submit(claim_tracks, f"{pipeline}_state", limit=2)
            assert pending.result(timeout=5) == []
    claimed = claim_tracks(f"{pipeline}_state", limit=2)
    assert [row["id"] for row in claimed] == [track["id"]]
    assert claimed[0]["generation"] == claim["generation"]
    assert claimed[0]["claim_token"] != claim["claim_token"]


@pytest.mark.parametrize(
    ("pipeline", "newer_pipeline"),
    [("analysis", "analysis"), ("bliss", "bliss"), ("bliss", "analysis")],
)
def test_claim_rechecks_pending_and_analysis_exclusion_after_track_lock(
    pg_db, tmp_path, monkeypatch, pipeline, newer_pipeline
):
    from crate.db.jobs import analysis_claims
    from crate.db.tx import transaction_scope

    track, claim, _kept, _album, _prepared, _version = _sync_removal(
        pg_db, tmp_path, pipeline
    )
    assert (
        analysis_claims.release_claims(
            [track["id"]], f"{pipeline}_state", claims={track["id"]: claim}
        )
        == 1
    )
    if newer_pipeline != pipeline:
        prepared = analysis_claims.claim_tracks(f"{newer_pipeline}_state", limit=2)
        newer_claim = next(row for row in prepared if row["id"] == track["id"])
        assert (
            analysis_claims.release_claims(
                [track["id"]],
                f"{newer_pipeline}_state",
                claims={track["id"]: newer_claim},
            )
            == 1
        )
    original_sql = analysis_claims.claim_batch_sql
    original_transaction = analysis_claims.transaction_scope
    backend_pids = Queue()
    gate_next_statement = True

    def gated_sql(column):
        nonlocal gate_next_statement
        statement = original_sql(column)
        if not gate_next_statement:
            return statement
        gate_next_statement = False
        # Fix the statement snapshot before another claimer commits. The gate
        # blocks before LockRows, without replacing real claim/lock behaviour.
        return statement.replace(
            "WITH batch AS (",
            "WITH gate AS MATERIALIZED (SELECT pg_advisory_xact_lock(904292)), batch AS (",
            1,
        ).replace(
            "JOIN library_tracks lt ON lt.id = ps.track_id",
            "JOIN library_tracks lt ON lt.id = ps.track_id CROSS JOIN gate",
            1,
        )

    @contextmanager
    def observed_transaction():
        with original_transaction() as current:
            current.execute(text("SET LOCAL statement_timeout='15s'"))
            backend_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            yield current

    monkeypatch.setattr(analysis_claims, "claim_batch_sql", gated_sql)
    monkeypatch.setattr(analysis_claims, "transaction_scope", observed_transaction)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction_scope() as gate:
            gate.execute(text("SELECT pg_advisory_xact_lock(904292)"))
            gate_pid = gate.execute(text("SELECT pg_backend_pid()")).scalar_one()
            pending = pool.submit(
                analysis_claims.claim_tracks, f"{pipeline}_state", limit=2
            )
            _assert_backend_waits_for(pending, backend_pids.get(timeout=5), gate_pid)
            newer = analysis_claims.claim_tracks(f"{newer_pipeline}_state", limit=2)
            assert [row["id"] for row in newer] == [track["id"]]
        assert pending.result(timeout=12) == []

    assert (
        analysis_claims.release_claims(
            [track["id"]],
            f"{newer_pipeline}_state",
            claims={track["id"]: newer[0]},
        )
        == 1
    )
