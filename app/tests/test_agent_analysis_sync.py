"""Contracts for exact analysis generations and bounded library sync."""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from queue import Queue
from time import monotonic, sleep
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


def _seed_track(
    pg_db, suffix: str, *, library_path: str = "/music", album_directory: str = "Album"
) -> dict:
    from crate.db.tx import transaction_scope

    artist = f"MCP Analysis {suffix}"
    album_path = f"{library_path}/{artist}/{album_directory}"
    pg_db.upsert_artist({"name": artist})
    album_id = pg_db.upsert_album(
        {"artist": artist, "name": "Album", "path": album_path, "track_count": 1}
    )
    path = f"{album_path}/track.flac"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": "Album",
            "filename": "track.flac",
            "title": "Track",
            "path": path,
            "duration": 180.0,
            "format": "flac",
        }
    )
    with transaction_scope() as session:
        return dict(
            session.execute(
                text(
                    "SELECT id, path, entity_uid::text FROM library_tracks WHERE path=:path"
                ),
                {"path": path},
            )
            .mappings()
            .one()
        )


def _processing(track_id: int, pipeline: str) -> dict:
    from crate.db.tx import read_scope

    with read_scope() as session:
        return dict(
            session.execute(
                text(
                    "SELECT * FROM track_processing_state "
                    "WHERE track_id=:id AND pipeline=:pipeline"
                ),
                {"id": track_id, "pipeline": pipeline},
            )
            .mappings()
            .one()
        )


def _payload(track_id: int, pipeline: str) -> dict:
    from crate.db.tx import read_scope

    with read_scope() as session:
        if pipeline == "analysis":
            row = (
                session.execute(
                    text(
                        "SELECT t.bpm, t.analysis_state AS state, f.bpm AS shadow_value "
                        "FROM library_tracks t LEFT JOIN track_analysis_features f ON f.track_id=t.id "
                        "WHERE t.id=:id"
                    ),
                    {"id": track_id},
                )
                .mappings()
                .one()
            )
        else:
            row = (
                session.execute(
                    text(
                        "SELECT t.bliss_vector AS vector, t.bliss_state AS state, "
                        "e.bliss_vector AS shadow_value FROM library_tracks t "
                        "LEFT JOIN track_bliss_embeddings e ON e.track_id=t.id WHERE t.id=:id"
                    ),
                    {"id": track_id},
                )
                .mappings()
                .one()
            )
        return dict(row)


def _store(
    track: dict,
    pipeline: str,
    *,
    claim: dict | None,
    value: float = 123.0,
    signature: str | None = None,
) -> None:
    from crate.db.jobs import analysis_storage

    if pipeline == "analysis":
        analysis_storage.store_analysis_result(
            track["id"],
            track["path"],
            {"bpm": value, "energy": 0.75},
            claim=claim,
            signature=signature,
        )
    else:
        analysis_storage.store_bliss_vector(
            track["id"],
            [value] * 20,
            claim=claim,
            signature=signature,
        )


