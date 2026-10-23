"""Real approved adapters, delayed handlers and pipeline claim/write composition."""

import os
from pathlib import Path
from uuid import uuid4

import pytest
from crate import (
    agent_library_operations as operations,
)
from crate import (
    operator_provenance as provenance,
)
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_telegram
from crate.db.repositories.agent_task_control import check_task_authority
from crate.db.repositories.tasks_updates import start_task

from tests import test_agent_acquisition as acquisition_fixtures
from tests.agent_command_fixtures import change, scalar
from tests.agent_plan_support import decide
from tests.test_agent_acquisition import (
    _execute,
    _preview,
    _publication,
)
from tests.test_agent_analysis_sync import _processing, _seed_track, _store
from tests.test_operator_provenance import drift, evidence

from tests.test_agent_telegram import button, show_all
from tests.test_task_control_actor import actor_world as actor_world  # noqa: PLC0414

acquisition_world = acquisition_fixtures.world

pytest_plugins = ["tests.agent_command_fixtures", "tests.test_agent_admin"]


def configure(world, human, tmp_path, monkeypatch):
    root = tmp_path / "proof"
    root.mkdir()
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "test-instance")
    monkeypatch.setenv("CRATE_OPERATOR_PRINCIPAL_IDS", world["principal"].id)
    monkeypatch.setattr(provenance, "ROOT", root)
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", check_task_authority)
    evidence(root)
    change(
        "UPDATE agent_principals SET require_approval=TRUE WHERE id=:id",
        {"id": world["principal"].id},
    )
    binding = agent_telegram.bind_human(human, world["principal"].id, 123)
    return {**world, "human": human, "evidence": root, "binding": binding}


@pytest.fixture
def operator(command_world, human_actor, tmp_path, monkeypatch):
    return configure(command_world, human_actor, tmp_path, monkeypatch)


@pytest.fixture
def acquisition_operator(acquisition_world, human_actor, tmp_path, monkeypatch):
    return configure(acquisition_world, human_actor, tmp_path, monkeypatch)


def prepare(world, operation, parameters):
    job = operations.prepare_operation(
        world["principal"], operation, parameters, str(uuid4())
    )["data"]
    assert start_task(job["job_id"])
    result = operations.execute_operation_job(job["job_id"], world["config"])
    assert result["execution"]["status"] == "prepared", result
    return result["plan"]


def admit(world, plan, *, native=False):
    if native:
        confirmation, message = show_all({**world, "plan": plan})
        return button(confirmation["confirmation_id"], message, "approve")["job"]
    decide(world["human"], plan)
    return operations.apply_operation(
        world["principal"],
        plan["operation"],
        plan["plan_id"],
        plan["plan_version"],
        str(uuid4()),
    )["data"]


def run(world, job):
    assert start_task(job["job_id"])
    return operations.execute_operation_job(job["job_id"], world["config"])


def mutate(world, mode):
    if mode == "execution_disabled":
        os.environ["CRATE_MCP_ACTIONS_ENABLED"] = "false"
    elif mode == "refresh":
        evidence(world["evidence"])
    elif mode == "binding":
        change("UPDATE agent_telegram_bindings SET revoked_at=NOW()")
    elif mode == "credential":
        change(
            "UPDATE agent_credentials SET revoked_at=NOW() WHERE id=:id",
            {"id": world["principal"].credential_id},
        )
    elif mode == "disabled":
        change(
            "UPDATE users SET status='disabled' WHERE id=:id",
            {"id": world["human"]["id"]},
        )
    elif mode == "role":
        from crate.db.repositories.auth_user_roles import set_user_roles

        set_user_roles(world["human"]["id"], ["user"])
    else:
        drift(world["evidence"], mode)


@pytest.mark.parametrize("mode", ["identity", "stale", "refresh"])
def test_actual_publication_rechecks_inside_copy_and_never_replays(
    acquisition_operator, monkeypatch, mode
):
    from crate import agent_acquisition_publish as publication

    world = acquisition_operator
    transfer, result = _execute(world, world["human"], _preview(world)["plan"])
    assert result["verification"]["status"] == "passed", result
    publication_result = _publication(world, transfer["job_id"])
    assert "plan" in publication_result, publication_result
    plan = publication_result["plan"]
    job = admit(world, plan)
    original = publication.os.fsync

    def during_copy(fd):
        original(fd)
        mutate(world, mode)

    monkeypatch.setattr(publication.os, "fsync", during_copy)
    result = run(world, job)
    assert result["execution"]["status"] == (
        "completed" if mode == "refresh" else "partial"
    ), result
    assert scalar("SELECT count(*) FROM library_albums") == (
        1 if mode == "refresh" else 0
    )
    assert operations.execute_operation_job(job["job_id"], world["config"]) == result
    assert world["state"]["posts"] == 1
    assert not list(Path(world["config"]["library_path"]).rglob(".crate-acquisition-*"))