def _requeue(track_id: int, pipeline: str) -> None:
    from crate.db.jobs.analysis_popularity import requeue_tracks

    assert (
        requeue_tracks(
            f"{pipeline}_state = 'pending'", track_id=track_id, pipelines=[pipeline]
        )
        == 1
    )


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
class TestAnalysisGenerationFences:
    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_result_from_before_reset_cannot_write_payload_or_complete_generation(
        self, pg_db, pipeline
    ):
        from crate.db.jobs.analysis_claims import claim_track

        track = _seed_track(pg_db, f"reset-{pipeline}")
        old_claim = claim_track(f"{pipeline}_state")
        assert old_claim is not None

        _requeue(track["id"], pipeline)
        reset = _processing(track["id"], pipeline)
        assert reset["generation"] == old_claim["generation"] + 1
        assert reset["claim_token"] is None

        _store(track, pipeline, claim=old_claim, signature="stale-signature")

        assert _processing(track["id"], pipeline)["state"] == "pending"
        assert _processing(track["id"], pipeline)["pipeline_signature"] is None
        assert _payload(track["id"], pipeline)["shadow_value"] is None
        assert _payload(track["id"], pipeline)["state"] == "pending"

    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_old_claim_cannot_fail_a_new_generation(self, pg_db, pipeline):
        from crate.db.jobs.analysis_claims import claim_track
        from crate.db.jobs.analysis_storage import mark_failed

        track = _seed_track(pg_db, f"failure-{pipeline}")
        old_claim = claim_track(f"{pipeline}_state")
        assert old_claim is not None
        _requeue(track["id"], pipeline)

        mark_failed(track["id"], f"{pipeline}_state", "old DSP failed", claim=old_claim)

        processing = _processing(track["id"], pipeline)
        assert processing["state"] == "pending"
        assert processing["last_error"] is None
        assert _payload(track["id"], pipeline)["state"] == "pending"

    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_reclaimed_token_rejects_previous_worker_without_generation_change(
        self, pg_db, pipeline
    ):
        from crate.db.jobs.analysis_claims import claim_track, release_claims

        track = _seed_track(pg_db, f"reclaim-{pipeline}")
        old_claim = claim_track(f"{pipeline}_state")
        assert old_claim is not None
        assert (
            release_claims(
                [track["id"]], f"{pipeline}_state", claims={track["id"]: old_claim}
            )
            == 1
        )
        current_claim = claim_track(f"{pipeline}_state")
        assert current_claim is not None
        assert current_claim["generation"] == old_claim["generation"]
        assert current_claim["claim_token"] != old_claim["claim_token"]

        _store(track, pipeline, claim=old_claim)
        assert _payload(track["id"], pipeline)["shadow_value"] is None
        assert _processing(track["id"], pipeline)["state"] == "analyzing"

        _store(
            track,
            pipeline,
            claim=current_claim,
            value=98.5,
            signature="current-signature",
        )
        processing = _processing(track["id"], pipeline)
        assert processing["state"] == "done"
        assert processing["claim_token"] is None
        assert processing["pipeline_signature"] == "current-signature"
        assert _payload(track["id"], pipeline)["shadow_value"] == (
            98.5 if pipeline == "analysis" else [98.5] * 20
        )

    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_legacy_result_without_claim_cannot_complete_managed_generation(
        self, pg_db, pipeline
    ):
        track = _seed_track(pg_db, f"legacy-{pipeline}")
        _requeue(track["id"], pipeline)

        _store(track, pipeline, claim=None)

        assert _processing(track["id"], pipeline)["generation"] == 1
        assert _processing(track["id"], pipeline)["state"] == "pending"
        assert _payload(track["id"], pipeline)["shadow_value"] is None

    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_old_release_does_not_release_a_replacement_claim(self, pg_db, pipeline):
        from crate.db.jobs.analysis_claims import claim_track, release_claims

        track = _seed_track(pg_db, f"release-{pipeline}")
        old_claim = claim_track(f"{pipeline}_state")
        assert old_claim is not None
        _requeue(track["id"], pipeline)
        current_claim = claim_track(f"{pipeline}_state")
        assert current_claim is not None

        assert (
            release_claims(
                [track["id"]], f"{pipeline}_state", claims={track["id"]: old_claim}
            )
            == 0
        )

        processing = _processing(track["id"], pipeline)
        assert processing["state"] == "analyzing"
        assert processing["claim_token"] == current_claim["claim_token"]

    def test_mixed_analysis_batch_only_persists_current_claim_and_its_signature(
        self, pg_db
    ):
        from crate.db.jobs.analysis_claims import claim_tracks
        from crate.db.jobs.analysis_storage import store_analysis_results

        stale = _seed_track(pg_db, "mixed-stale")
        valid = _seed_track(pg_db, "mixed-valid")
        claims = {row["id"]: row for row in claim_tracks("analysis_state", limit=2)}
        assert set(claims) == {stale["id"], valid["id"]}
        _requeue(stale["id"], "analysis")

        store_analysis_results(
            [
                (stale["id"], stale["path"], {"bpm": 33.0}),
                (valid["id"], valid["path"], {"bpm": 144.0}),
            ],
            claims=claims,
            signatures={stale["id"]: "old", valid["id"]: "new"},
        )

        assert _payload(stale["id"], "analysis")["shadow_value"] is None
        assert _processing(stale["id"], "analysis")["pipeline_signature"] is None
        assert _payload(valid["id"], "analysis")["shadow_value"] == 144.0
        assert _processing(valid["id"], "analysis")["pipeline_signature"] == "new"

    def test_forged_claim_with_correct_generation_and_different_token_is_rejected(
        self, pg_db
    ):
        from crate.db.jobs.analysis_claims import claim_track

        track = _seed_track(pg_db, "forged-token")
        claim = claim_track("analysis_state")
        assert claim is not None

        _store(track, "analysis", claim={**claim, "claim_token": uuid4()})

        assert _payload(track["id"], "analysis")["shadow_value"] is None
        assert _processing(track["id"], "analysis")["state"] == "analyzing"

    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_old_completion_cannot_complete_requeued_generation(self, pg_db, pipeline):
        from crate.db.jobs.analysis_claims import claim_track
        from crate.db.jobs.analysis_storage import mark_done

        track = _seed_track(pg_db, f"done-{pipeline}")
        old_claim = claim_track(f"{pipeline}_state")
        assert old_claim is not None
        _requeue(track["id"], pipeline)

        mark_done(track["id"], f"{pipeline}_state", claim=old_claim)

        assert _processing(track["id"], pipeline)["state"] == "pending"
        assert _payload(track["id"], pipeline)["state"] == "pending"

    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_startup_reset_invalidates_claim_without_accepting_old_result(
        self, pg_db, pipeline
    ):
        from crate.db.jobs.analysis_claims import claim_track, reset_stale_claims

        track = _seed_track(pg_db, f"startup-{pipeline}")
        old_claim = claim_track(f"{pipeline}_state")
        assert old_claim is not None
        assert reset_stale_claims(f"{pipeline}_state") == 1

        _store(track, pipeline, claim=old_claim)

        assert _processing(track["id"], pipeline)["claim_token"] is None
        assert _payload(track["id"], pipeline)["shadow_value"] is None

    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_result_waiting_for_reset_transaction_cannot_write_new_generation(
        self, pg_db, monkeypatch, pipeline
    ):
        from crate.db.jobs import analysis_generations
        from crate.db.jobs.agent_analysis import requeue_analysis_targets
        from crate.db.jobs.analysis_claims import claim_track
        from crate.db.queries.agent_analysis import (
            analysis_targets_version,
            read_analysis_targets,
        )
        from crate.db.tx import read_scope, transaction_scope

        track = _seed_track(pg_db, f"concurrent-reset-{pipeline}")
        old_claim = claim_track(f"{pipeline}_state")
        assert old_claim is not None
        state = read_analysis_targets([track["entity_uid"]], [pipeline])
        worker_pids: Queue[int] = Queue()
        real_lock_processing_rows = analysis_generations.lock_processing_rows

        def record_worker_connection(current, track_ids, pipelines):
            current.execute(text("SET LOCAL lock_timeout = '10s'"))
            worker_pids.put(
                current.execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            return real_lock_processing_rows(current, track_ids, pipelines)

        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction_scope() as session:
                reset = requeue_analysis_targets(
                    [track["entity_uid"]],
                    [pipeline],
                    expected_version=analysis_targets_version(state),
                    mode="refresh",
                    session=session,
                )
                assert reset["status"] == "requeued"
                reset_pid = session.execute(
                    text("SELECT pg_backend_pid()")
                ).scalar_one()
                monkeypatch.setattr(
                    analysis_generations,
                    "lock_processing_rows",
                    record_worker_connection,
                )
                completion = pool.submit(
                    _store, track, pipeline, claim=old_claim, signature="old-result"
                )
                worker_pid = worker_pids.get(timeout=8)
                deadline = monotonic() + 8
                while True:
                    # Each observation gets a fresh statistics snapshot. The PID
                    # and blocker prove the real fence query is waiting for this
                    # reset transaction, rather than merely a slow worker start.
                    with read_scope() as observer:
                        blocked = observer.execute(
                            text(
                                "SELECT state='active' AND wait_event_type='Lock' "
                                "AND :reset_pid=ANY(pg_blocking_pids(pid)) "
                                "AND query LIKE '%FROM track_processing_state%FOR UPDATE%' "
                                "FROM pg_stat_activity WHERE pid=:worker_pid"
                            ),
                            {"reset_pid": reset_pid, "worker_pid": worker_pid},
                        ).scalar_one_or_none()
                    if blocked:
                        break
                    if completion.done():
                        completion.result()
                        pytest.fail(
                            "Worker completed without waiting for the reset fence"
                        )
                    assert monotonic() < deadline, (
                        "Worker never waited on the reset transaction's processing-row lock"
                    )
                    sleep(0.01)
            completion.result(timeout=5)

        assert _processing(track["id"], pipeline)["generation"] == 1
        assert _processing(track["id"], pipeline)["state"] == "pending"
        assert _payload(track["id"], pipeline)["shadow_value"] is None

    @pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
    def test_path_changed_without_reset_rejects_old_claim(self, pg_db, pipeline):
        from crate.db.jobs.analysis_claims import claim_track
        from crate.db.tx import transaction_scope

        track = _seed_track(pg_db, f"renamed-{pipeline}")
        claim = claim_track(f"{pipeline}_state")
        assert claim is not None
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET path=:path WHERE id=:id"),
                {"id": track["id"], "path": track["path"] + ".renamed"},
            )

        _store(track, pipeline, claim=claim)

        assert _payload(track["id"], pipeline)["shadow_value"] is None
        assert _processing(track["id"], pipeline)["state"] == "analyzing"

    def test_partial_claim_map_cannot_fall_back_to_legacy_write_for_missing_entry(
        self, pg_db
    ):
        from crate.db.jobs.analysis_claims import claim_tracks, release_claims
        from crate.db.jobs.analysis_storage import store_analysis_results

        claimed_track = _seed_track(pg_db, "map-included")
        missing_track = _seed_track(pg_db, "map-missing")
        claims = {row["id"]: row for row in claim_tracks("analysis_state", limit=2)}
        assert (
            release_claims([missing_track["id"]], "analysis_state", claims=claims) == 1
        )

        store_analysis_results(
            [
                (claimed_track["id"], claimed_track["path"], {"bpm": 120.0}),
                (missing_track["id"], missing_track["path"], {"bpm": 90.0}),
            ],
            claims={claimed_track["id"]: claims[claimed_track["id"]]},
        )

        assert _payload(claimed_track["id"], "analysis")["shadow_value"] == 120.0
        assert _payload(missing_track["id"], "analysis")["shadow_value"] is None
        assert _processing(missing_track["id"], "analysis")["state"] == "pending"


class _StopDaemon(BaseException):
    pass


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
@pytest.mark.parametrize("source_changed", [False, True])
def test_daemon_fences_results_with_claim_source_and_actual_signature(
    monkeypatch, pipeline, source_changed
):
    import crate.analysis_daemon as daemon

    claim = {
        "id": 17,
        "path": "/music/Artist/Album/track.flac",
        "title": "Track",
        "generation": 4,
        "claim_token": uuid4(),
    }
    stored = []
    failed = []
    identities = iter([{"size": 10}, {"size": 11 if source_changed else 10}])
    monkeypatch.setattr(daemon, "source_identity", lambda _path: next(identities))
    monkeypatch.setattr(daemon, "_reset_stale_claims", lambda _state: None)
    monkeypatch.setattr(daemon, "_get_pending_count", lambda _state: 1)
    monkeypatch.setattr(daemon, "_claim_tracks", lambda _state, limit: [claim])
    monkeypatch.setattr(daemon, "_should_pause_for_load", lambda: False)
    monkeypatch.setattr(
        daemon,
        "_mark_failed",
        lambda track_id, state, **kwargs: failed.append((track_id, state, kwargs)),
    )
    monkeypatch.setattr(
        daemon,
        "result_signature",
        lambda name, source, components: json.dumps(
            {"pipeline": name, "source": source, "components": components}
        ),
    )
    monkeypatch.setattr(
        daemon,
        "time",
        SimpleNamespace(sleep=lambda _seconds: (_ for _ in ()).throw(_StopDaemon())),
    )
    if pipeline == "analysis":
        result = {"bpm": 122.0, "_components": ["librosa"]}
        monkeypatch.setitem(
            sys.modules,
            "crate.audio_analysis",
            SimpleNamespace(
                analyze_batch=lambda _paths: [result],
                analyze_track=lambda _path: result,
            ),
        )
        monkeypatch.setattr(
            daemon,
            "_store_analysis_results",
            lambda rows, **kwargs: stored.append((rows, kwargs)),
        )
        run = daemon.analysis_daemon
    else:
        monkeypatch.setitem(
            sys.modules,
            "crate.bliss",
            SimpleNamespace(
                is_available=lambda: True,
                analyze_directory=lambda _path: {claim["path"]: [0.1] * 20},
                analyze_file=lambda _path: [0.1] * 20,
            ),
        )
        monkeypatch.setattr(
            daemon,
            "_store_bliss_vectors",
            lambda rows, **kwargs: stored.append((rows, kwargs)),
        )
        run = daemon.bliss_daemon

    with pytest.raises(_StopDaemon):
        run({})

    if source_changed:
        assert not any(rows for rows, _kwargs in stored)
        assert failed == [(17, f"{pipeline}_state", {"claim": claim})]
    else:
        assert len(stored) == 1
        assert stored[0][1]["claims"] == {17: claim}
        signature = json.loads(stored[0][1]["signatures"][17])
        assert signature == {
            "pipeline": pipeline,
            "source": {"size": 10},
            "components": ["librosa"] if pipeline == "analysis" else ["crate-cli"],
        }
        assert failed == []