@pytest.mark.parametrize("mode", ["identity", "stale", "refresh"])
def test_actual_quality_scan_cannot_publish_after_nested_drift(
    operator, monkeypatch, mode
):
    from crate.worker_handlers import quality

    original = quality.quality_report

    def scan(*args, **kwargs):
        result = original(*args, **kwargs)
        mutate(operator, mode)
        return result

    monkeypatch.setattr(quality, "quality_report", scan)
    plan = prepare(operator, "quality_check", {"scope": "global"})
    result = run(operator, admit(operator, plan))
    assert result["execution"]["status"] == (
        "completed" if mode == "refresh" else "partial"
    ), result
    if mode != "refresh":
        assert result["execution"]["error_code"] == "EVIDENCE_STALE"
        assert (
            scalar(
                "SELECT count(*) FROM ui_snapshots WHERE scope='analytics:quality' AND invalidated_at IS NULL"
            )
            == 0
        )


@pytest.mark.parametrize("native", [False, True])
@pytest.mark.parametrize("stage", ["admission", "effect"])
@pytest.mark.parametrize("mode", ["disabled", "role", "refresh", "session"])
def test_current_approving_account_on_both_channels(
    operator, monkeypatch, native, stage, mode
):
    plan = prepare(operator, "quality_check", {"scope": "global"})
    if native:
        confirmation, message = show_all({**operator, "plan": plan})
        # The native button admits atomically. For effect tests, admit before drift.
        job = (
            button(confirmation["confirmation_id"], message, "approve")["job"]
            if stage == "effect"
            else None
        )
    else:
        decide(operator["human"], plan)
        job = (
            operations.apply_operation(
                operator["principal"],
                plan["operation"],
                plan["plan_id"],
                plan["plan_version"],
                "apply-before-drift",
            )["data"]
            if stage == "effect"
            else None
        )
    if mode == "session":
        change(
            "UPDATE sessions SET revoked_at=NOW() WHERE id=:id",
            {"id": operator["human"]["session_id"]},
        )
    else:
        mutate(operator, mode)
    if stage == "admission":

        def apply():
            if native:
                return button(confirmation["confirmation_id"], message, "approve")[
                    "job"
                ]
            return operations.apply_operation(
                operator["principal"],
                plan["operation"],
                plan["plan_id"],
                plan["plan_version"],
                "apply-after-drift",
            )["data"]

        if mode in {"disabled", "role"}:
            with pytest.raises(DiagnosticError):
                apply()
            return
        job = apply()
    result = run(operator, job)
    assert result["execution"]["status"] == (
        "failed" if mode in {"disabled", "role"} else "completed"
    ), result


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
@pytest.mark.parametrize("stage", ["claim", "write"])
@pytest.mark.parametrize(
    "mode",
    ["identity", "stale", "credential", "binding", "execution_disabled", "refresh"],
)
def test_real_generation_claim_and_write_retains_completed_parent(
    operator, pg_db, pipeline, stage, mode
):
    from crate.db.jobs.analysis_claims import claim_track

    track = _seed_track(pg_db, "bound", library_path=operator["config"]["library_path"])
    path = Path(track["path"])
    path.parent.mkdir(parents=True)
    path.write_bytes(b"local-audio")
    if pipeline == "bliss":
        change(
            "UPDATE track_processing_state SET state='done' WHERE track_id=:id AND pipeline='analysis'",
            {"id": track["id"]},
        )
        change(
            "UPDATE library_tracks SET analysis_state='done' WHERE id=:id",
            {"id": track["id"]},
        )
    plan = prepare(
        operator,
        "analysis",
        {
            "track_uids": [track["entity_uid"]],
            "pipelines": [pipeline],
            "mode": "refresh",
        },
    )
    job = admit(operator, plan, native=True)
    result = run(operator, job)
    assert result["execution"]["status"] == "requeued", result
    proof = _processing(track["id"], pipeline)["operator_authority"]
    assert proof["parent"]["job_id"] == job["job_id"]
    if stage == "claim":
        mutate(operator, mode)
    claim = claim_track(pipeline + "_state")
    if stage == "claim" and mode != "refresh":
        assert claim is None
    else:
        assert claim["id"] == track["id"]
        if stage == "write":
            mutate(operator, mode)
        _store(track, pipeline, claim=claim)
    row = _processing(track["id"], pipeline)
    assert row["state"] == ("done" if mode == "refresh" else "failed"), row
    if mode != "refresh":
        assert row["operator_authority"]["denied"]
        # Ordinary maintenance must not launder denied proof into independent work.
        evidence(operator["evidence"])
        from crate.db.jobs.analysis_popularity import requeue_tracks

        assert (
            requeue_tracks(
                f"{pipeline}_state='pending'",
                track_id=track["id"],
                pipelines=[pipeline],
            )
            == 1
        )
        assert claim_track(pipeline + "_state") is None
        assert _processing(track["id"], pipeline)["state"] == "failed"