def test_analysis_source_identity_changes_with_file_and_rejects_symlink(tmp_path):
    from crate.analysis_provenance import source_identity

    track = tmp_path / "track.flac"
    track.write_bytes(b"first")
    before = source_identity(str(track))
    track.write_bytes(b"second-longer")
    assert source_identity(str(track)) != before
    linked = tmp_path / "link.flac"
    linked.symlink_to(track)
    with pytest.raises(ValueError, match="symbolic"):
        source_identity(str(linked))


def test_analysis_signature_keeps_unavailable_evidence_explicit(monkeypatch):
    import importlib.metadata

    import crate.analysis_provenance as provenance
    import crate.crate_cli as crate_cli

    def unavailable(package):
        raise importlib.metadata.PackageNotFoundError(package)

    monkeypatch.setattr(importlib.metadata, "version", unavailable)
    monkeypatch.setattr(crate_cli, "find_binary", lambda: None)

    signature = json.loads(
        provenance.result_signature("analysis", {"size": 10}, ["librosa", "librosa"])
    )

    assert signature["components_invoked"] == ["librosa"]
    assert signature["binary_sha256"] is None
    assert signature["model_sha256"] is None
    assert set(signature["packages"].values()) == {None}
    assert len(signature["implementation_sha256"]) == 64
    assert signature["source_version"] == provenance.source_version({"size": 10})


def _authorize(effect=None):
    return effect() if effect is not None else None


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
class TestExactAnalysisOperations:
    def _prepare(self, pg_db, tmp_path, *, suffix="exact", mode="pending"):
        from crate.agent_analysis import compile_operation

        track = _seed_track(pg_db, suffix, library_path=str(tmp_path))
        path = Path(track["path"])
        path.parent.mkdir(parents=True)
        path.write_bytes(b"audio-source")
        config = {"library_path": str(tmp_path)}
        plan = compile_operation(
            "analysis",
            {
                "track_uids": [track["entity_uid"]],
                "pipelines": ["analysis"],
                "mode": mode,
            },
            config,
        )
        return track, config, plan

    def test_approved_requeue_is_pending_until_current_daemon_result_is_verified(
        self, pg_db, tmp_path
    ):
        from crate.agent_analysis import apply_operation, get_analysis_status
        from crate.analysis_provenance import result_signature, source_identity
        from crate.db.jobs.analysis_claims import claim_track

        track, config, plan = self._prepare(pg_db, tmp_path)
        unselected = _seed_track(pg_db, "unselected")
        assert plan["document"]["targets"] == [
            {"entity_type": "track", "entity_uid": track["entity_uid"]}
        ]
        assert plan["document"]["impact"]["completion"] == "asynchronous_daemon_results"

        applied = apply_operation(
            "analysis",
            plan["execution"],
            config,
            task_id="analysis-job",
            authorize=_authorize,
        )

        assert applied["execution"]["status"] == "requeued"
        assert applied["verification"]["status"] == "pending"
        references = applied["verification"]["references"]
        assert plan["execution"]["references"] == references
        assert references[0]["generation"] == 1
        assert _processing(unselected["id"], "analysis")["generation"] == 0
        status = get_analysis_status(references=references)
        assert status["status"] == "pending"
        assert status["verification"]["status"] == "pending"

        claims = []
        for _ in range(2):
            claimed = claim_track("analysis_state")
            assert claimed is not None
            claims.append(claimed)
        current = next(claim for claim in claims if claim["id"] == track["id"])
        signature = result_signature(
            "analysis", source_identity(track["path"]), ["librosa"]
        )
        _store(track, "analysis", claim=current, signature=signature)

        status = get_analysis_status(references=references)
        assert status["status"] == "completed"
        assert status["verification"]["status"] == "passed"
        assert status["items"][0]["version_evidence"] == "recorded"
        assert status["items"][0]["analysis_version"] == json.loads(signature)

    def test_file_changed_after_plan_does_not_requeue(self, pg_db, tmp_path):
        from crate.agent_analysis import apply_operation

        track, config, plan = self._prepare(pg_db, tmp_path)
        Path(track["path"]).write_bytes(b"replaced-audio-source")

        result = apply_operation(
            "analysis",
            plan["execution"],
            config,
            task_id="analysis-job",
            authorize=_authorize,
        )

        assert result["execution"] == {"status": "conflict", "code": "SOURCE_CHANGED"}
        assert _processing(track["id"], "analysis")["generation"] == 0

    def test_state_changed_after_plan_does_not_reset_active_claim(
        self, pg_db, tmp_path
    ):
        from crate.agent_analysis import apply_operation
        from crate.db.jobs.analysis_claims import claim_track

        track, config, plan = self._prepare(pg_db, tmp_path)
        claimed = claim_track("analysis_state")
        assert claimed is not None

        result = apply_operation(
            "analysis",
            plan["execution"],
            config,
            task_id="analysis-job",
            authorize=_authorize,
        )

        assert result["execution"]["status"] == "conflict"
        processing = _processing(track["id"], "analysis")
        assert processing["generation"] == 0
        assert processing["claim_token"] == claimed["claim_token"]
        assert processing["state"] == "analyzing"

    def test_authorization_failure_prevents_requeue(self, pg_db, tmp_path):
        from crate.agent_analysis import apply_operation

        track, config, plan = self._prepare(pg_db, tmp_path)

        def denied(effect=None):
            raise PermissionError("Grant revoked")

        with pytest.raises(PermissionError, match="revoked"):
            apply_operation(
                "analysis",
                plan["execution"],
                config,
                task_id="analysis-job",
                authorize=denied,
            )

        assert _processing(track["id"], "analysis")["generation"] == 0

    def test_reference_is_superseded_by_later_reset(self, pg_db, tmp_path):
        from crate.agent_analysis import apply_operation, get_analysis_status

        track, config, plan = self._prepare(pg_db, tmp_path)
        result = apply_operation(
            "analysis",
            plan["execution"],
            config,
            task_id="analysis-job",
            authorize=_authorize,
        )
        _requeue(track["id"], "analysis")

        status = get_analysis_status(references=result["verification"]["references"])

        assert status["status"] == "failed"
        assert status["items"][0]["status"] == "superseded"
        assert status["verification"]["status"] == "failed"

    @pytest.mark.parametrize(
        "signature",
        [
            None,
            "not-json",
            '{"implementation_sha256":"hash","source_version":"different"}',
        ],
    )
    def test_done_requires_recorded_version_and_matching_approved_source(
        self, pg_db, tmp_path, signature
    ):
        from crate.agent_analysis import apply_operation, get_analysis_status
        from crate.db.jobs.analysis_claims import claim_track

        track, config, plan = self._prepare(pg_db, tmp_path)
        result = apply_operation(
            "analysis",
            plan["execution"],
            config,
            task_id="analysis-job",
            authorize=_authorize,
        )
        claim = claim_track("analysis_state")
        assert claim is not None
        _store(track, "analysis", claim=claim, signature=signature)

        status = get_analysis_status(references=result["verification"]["references"])

        assert status["status"] == "failed"
        assert status["items"][0]["status"] == "verification_failed"

    def test_pending_mode_preserves_completed_results(self, pg_db, tmp_path):
        from crate.agent_analysis import apply_operation, compile_operation

        track, config, _plan = self._prepare(pg_db, tmp_path)
        _store(track, "analysis", claim=None, value=112.0)
        plan = compile_operation(
            "analysis",
            {"track_uids": [track["entity_uid"]], "pipelines": ["analysis"]},
            config,
        )
        assert plan["document"]["changes"] == []

        result = apply_operation(
            "analysis",
            plan["execution"],
            config,
            task_id="analysis-job",
            authorize=_authorize,
        )

        assert result["execution"]["status"] == "skipped"
        assert result["verification"]["status"] == "passed"
        assert _payload(track["id"], "analysis")["shadow_value"] == 112.0
        assert _processing(track["id"], "analysis")["generation"] == 0

    def test_deleted_track_is_terminal_not_found_for_accepted_generation(
        self, pg_db, tmp_path
    ):
        from crate.agent_analysis import apply_operation, get_analysis_status
        from crate.db.tx import transaction_scope

        track, config, plan = self._prepare(pg_db, tmp_path)
        result = apply_operation(
            "analysis",
            plan["execution"],
            config,
            task_id="analysis-job",
            authorize=_authorize,
        )
        with transaction_scope() as session:
            session.execute(
                text("DELETE FROM library_tracks WHERE id=:id"), {"id": track["id"]}
            )

        status = get_analysis_status(references=result["verification"]["references"])

        assert status["status"] == "failed"
        assert status["counts"] == {"not_found": 1}
        assert status["items"][0]["track_uid"] == track["entity_uid"]
        assert status["items"][0]["status"] == "not_found"


@pytest.mark.parametrize(
    "uids,pipelines",
    [
        ([], ["analysis"]),
        ([str(uuid4())] * 2, ["analysis"]),
        ([str(uuid4()) for _ in range(201)], ["analysis"]),
        ([str(uuid4())], []),
        ([str(uuid4())], ["shell"]),
        ([str(uuid4())], ["analysis", "analysis"]),
    ],
)
def test_analysis_read_rejects_unbounded_or_unsupported_targets_before_database(
    uids, pipelines, monkeypatch
):
    import crate.db.queries.agent_analysis as queries

    monkeypatch.setattr(
        queries, "read_scope", lambda: pytest.fail("invalid request reached database")
    )

    with pytest.raises(ValueError):
        queries.read_analysis_targets(uids, pipelines)


@pytest.mark.parametrize(
    "parameters",
    [
        {"track_uids": [], "provider": "arbitrary"},
        {"track_uids": [], "pipelines": "analysis"},
        {"track_uids": [], "mode": "all"},
    ],
)
def test_analysis_compile_rejects_unknown_parameters(parameters):
    from crate.agent_analysis import compile_operation

    with pytest.raises(ValueError):
        compile_operation("analysis", parameters, {})