@pytest.mark.parametrize("mode", ["identity", "binding", "refresh"])
@pytest.mark.parametrize("stage", ["claim", "scan"])
@pytest.mark.parametrize("origin", ["schedule", "retry"])
def test_actual_delayed_analytics_checks_parent_at_claim_and_persistence(
    operator, actor_world, monkeypatch, mode, stage, origin
):
    from crate import analytics, resource_governor
    from crate.db.queries.tasks import get_task
    from crate.db.repositories import runtime_policy
    from crate.db.repositories.agent_task_control import principal_context
    from crate.db.repositories.tasks import create_task

    actors, _handlers, _events = actor_world
    monkeypatch.setattr("crate.config.load_config", lambda: operator["config"])
    policy = runtime_policy.read_runtime_policy_state()
    monkeypatch.setattr(
        resource_governor,
        "should_defer_task",
        lambda *_: resource_governor.ResourceDecision(
            allowed=True,
            policy_revision=policy["configured_revision"],
            policy_hash=policy["policy_hash"],
        ),
    )
    if origin == "schedule":
        plan = prepare(operator, "schedule_run", {"schedule": "compute_analytics"})
    else:
        target = create_task(
            "compute_analytics",
            {},
            origin="agent",
            agent_context=principal_context(operator["principal"]),
            required_grants=["ops.schedules.run"],
            dispatch=False,
        )
        change("UPDATE tasks SET status='failed' WHERE id=:id", {"id": target})
        plan = prepare(operator, "job_retry", {"job_id": target, "scope": "own"})
    parent = admit(operator, plan, native=True)
    result = run(operator, parent)
    assert result["execution"]["status"] == "completed", result
    child = result["execution"]["items"][0]["task_id"]
    assert (
        get_task(child)["origin_context"]["parent_authority"]["job_id"]
        == parent["job_id"]
    )
    assert get_task(child)["max_retries"] == 0
    real_compute = analytics.compute_analytics
    scanned = []

    def scan(*args, **kwargs):
        value = real_compute(*args, **kwargs)
        scanned.append(True)
        if stage == "scan":
            mutate(operator, mode)
        return value

    monkeypatch.setattr(analytics, "compute_analytics", scan)
    if stage == "claim":
        mutate(operator, mode)
    if stage == "scan" and mode != "refresh":
        with pytest.raises(DiagnosticError):
            actors._execute_task("compute_analytics", child)
    else:
        actors._execute_task("compute_analytics", child)
    row = get_task(child)
    assert row["status"] == ("completed" if mode == "refresh" else "failed"), row
    assert bool(scanned) == (stage == "scan" or mode == "refresh")
    before = list(scanned)
    actors._execute_task("compute_analytics", child)
    assert scanned == before
    if mode != "refresh":
        assert scalar("SELECT count(*) FROM cache WHERE key='analytics'") == 0


@pytest.mark.parametrize("publish", [False, True])
@pytest.mark.parametrize("running", [False, True])
def test_native_acquisition_cancel_reaches_real_running_effect(
    acquisition_operator, monkeypatch, publish, running
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from crate import agent_acquisition as acquisition
    from crate import agent_acquisition_publish as publication
    from crate.db.queries.tasks import get_task

    world = acquisition_operator
    plan = _preview(world)["plan"]
    if publish:
        transfer, result = _execute(world, world["human"], plan)
        publication_result = _publication(world, transfer["job_id"])
        assert "plan" in publication_result, publication_result
        plan = publication_result["plan"]
    job = admit(world, plan)
    entered, release = Event(), Event()
    real_fsync = publication.os.fsync
    real_batch = acquisition._batch_state

    def pause_copy(fd):
        real_fsync(fd)
        entered.set()
        assert release.wait(15), "Cancel was blocked by the active copy proof"

    def pause_transfer(execution):
        entered.set()
        assert release.wait(15), "Cancel was blocked by the active transfer proof"
        return real_batch(execution)

    if publish:
        monkeypatch.setattr(publication.os, "fsync", pause_copy)
    else:
        world["state"]["pending"] = True
        monkeypatch.setattr(acquisition, "_batch_state", pause_transfer)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(run, world, job) if running else None
        try:
            if running:
                assert entered.wait(10)
            cancel_plan = prepare(
                world, "job_cancel", {"job_id": job["job_id"], "scope": "own"}
            )
            control = admit(world, cancel_plan, native=True)
            result = run(world, control)
            assert result["execution"]["status"] == "completed", result
            assert get_task(job["job_id"])["cancellation_requested_at"] is not None
        finally:
            release.set()
        if future:
            outcome = future.result(timeout=10)
            assert outcome["execution"]["status"] == "partial", outcome
            if not publish:
                assert outcome["execution"]["remote_transfers_may_continue"] is True
            assert (
                operations.execute_operation_job(job["job_id"], world["config"])
                == outcome
            )
        else:
            assert get_task(job["job_id"])["status"] == "cancelled"
            assert start_task(job["job_id"]) is None
    assert scalar("SELECT count(*) FROM library_albums") == 0


def test_acquisition_cancel_denies_other_integration_and_legacy_soulseek(
    acquisition_operator,
):
    from crate.db.repositories.agent_task_control import inspect_control
    from crate.db.repositories.tasks import create_task

    from tests.agent_command_fixtures import other_principal

    world = acquisition_operator
    job = admit(world, _preview(world)["plan"])
    with pytest.raises(DiagnosticError):
        inspect_control(
            other_principal(), "job_cancel", {"job_id": job["job_id"], "scope": "own"}
        )
    legacy = create_task("soulseek_download", {}, origin="admin", dispatch=False)
    with pytest.raises(DiagnosticError):
        inspect_control(
            world["principal"], "job_cancel", {"job_id": legacy, "scope": "instance"}
        )
    with pytest.raises(DiagnosticError):
        inspect_control(
            world["principal"], "job_retry", {"job_id": job["job_id"], "scope": "own"}
        )


@pytest.mark.parametrize("stage", ["claim", "write"])
@pytest.mark.parametrize("mode", ["identity", "binding", "source", "refresh"])
def test_real_sync_binds_new_generations_and_exact_artwork_descendant(
    acquisition_operator, pg_db, actor_world, monkeypatch, stage, mode, tmp_path
):
    from crate import artwork_materializer, artwork_variants
    from crate.db.jobs.analysis_claims import claim_track
    from crate.db.queries.tasks import get_task
    from PIL import Image

    world = acquisition_operator
    album_dir = Path(world["config"]["library_path"]) / "echo" / "New"
    album_dir.mkdir()
    (album_dir / "One.flac").write_bytes(world["sample"].read_bytes())
    cover = album_dir / "cover.jpg"
    Image.new("RGB", (120, 120), "blue").save(cover)
    album_id = pg_db.upsert_album(
        {"artist": "Echo", "name": "New", "path": str(album_dir), "track_count": 0}
    )
    uid = scalar(
        "SELECT entity_uid::text FROM library_albums WHERE id=:id", {"id": album_id}
    )
    plan = prepare(world, "library_sync", {"scope": "album", "entity_uid": uid})
    parent = admit(world, plan, native=True)
    outcome = run(world, parent)
    assert outcome["execution"]["status"] == "completed", outcome
    track_id = scalar(
        "SELECT id FROM library_tracks WHERE album_id=:id", {"id": album_id}
    )
    for pipeline in ["analysis", "bliss"]:
        assert (
            _processing(track_id, pipeline)["operator_authority"]["parent"]["job_id"]
            == parent["job_id"]
        )
    child = scalar("SELECT id FROM tasks WHERE type='materialize_artwork_variants'")
    row = get_task(child)
    assert row["origin_context"]["parent_authority"]["job_id"] == parent["job_id"]
    assert row["params"]["source"]["source"]["path"] == str(cover)
    assert row["max_retries"] == 0
    monkeypatch.setattr(
        artwork_variants, "cache_root", lambda: tmp_path / "artwork-cache"
    )
    actors, _, _ = actor_world

    def change_evidence():
        if mode == "source":
            Image.new("RGB", (121, 121), "red").save(cover)
        else:
            mutate(world, mode)

    original = artwork_materializer._write_webp_variant

    def render(*args):
        result = original(*args)
        change_evidence()
        return result

    if stage == "claim":
        change_evidence()
    else:
        monkeypatch.setattr(artwork_materializer, "_write_webp_variant", render)
    if (stage == "write" and mode in {"identity", "binding"}) or (
        stage == "claim" and mode == "source"
    ):
        with pytest.raises((DiagnosticError, ValueError)):
            actors._execute_task("materialize_artwork_variants", child)
    else:
        actors._execute_task("materialize_artwork_variants", child)
    # Content already frozen in memory remains the exact reviewed source if the
    # physical file changes after decoding; no current-source retargeting occurs.
    succeeded = mode == "refresh" or (stage == "write" and mode == "source")
    assert get_task(child)["status"] == ("completed" if succeeded else "failed")
    assert (
        bool(
            artwork_variants.load_current_manifest(
                artwork_variants.ArtworkAsset("album-cover", uid)
            )
        )
        == succeeded
    )
    if mode in {"identity", "binding"}:
        assert claim_track("analysis_state") is None
        assert _processing(track_id, "analysis")["state"] == "failed"


def test_generation_migration_uses_identical_additive_bootstrap_ddl(monkeypatch):
    import importlib

    from crate.db.schema_sections.operator_generations_v134 import (
        create_operator_generations_v134_schema,
    )

    class Recorder:
        def __init__(self):
            self.sql = []

        def execute(self, sql):
            self.sql.append(sql)

    bootstrap, migration = Recorder(), Recorder()
    create_operator_generations_v134_schema(bootstrap)
    module = importlib.import_module(
        "crate.db.migrations.versions.134_operator_generation_authority"
    )
    monkeypatch.setattr(module, "op", migration)
    module.upgrade()
    assert bootstrap.sql == migration.sql
    assert "ADD COLUMN IF NOT EXISTS operator_authority JSONB" in migration.sql[0]
    module.downgrade()
    assert "DROP COLUMN IF EXISTS operator_authority" in migration.sql[-1]


@pytest.mark.parametrize("stage", ["claim", "write"])
@pytest.mark.parametrize("mode", ["binding", "refresh"])
@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
def test_acquisition_inserted_generations_retain_publication_authority(
    acquisition_operator, stage, mode, pipeline
):
    from crate.db.jobs.analysis_claims import claim_track

    world = acquisition_operator
    transfer, _ = _execute(world, world["human"], _preview(world)["plan"])
    publication_result = _publication(world, transfer["job_id"])
    assert "plan" in publication_result, publication_result
    plan = publication_result["plan"]
    parent = admit(world, plan, native=True)
    result = run(world, parent)
    assert result["execution"]["status"] == "completed", result
    track_id = scalar("SELECT id FROM library_tracks")
    path = scalar("SELECT path FROM library_tracks")
    assert (
        _processing(track_id, pipeline)["operator_authority"]["parent"]["job_id"]
        == parent["job_id"]
    )
    _store({"id": track_id, "path": path}, pipeline, claim=None)
    assert _processing(track_id, pipeline)["state"] == "pending"
    if pipeline == "bliss":
        change("UPDATE library_tracks SET analysis_state='done'")
        change(
            "UPDATE track_processing_state SET state='done' WHERE pipeline='analysis'"
        )
    if stage == "claim":
        mutate(world, mode)
    claim = claim_track(pipeline + "_state")
    if stage == "claim" and mode != "refresh":
        assert claim is None
    else:
        assert claim is not None
        if stage == "write":
            mutate(world, mode)
        _store({"id": track_id, "path": path}, pipeline, claim=claim)
    assert _processing(track_id, pipeline)["state"] == (
        "done" if mode == "refresh" else "failed"
    )


def test_preupgrade_operator_raw_tasks_cannot_execute_without_parent(operator):
    from crate.db.repositories.agent_task_control import principal_context
    from crate.db.repositories.tasks import create_task

    task = create_task(
        "compute_analytics",
        {},
        origin="agent",
        agent_context=principal_context(operator["principal"]),
        required_grants=["ops.schedules.run"],
        dispatch=False,
    )
    with pytest.raises(DiagnosticError, match="retained parent"):
        check_task_authority(task)


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
@pytest.mark.parametrize("state", ["analyzing", "done"])
@pytest.mark.parametrize("withdrawal", ["expired", "binding", "source"])
@pytest.mark.parametrize("entrypoint", ["result", "release"])
def test_incompatible_claim_cannot_deny_newer_operator_generation(
    operator, pg_db, pipeline, state, withdrawal, entrypoint
):
    from crate.db.jobs.analysis_claims import claim_track, release_claims

    from tests.test_agent_analysis_sync import _payload

    track = _seed_track(pg_db, "late", library_path=operator["config"]["library_path"])
    path = Path(track["path"])
    path.parent.mkdir(parents=True)
    path.write_bytes(b"unchanged physical source")
    if pipeline == "bliss":
        change(
            "UPDATE track_processing_state SET state='done' WHERE pipeline='analysis'"
        )
        change("UPDATE library_tracks SET analysis_state='done'")

    def enqueue(*, native):
        plan = prepare(
            operator,
            "analysis",
            {
                "track_uids": [track["entity_uid"]],
                "pipelines": [pipeline],
                "mode": "refresh",
            },
        )
        assert (
            run(operator, admit(operator, plan, native=native))["execution"]["status"]
            == "requeued"
        )
        claim = claim_track(pipeline + "_state")
        assert claim is not None
        return plan, claim

    _, old = enqueue(native=False)
    plan, current = enqueue(native=True)
    assert old["generation"] == 1 and current["generation"] == 2
    if state == "done":
        _store(track, pipeline, claim=current, value=222.0, signature="generation-two")
    assert _processing(track["id"], pipeline)["state"] == state
    if withdrawal == "expired":
        change(
            "UPDATE agent_repair_plans SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:id",
            {"id": plan["plan_id"]},
        )
    elif withdrawal == "source":
        path.write_bytes(b"replaced physical source")
    else:
        mutate(operator, "binding")

    def snapshot():
        return {
            "processing": _processing(track["id"], pipeline),
            "result": _payload(track["id"], pipeline),
            "events": scalar(
                "SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY event_uid),'[]'::jsonb) FROM domain_event_outbox e WHERE scope=:scope AND subject_key=:id",
                {"scope": "pipeline:" + pipeline, "id": str(track["id"])},
            ),
        }

    before = snapshot()
    incompatible = [
        old,
        {**current, "claim_token": str(uuid4())},
        {**current, "path": str(path) + ".other"},
        None,
    ]
    if state == "done":
        incompatible.append(current)  # Already completed delivery is also obsolete.
    for claim in incompatible:
        if entrypoint == "result":
            _store(track, pipeline, claim=claim, value=111.0, signature="late-result")
        else:
            assert (
                release_claims(
                    [track["id"]],
                    pipeline + "_state",
                    claims={track["id"]: claim} if claim is not None else None,
                )
                == 0
            )
        # Includes state, claim token, generation, full proof, timestamps/signature,
        # library/shadow result and durable pipeline events, after transaction commit.
        assert snapshot() == before
    if state == "analyzing":
        # The matching current claim must still invalidate expired/revoked work.
        if entrypoint == "result":
            _store(track, pipeline, claim=current)
        else:
            assert (
                release_claims(
                    [track["id"]], pipeline + "_state", claims={track["id"]: current}
                )
                == 0
            )
        after = snapshot()
        assert after["processing"]["state"] == "failed"
        assert after["processing"]["claim_token"] is None
        assert after["processing"]["operator_authority"]["denied"] is True
        assert after["result"]["shadow_value"] is None
        assert len(after["events"]) == len(before["events"]) + 1


@pytest.mark.parametrize("pipeline", ["analysis", "bliss"])
def test_unbound_legacy_generation_zero_result_remains_supported(pg_db, pipeline):
    from tests.test_agent_analysis_sync import _payload

    track = _seed_track(pg_db, "legacy-zero")
    before = _processing(track["id"], pipeline)
    assert before["generation"] == 0 and before["operator_authority"] is None
    _store(track, pipeline, claim=None, value=111.0)
    assert _processing(track["id"], pipeline)["state"] == "done"
    assert _payload(track["id"], pipeline)["shadow_value"] == (
        111.0 if pipeline == "analysis" else [111.0] * 20
    )