def _album_for(track: dict) -> dict:
    from crate.db.tx import read_scope

    with read_scope() as session:
        return dict(
            session.execute(
                text(
                    "SELECT a.id,a.entity_uid::text,a.artist,a.path,r.entity_uid::text AS artist_uid FROM library_albums a JOIN library_tracks t ON t.album_id=a.id JOIN library_artists r ON r.name=a.artist WHERE t.id=:id"
                ),
                {"id": track["id"]},
            )
            .mappings()
            .one()
        )


def _frozen_scan(
    directory: Path, artist: str, *, extra_tracks: list[dict] | None = None
) -> dict:
    tracks = [
        {
            "artist": artist,
            "album": "Album",
            "filename": "track.flac",
            "title": "Updated Title",
            "path": str(directory / "track.flac"),
            "track_number": 1,
            "disc_number": 1,
            "format": "flac",
            "duration": 180.0,
            "size": (directory / "track.flac").stat().st_size,
            "bitrate": None,
            "sample_rate": None,
            "bit_depth": None,
            "year": None,
            "genre": None,
            "albumartist": None,
        },
        *(extra_tracks or []),
    ]
    return {
        "artist_payload": {"name": artist},
        "album_payload": {
            "name": "Album",
            "path": str(directory),
            "track_count": len(tracks),
            "total_size": sum(t["size"] for t in tracks),
            "total_duration": sum(t["duration"] for t in tracks),
            "formats": ["flac"],
            "has_cover": 0,
        },
        "track_payloads": tracks,
        "has_cover": False,
    }


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
class TestExactSyncOperations:
    def _prepare(self, pg_db, tmp_path, monkeypatch, *, suffix="sync"):
        from crate.agent_sync import compile_operation
        from crate.library_sync import LibrarySync

        track = _seed_track(pg_db, suffix, library_path=str(tmp_path))
        path = Path(track["path"])
        path.parent.mkdir(parents=True)
        path.write_bytes(b"audio-source")
        album = _album_for(track)
        monkeypatch.setattr(
            LibrarySync,
            "prepare_album_sync",
            lambda _self, directory, artist: _frozen_scan(directory, artist),
        )
        config = {"library_path": str(tmp_path), "audio_extensions": [".flac"]}
        plan = compile_operation(
            "library_sync",
            {"scope": "album", "entity_uid": album["entity_uid"]},
            config,
        )
        return track, album, config, plan

    def test_album_sync_preserves_identity_and_does_not_widen_scope(
        self, pg_db, tmp_path, monkeypatch
    ):
        from crate.agent_sync import apply_operation
        from crate.db.queries.agent_sync import read_sync_state
        from crate.library_sync import LibrarySync

        track, album, config, plan = self._prepare(pg_db, tmp_path, monkeypatch)
        outside = _seed_track(pg_db, "outside-sync")
        outside_before = read_sync_state(_album_for(outside)["entity_uid"])
        before = read_sync_state(album["entity_uid"])
        assert before["tracks"][0]["title"] == "Track"
        assert plan["document"]["impact"]["albums"] == 1
        assert plan["document"]["impact"]["indexed_albums_only"] is True
        assert plan["document"]["impact"]["enrichment"] is False
        assert plan["document"]["impact"]["refreshes_artist_summary"] is True
        monkeypatch.setattr(
            LibrarySync,
            "sync_artist_dirs",
            lambda *_args, **_kwargs: pytest.fail(
                "album plan widened to artist resync"
            ),
        )

        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-job",
            authorize=_authorize,
        )

        assert result["execution"]["status"] == "completed"
        assert result["verification"]["status"] == "passed"
        after = read_sync_state(album["entity_uid"])
        assert after["album"]["id"] == album["id"]
        assert after["tracks"][0]["id"] == track["id"]
        assert after["tracks"][0]["entity_uid"] == track["entity_uid"]
        assert after["tracks"][0]["title"] == "Updated Title"
        assert read_sync_state(_album_for(outside)["entity_uid"]) == outside_before

    @pytest.mark.parametrize("entity_type", ["track", "album"])
    def test_field_lock_created_after_plan_conflicts_before_index_changes(
        self, pg_db, tmp_path, monkeypatch, entity_type
    ):
        from crate.agent_sync import apply_operation
        from crate.db.queries.agent_sync import read_sync_state
        from crate.db.repositories.field_locks import lock_fields

        track, album, config, plan = self._prepare(pg_db, tmp_path, monkeypatch)
        lock_fields(
            entity_type=entity_type,
            entity_id=track["id"] if entity_type == "track" else album["id"],
            field_names=["title" if entity_type == "track" else "genre"],
            source="portable_import",
        )
        before = read_sync_state(album["entity_uid"])

        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-new-lock",
            authorize=_authorize,
        )

        assert result["execution"]["status"] == "conflict"
        assert result["execution"]["items"][0]["code"] == "SOURCE_CHANGED"
        assert read_sync_state(album["entity_uid"]) == before

    @pytest.mark.parametrize("source", ["manual_edit", "portable_import"])
    def test_sync_preserves_locked_track_and_album_metadata_from_manual_or_portable_edits(
        self, pg_db, tmp_path, monkeypatch, source
    ):
        from crate.agent_sync import apply_operation, compile_operation
        from crate.db.queries.agent_sync import read_sync_state
        from crate.db.repositories.field_locks import lock_fields
        from crate.db.tx import transaction_scope
        from crate.library_sync import LibrarySync

        track, album, config, _initial_plan = self._prepare(
            pg_db, tmp_path, monkeypatch
        )
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_tracks SET title='Protected title',year='1997',track_number=7 WHERE id=:id"
                ),
                {"id": track["id"]},
            )
            session.execute(
                text(
                    "UPDATE library_albums SET genre='Protected genre',year='1996',tag_album='Protected album' WHERE id=:id"
                ),
                {"id": album["id"]},
            )
            lock_fields(
                entity_type="track",
                entity_id=track["id"],
                field_names=["title", "date", "tracknumber"],
                source=source,
                session=session,
            )
            lock_fields(
                entity_type="album",
                entity_id=album["id"],
                field_names=["genre", "date", "album"],
                source=source,
                session=session,
            )

        def fresh_scan(_self, directory, artist):
            prepared = _frozen_scan(directory, artist)
            prepared["album_payload"].update(
                genre="Filesystem genre", year="2024", tag_album="Filesystem album"
            )
            prepared["track_payloads"][0].update(
                title="Filesystem title", year="2024", track_number=1
            )
            return prepared

        monkeypatch.setattr(LibrarySync, "prepare_album_sync", fresh_scan)
        before = read_sync_state(album["entity_uid"])
        plan = compile_operation(
            "library_sync", {"entity_uid": album["entity_uid"]}, config
        )
        prepared = plan["execution"]["albums"][0]["prepared"]
        assert prepared["track_payloads"][0]["title"] == "Protected title"
        assert prepared["track_payloads"][0]["year"] == "1997"
        assert prepared["track_payloads"][0]["track_number"] == 7
        assert prepared["album_payload"]["genre"] == "Protected genre"
        assert prepared["album_payload"]["year"] == "1996"
        assert prepared["album_payload"]["tag_album"] == "Protected album"
        assert plan["document"]["impact"]["preserves_field_locks"] is True

        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-locked-metadata",
            authorize=_authorize,
        )

        assert result["execution"]["status"] == "completed"
        assert result["verification"]["status"] == "passed"
        after = read_sync_state(album["entity_uid"])
        assert after["tracks"][0]["title"] == "Protected title"
        assert after["tracks"][0]["year"] == "1997"
        assert after["tracks"][0]["track_number"] == 7
        assert after["album"]["genre"] == "Protected genre"
        assert after["album"]["year"] == "1996"
        assert after["album"]["tag_album"] == "Protected album"
        assert after["locks"] == before["locks"]

    def test_new_file_after_preview_conflicts_before_index_write(
        self, pg_db, tmp_path, monkeypatch
    ):
        from crate.agent_sync import apply_operation
        from crate.db.queries.agent_sync import read_sync_state

        track, album, config, plan = self._prepare(pg_db, tmp_path, monkeypatch)
        before = read_sync_state(album["entity_uid"])
        Path(track["path"]).with_name("new-track.flac").write_bytes(b"new-audio")

        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-job",
            authorize=_authorize,
        )

        assert result["execution"]["status"] == "conflict"
        assert read_sync_state(album["entity_uid"]) == before

    def test_changed_database_after_preview_is_not_overwritten(
        self, pg_db, tmp_path, monkeypatch
    ):
        from crate.agent_sync import apply_operation
        from crate.db.queries.agent_sync import read_sync_state
        from crate.db.tx import transaction_scope

        track, album, config, plan = self._prepare(pg_db, tmp_path, monkeypatch)
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET title='Concurrent edit' WHERE id=:id"),
                {"id": track["id"]},
            )

        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-job",
            authorize=_authorize,
        )

        assert result["execution"]["status"] == "conflict"
        assert (
            read_sync_state(album["entity_uid"])["tracks"][0]["title"]
            == "Concurrent edit"
        )

    def test_empty_scan_preserves_album_and_existing_tracks(
        self, pg_db, tmp_path, monkeypatch
    ):
        from crate.agent_sync import apply_operation, compile_operation
        from crate.db.queries.agent_sync import read_sync_state
        from crate.library_sync import LibrarySync

        track, album, config, _plan = self._prepare(pg_db, tmp_path, monkeypatch)
        Path(track["path"]).unlink()
        monkeypatch.setattr(
            LibrarySync,
            "prepare_album_sync",
            lambda *_args: {"skipped": "empty_audio_scan"},
        )
        before = read_sync_state(album["entity_uid"])
        plan = compile_operation(
            "library_sync", {"entity_uid": album["entity_uid"]}, config
        )

        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-job",
            authorize=_authorize,
        )

        assert result["execution"]["items"][0]["status"] == "skipped"
        assert read_sync_state(album["entity_uid"]) == before

    def test_missing_index_removal_is_declared_and_only_approved_album_changes(
        self, pg_db, tmp_path, monkeypatch
    ):
        from crate.agent_sync import apply_operation, compile_operation
        from crate.db.queries.agent_sync import read_sync_state

        track, album, config, _plan = self._prepare(pg_db, tmp_path, monkeypatch)
        outside = _seed_track(pg_db, "outside-removal")
        outside_before = read_sync_state(_album_for(outside)["entity_uid"])
        pg_db.upsert_track(
            {
                "album_id": album["id"],
                "artist": album["artist"],
                "album": "Album",
                "filename": "missing.flac",
                "title": "Missing",
                "path": str(Path(track["path"]).with_name("missing.flac")),
                "format": "flac",
            }
        )
        before = read_sync_state(album["entity_uid"])
        removed = next(t for t in before["tracks"] if t["title"] == "Missing")
        plan = compile_operation(
            "library_sync", {"entity_uid": album["entity_uid"]}, config
        )

        assert plan["document"]["risk"] == "destructive"
        assert plan["document"]["impact"]["removed_indexes"] == 1
        assert any(
            c["action"] == "remove_index" and c["entity_uid"] == removed["entity_uid"]
            for c in plan["document"]["changes"]
        )
        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-job",
            authorize=_authorize,
        )

        assert result["execution"]["status"] == "completed"
        assert [t["id"] for t in read_sync_state(album["entity_uid"])["tracks"]] == [
            track["id"]
        ]
        assert read_sync_state(_album_for(outside)["entity_uid"]) == outside_before

    def test_track_uid_occupied_elsewhere_conflicts_without_partial_index_write(
        self, pg_db, tmp_path, monkeypatch
    ):
        from crate.agent_sync import apply_operation, compile_operation
        from crate.db.queries.agent_sync import read_sync_state
        from crate.library_sync import LibrarySync

        track, album, config, _plan = self._prepare(pg_db, tmp_path, monkeypatch)
        outside = _seed_track(pg_db, "occupied-uid")
        new_path = Path(track["path"]).with_name("new.flac")
        new_path.write_bytes(b"new-audio")
        extra = {
            **_frozen_scan(Path(track["path"]).parent, album["artist"])[
                "track_payloads"
            ][0],
            "entity_uid": outside["entity_uid"],
            "path": str(new_path),
            "filename": new_path.name,
            "title": "New",
        }
        monkeypatch.setattr(
            LibrarySync,
            "prepare_album_sync",
            lambda _self, directory, artist: _frozen_scan(
                directory, artist, extra_tracks=[extra]
            ),
        )
        plan = compile_operation(
            "library_sync", {"entity_uid": album["entity_uid"]}, config
        )
        before = read_sync_state(album["entity_uid"])

        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-job",
            authorize=_authorize,
        )

        assert result["execution"]["items"][0]["code"] == "IDENTITY_CONFLICT"
        assert read_sync_state(album["entity_uid"]) == before

    def test_artist_scope_above_limit_rejects_whole_set_instead_of_truncating(
        self, pg_db, tmp_path, monkeypatch
    ):
        from crate.agent_sync import compile_operation

        _track, album, config, _plan = self._prepare(pg_db, tmp_path, monkeypatch)
        pg_db.upsert_album(
            {
                "artist": album["artist"],
                "name": "Other",
                "path": str(Path(album["path"]).with_name("Other")),
            }
        )

        with pytest.raises(ValueError, match="limit"):
            compile_operation(
                "library_sync",
                {"scope": "artist", "entity_uid": album["artist_uid"], "limit": 1},
                config,
            )

    def test_real_flac_parser_prepares_without_writes_and_applies_exact_existing_uid(
        self, pg_db, tmp_path, monkeypatch
    ):
        from mutagen.flac import FLAC

        from crate.agent_sync import apply_operation, compile_operation
        from crate.db.queries.agent_sync import read_sync_state
        import crate.library_sync as library_sync

        track = _seed_track(
            pg_db, "real-flac", library_path=str(tmp_path), album_directory="2024/Album"
        )
        album = _album_for(track)
        path = Path(track["path"])
        path.parent.mkdir(parents=True)
        stream_info = (
            (4096).to_bytes(2, "big") * 2
            + bytes(6)
            + ((44100 << 44) | (1 << 41) | (15 << 36) | 44100).to_bytes(8, "big")
            + bytes(16)
        )
        path.write_bytes(b"fLaC\x80\x00\x00\x22" + stream_info)
        audio = FLAC(path)
        audio["artist"] = album["artist"]
        audio["album"] = "Album"
        audio["title"] = "Fresh FLAC Title"
        audio["tracknumber"] = "1"
        audio.save()
        monkeypatch.setattr(
            library_sync, "_read_audio_info_batch_native", lambda *_args: {}
        )
        config = {"library_path": str(tmp_path), "audio_extensions": [".flac"]}
        before = read_sync_state(album["entity_uid"])

        plan = compile_operation(
            "library_sync", {"entity_uid": album["entity_uid"]}, config
        )

        assert read_sync_state(album["entity_uid"]) == before
        assert (
            plan["execution"]["albums"][0]["prepared"]["track_payloads"][0]["title"]
            == "Fresh FLAC Title"
        )
        assert (
            plan["execution"]["albums"][0]["prepared"]["artist_payload"]["folder_name"]
            == album["artist"]
        )
        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-job",
            authorize=_authorize,
        )
        assert result["execution"]["status"] == "completed"
        after = read_sync_state(album["entity_uid"])
        assert after["tracks"][0]["id"] == track["id"]
        assert after["tracks"][0]["entity_uid"] == track["entity_uid"]
        assert after["tracks"][0]["title"] == "Fresh FLAC Title"


@pytest.mark.parametrize(
    "parameters",
    [
        {"scope": "global"},
        {"scope": "album", "entity_uid": str(uuid4()), "limit": 101},
        {"scope": "global", "limit": True},
        {"scope": "arbitrary"},
        {"scope": "global", "limit": 1, "is_new_file": True},
    ],
)
def test_sync_compile_rejects_unbounded_or_extra_parameters_before_database(
    parameters, monkeypatch, tmp_path
):
    import crate.agent_sync as sync
    import crate.db.queries.agent_sync as queries

    monkeypatch.setattr(
        queries, "read_scope", lambda: pytest.fail("invalid request reached database")
    )

    with pytest.raises(ValueError):
        sync.compile_operation(
            "library_sync", parameters, {"library_path": str(tmp_path)}
        )
