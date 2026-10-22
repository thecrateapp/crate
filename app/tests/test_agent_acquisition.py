"""Strict acquisition integration: fake provider, actual plans/worker/PG/filesystem."""

import base64
import copy
import zlib
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from crate import agent_acquisition as acquisition
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_acquisition as store
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope
from crate.mcp.acquisition_schemas import AcquisitionSearch
from crate.worker_handlers.acquisition import (
    _coerce_moved_count,
    _handle_soulseek_download,
)
from mutagen.flac import FLAC
from sqlalchemy import text

from tests.agent_command_fixtures import UID, change, other_principal, scalar
from tests.agent_plan_support import decide

pytest_plugins = ["tests.agent_command_fixtures", "tests.test_agent_admin"]


@pytest.fixture
def world(command_world, monkeypatch, tmp_path):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr("crate.soulseek._api_key", lambda: "synthetic-key")
    monkeypatch.setattr("crate.soulseek._base_url", lambda: "http://127.0.0.1:5030")
    monkeypatch.setattr(acquisition.time, "sleep", lambda _: None)
    sample = tmp_path / "sample.flac"
    sample.write_bytes(zlib.decompress(base64.b64decode(SILENT_FLAC)))
    audio = FLAC(sample)
    audio["artist"] = ["Echo"]
    audio["albumartist"] = ["Echo"]
    audio["album"] = ["New"]
    audio["title"] = ["One"]
    audio["tracknumber"] = ["1"]
    audio.save()
    downloads = tmp_path.parent / (tmp_path.name + "-downloads")
    downloads.mkdir()
    command_world["config"]["downloads_path"] = str(downloads)
    state = {
        "search_id": str(uuid4()),
        "calls": [],
        "pending": False,
        "failures": [],
        "version": "0.26.1",
        "posts": 0,
    }
    state["raw"] = [
        {
            "username": "peer name",
            "files": [
                {
                    "filename": "Echo\\New\\One.flac",
                    "size": sample.stat().st_size,
                    "bitDepth": 16,
                    "sampleRate": 44100,
                }
            ],
        }
    ]

    def transport(method, endpoint, body=None):
        state["calls"].append((method, endpoint, copy.deepcopy(body)))
        if endpoint == "application":
            return {
                "version": {"current": state["version"]},
                "server": {"isConnected": True, "isLoggedIn": True},
            }
        if endpoint == "searches":
            return {"id": state["search_id"]}
        if endpoint.endswith("/responses"):
            return copy.deepcopy(state["raw"])
        if endpoint == "transfers/downloads/peer%20name":
            return {"username": "peer name", "directories": []}
        if endpoint == "transfers/downloads/batches":
            state["posts"] += 1
            state["batch"] = {
                "id": body["id"],
                "searchId": body["searchId"],
                "username": body["username"],
                "options": body["options"],
                "transfers": [
                    {
                        **file,
                        "id": str(uuid4()),
                        "batchId": body["id"],
                        "username": body["username"],
                        "bytesTransferred": file["size"],
                        "state": "Completed, Succeeded",
                    }
                    for file in body["files"]
                ],
            }
            directory = downloads / body["options"]["destination"]
            directory.mkdir(parents=True)
            (directory / "One.flac").write_bytes(sample.read_bytes())
            if state.get("uncertain"):
                raise DiagnosticError(
                    "PROVIDER_UNAVAILABLE",
                    "Synthetic timeout after external acceptance",
                )
            return {"batch": state["batch"], "failures": state["failures"]}
        if endpoint.startswith("transfers/downloads/batches/"):
            batch = copy.deepcopy(state["batch"])
            if state["pending"]:
                batch["transfers"][0]["state"] = "InProgress"
            if state.get("extra"):
                batch["transfers"].append(
                    {**batch["transfers"][0], "filename": "Extra.flac"}
                )
            return batch
        raise AssertionError((method, endpoint, body))

    monkeypatch.setattr(acquisition, "_transport", transport)
    command_world.update(state=state, sample=sample)
    return command_world


def _run(world, task_id):
    public = _handle_soulseek_download(
        task_id, {"agent_command": True}, world["config"]
    )
    assert "plan" not in public
    assert "source" not in public.get("execution", {})
    return scalar("SELECT result FROM agent_jobs WHERE task_id=:id", {"id": task_id})


def _receipt(world):
    result = acquisition.search_acquisition(
        world["principal"], provider="soulseek", query="Echo New"
    )
    return result["data"]["results"][0]["receipt_id"]


def _preview(world, receipt=None, **changes):
    params = {
        "receipt_id": receipt or _receipt(world),
        "artist_uid": UID,
        "max_items": 1,
        "max_bytes": 100000,
        "max_cost_minor": 0,
        "destination_policy": "provider_staging_only",
        **changes,
    }
    accepted = acquisition.preview_acquisition(
        world["principal"], idempotency_key=str(uuid4()), **params
    )["data"]
    assert start_task(accepted["job_id"])
    result = _run(world, accepted["job_id"])
    return result


def _execute(world, actor, plan, *, publish=False, key=None):
    decide(actor, plan)
    fn = (
        acquisition.apply_acquisition_publication
        if publish
        else acquisition.apply_acquisition
    )
    accepted = fn(
        world["principal"],
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key=key or str(uuid4()),
    )["data"]
    assert start_task(accepted["job_id"])
    result = _run(world, accepted["job_id"])
    return accepted, result


def _publication(world, source_job_id):
    accepted = acquisition.preview_acquisition_publication(
        world["principal"], source_job_id=source_job_id, idempotency_key=str(uuid4())
    )["data"]
    assert start_task(accepted["job_id"])
    return _run(world, accepted["job_id"])


def test_real_worker_transfer_and_separately_approved_publication(world, human_actor):
    preview = _preview(world)
    plan = preview["plan"]
    assert plan["approval_required"] is True
    with pytest.raises(DiagnosticError):
        acquisition.apply_acquisition(
            world["principal"],
            plan_id=plan["plan_id"],
            plan_version=plan["plan_version"],
            idempotency_key="no-approval",
        )
    accepted, result = _execute(world, human_actor, plan, key="download-once")
    assert result["verification"]["status"] == "passed", result
    assert result["projection"]["status"] == "library_pending_separate_approval"
    assert world["state"]["posts"] == 1
    assert scalar("SELECT count(*) FROM library_albums") == 0
    assert all(kind == "soulseek_download" for kind, _ in world["dispatched"])
    assert (
        scalar("SELECT max_retries FROM tasks WHERE id=:id", {"id": accepted["job_id"]})
        == 0
    )
    replay = acquisition.apply_acquisition(
        world["principal"],
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="download-once",
    )["data"]
    assert replay["job_id"] == accepted["job_id"]
    publication = _publication(world, accepted["job_id"])
    assert publication["execution"]["status"] == "prepared", publication
    assert publication["plan"]["approval_required"] is True
    _, published = _execute(world, human_actor, publication["plan"], publish=True)
    assert published["verification"]["status"] == "passed", published
    assert scalar("SELECT count(*) FROM library_albums") == 1
    with read_scope() as session:
        track = session.execute(text("SELECT * FROM library_tracks")).mappings().one()
        assert Path(track["path"]).read_bytes() == world["sample"].read_bytes()
        assert track["artist"] == "Echo"
    assert (
        _publication(world, accepted["job_id"])["execution"]["error_code"]
        == "ALREADY_EXISTS"
    )
    assert world["state"]["posts"] == 1


@pytest.mark.parametrize(
    "change_values",
    [
        {"max_bytes": 1},
        {"max_items": 0},
        {"max_cost_minor": 1},
        {"destination_policy": "library"},
    ],
)
def test_explicit_caps_rejected_before_transfer(world, change_values):
    result = _preview(world, **change_values)
    assert result["execution"]["error_code"] == "LIMIT_EXCEEDED"
    assert world["state"]["posts"] == 0


def test_source_receipts_are_owned_unforgeable_expiring_and_drift_bound(
    world, human_actor
):
    receipt = _receipt(world)
    with pytest.raises(DiagnosticError, match="Owned"):
        store.read_receipt(other_principal(), receipt)
    with pytest.raises(DiagnosticError, match="unavailable"):
        store.read_receipt(world["principal"], str(uuid4()))
    plan = _preview(world, receipt)["plan"]
    world["state"]["raw"][0]["files"][0]["size"] += 1
    _, result = _execute(world, human_actor, plan)
    assert result["execution"]["error_code"] == "EVIDENCE_STALE"
    assert world["state"]["posts"] == 0
    change("UPDATE agent_acquisition_receipts SET expires_at=NOW()-INTERVAL '1 second'")
    with pytest.raises(DiagnosticError, match="expired"):
        store.read_receipt(world["principal"], receipt)


@pytest.mark.parametrize("mode", ["pending", "uncertain", "extra", "partial_failure"])
def test_uncertainty_is_reconciled_without_redownload(world, human_actor, mode):
    plan = _preview(world)["plan"]
    if mode == "partial_failure":
        world["state"]["failures"] = [{"filename": "One.flac"}]
    else:
        world["state"][mode] = True
    accepted, result = _execute(world, human_actor, plan)
    assert result["execution"]["status"] == "partial", result
    assert world["state"]["posts"] == 1
    replay = _run(world, accepted["job_id"])
    assert replay == result
    world["state"].update(pending=False, uncertain=False, extra=False, failures=[])
    prepared = _publication(world, accepted["job_id"])
    assert prepared["execution"]["status"] == "prepared", prepared
    assert world["state"]["posts"] == 1


@pytest.mark.parametrize("mode", ["pending", "uncertain"])
@pytest.mark.parametrize("cancel", [True, False])
def test_publication_reconciliation_checks_cancellation_between_files(
    world, human_actor, monkeypatch, mode, cancel
):
    from crate import agent_acquisition_publish as publication

    files = world["state"]["raw"][0]["files"]
    files.append({**files[0], "filename": "Echo\\New\\Two.flac"})
    plan = _preview(world, max_items=2)["plan"]
    world["state"][mode] = True
    accepted, result = _execute(world, human_actor, plan)
    assert result["execution"]["status"] == "partial", result
    transfer = store.owned_transfer(world["principal"], accepted["job_id"])
    assert transfer["state"] != "staged"
    directory = (
        Path(world["config"]["downloads_path"])
        / transfer["evidence"]["staging_relative"]
    )
    (directory / "Two.flac").write_bytes(world["sample"].read_bytes())
    world["state"].update(pending=False, uncertain=False)
    verified = []
    original = publication._file_manifest

    def verify(path, expected, source):
        manifest = original(path, expected, source)
        verified.append(path.name)
        return manifest

    monkeypatch.setattr(publication, "_file_manifest", verify)
    monkeypatch.setattr(
        "crate.worker_handlers.is_cancelled", lambda _: cancel and bool(verified)
    )
    plans_before = scalar("SELECT count(*) FROM agent_repair_plans")
    prepared = _publication(world, accepted["job_id"])
    if cancel:
        assert prepared["execution"]["error_code"] == "CANCELLED", prepared
        assert "plan" not in prepared
        assert verified == ["One.flac"]
        assert scalar("SELECT count(*) FROM agent_repair_plans") == plans_before
        assert (
            store.owned_transfer(world["principal"], accepted["job_id"])["state"]
            == transfer["state"]
        )
    else:
        assert prepared["execution"]["status"] == "prepared", prepared
        assert verified == ["One.flac", "Two.flac"]
    assert world["state"]["posts"] == 1
    assert scalar("SELECT count(*) FROM library_albums") == 0


def test_changed_staged_content_and_occupied_destination_rejected(world, human_actor):
    accepted, _ = _execute(world, human_actor, _preview(world)["plan"])
    publication = _publication(world, accepted["job_id"])
    evidence = store.owned_transfer(world["principal"], accepted["job_id"])["evidence"]
    staged = (
        Path(world["config"]["downloads_path"])
        / evidence["staging_relative"]
        / "One.flac"
    )
    staged.write_bytes(b"different")
    _, result = _execute(world, human_actor, publication["plan"], publish=True)
    assert result["execution"]["status"] in {"failed", "conflict"}
    assert scalar("SELECT count(*) FROM library_albums") == 0


def test_current_permission_revocation_blocks_worker(world, human_actor):
    plan = _preview(world)["plan"]
    decide(human_actor, plan)
    accepted = acquisition.apply_acquisition(
        world["principal"],
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="revoke",
    )["data"]
    assert start_task(accepted["job_id"])
    change(
        "UPDATE agent_principals SET enabled=FALSE WHERE id=:id",
        {"id": world["principal"].id},
    )
    result = _run(world, accepted["job_id"])
    assert result["execution"]["status"] == "failed"
    assert world["state"]["posts"] == 0


def test_search_permissions_provider_readiness_and_no_transfer(world):
    principal = replace(world["principal"], grants=frozenset({"library.health.read"}))
    with pytest.raises(DiagnosticError):
        acquisition.search_acquisition(principal, provider="soulseek", query="Echo")
    for provider in ("tidal", "bandcamp"):
        result = acquisition.get_acquisition_readiness(
            world["principal"], provider=provider
        )
        assert result["data"]["executable"] is False
    world["state"]["version"] = "0.25.0"
    assert (
        acquisition.get_acquisition_readiness(world["principal"], provider="soulseek")[
            "data"
        ]["executable"]
        is False
    )
    assert world["state"]["posts"] == 0


def test_generic_search_is_soulseek_only_and_schema_rejects_other_providers(world):
    with pytest.raises(DiagnosticError) as error:
        acquisition.search_acquisition(
            world["principal"], provider="tidal", query="Echo New"
        )
    assert error.value.code == "NOT_EXECUTABLE"
    assert world["state"]["calls"] == []
    with pytest.raises(ValueError):
        AcquisitionSearch.model_validate({"provider": "tidal", "query": "Echo New"})


@pytest.mark.parametrize("limit", [2.5, True])
def test_search_rejects_non_integer_limits_before_provider_call(world, limit):
    with pytest.raises(ValueError, match="Invalid acquisition search"):
        acquisition.search_acquisition(
            world["principal"], provider="soulseek", query="Echo New", limit=limit
        )
    assert not any(endpoint == "searches" for _, endpoint, _ in world["state"]["calls"])


@pytest.mark.parametrize(
    "bad",
    [
        "../peer",
        "peer?x=1",
        "peer#fragment",
        "peer%2fadmin",
        "peer\n",
        "http://peer",
        "peer\\other",
    ],
)
def test_provider_identifiers_reject_injection(bad):
    with pytest.raises(ValueError):
        acquisition._identifier(bad)


def test_transport_redacts_credentials_and_rejects_large_response(monkeypatch):
    monkeypatch.setattr("crate.soulseek._api_key", lambda: "secret")
    monkeypatch.setattr(
        "crate.soulseek._base_url", lambda: "http://secret:password@127.0.0.1"
    )

    def fail(*args, **kwargs):
        raise RuntimeError("http://secret:password@127.0.0.1?token=secret")

    monkeypatch.setattr(acquisition.requests, "request", fail)
    with pytest.raises(DiagnosticError) as error:
        acquisition._transport("GET", "application")
    assert "password" not in str(error.value)
    assert "secret" not in str(error.value)


def test_transport_allows_bounded_large_search_response_only(monkeypatch):
    from uuid import uuid4

    monkeypatch.setattr("crate.soulseek._api_key", lambda: "synthetic-key")
    monkeypatch.setattr("crate.soulseek._base_url", lambda: "http://slskd")
    body = ('["' + "x" * (1024 * 1024) + '"]').encode()

    class Response:
        status_code = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def raise_for_status(self):
            return None

        def iter_content(self, chunk_size):
            for offset in range(0, len(body), chunk_size):
                yield body[offset : offset + chunk_size]

    monkeypatch.setattr(
        acquisition.requests, "request", lambda *_args, **_kwargs: Response()
    )
    result = acquisition._transport("GET", f"searches/{uuid4()}/responses")
    assert len(result[0]) == 1024 * 1024

    with pytest.raises(DiagnosticError, match="bounded transport budget"):
        acquisition._transport("GET", "application")

    body = b'["' + b"x" * acquisition.MAX_SEARCH_RESPONSE_BYTES + b'"]'
    with pytest.raises(DiagnosticError, match="bounded transport budget"):
        acquisition._transport("GET", f"searches/{uuid4()}/responses")


def test_selection_omits_album_when_folder_contains_non_flac_audio(world):
    raw = [
        {
            "username": "peer name",
            "files": [
                {
                    "filename": "Echo\\New\\One.flac",
                    "size": 100,
                    "bitDepth": 16,
                    "sampleRate": 44100,
                },
                {"filename": "Echo\\New\\Two.mp3", "size": 100000},
            ],
        }
    ]

    assert acquisition._selections(world["state"]["search_id"], raw) == []


SILENT_FLAC = "eJztzb9KQmEAhvHngIj/Dji0K01N0jFx+8A6OKUmkhdwtE8UTMNOSm2CW+3dSmd3ly5CZ0c3xUHwFoT3tz3v8vZqgQ9cO5ETgQtualnZghOtdzeLt9X3f+W32ZxvSrkYfGWAWjDtle8KXsG7LcaBNBBMwsF7aKrd/jh7zGHn4/VsS54207CzY4SDcGjN08i6wHPr3n9stOsP1ZbxrgA76o5f7MScP83JIyIiIiIiIiIiIiIiIiIiIly8/e4zgfPXBn78A8ZmMoU="


def test_cancellation_stops_worker_publication_and_reports_remote_uncertainty(
    world, human_actor, monkeypatch
):
    plan = _preview(world)["plan"]
    monkeypatch.setattr(
        "crate.worker_handlers.is_cancelled", lambda _: world["state"]["posts"] > 0
    )
    accepted, result = _execute(world, human_actor, plan)
    assert result["execution"]["status"] == "partial"
    assert result["execution"]["remote_transfers_may_continue"] is True
    assert result["execution"]["items"][0]["status"] == "cancelled"
    assert scalar("SELECT count(*) FROM library_albums") == 0
    assert (
        store.owned_transfer(world["principal"], accepted["job_id"])["state"]
        == "cancelled"
    )


def test_same_files_in_new_receipt_cannot_be_redownloaded(world, human_actor):
    _execute(world, human_actor, _preview(world)["plan"])
    plan = _preview(world)["plan"]
    _, result = _execute(world, human_actor, plan)
    assert result["execution"]["error_code"] == "RECONCILIATION_REQUIRED"
    assert world["state"]["posts"] == 1


def test_publication_rejects_symlink_and_new_target_collision(world, human_actor):
    accepted, _ = _execute(world, human_actor, _preview(world)["plan"])
    publication = _publication(world, accepted["job_id"])
    destination = publication["plan"]["changes"][0]["destination"]
    occupied = Path(world["config"]["library_path"]) / destination
    occupied.mkdir(parents=True)
    (occupied / "preserve.txt").write_text("original")
    _, result = _execute(world, human_actor, publication["plan"], publish=True)
    assert result["execution"]["status"] in {"conflict", "failed"}
    assert (occupied / "preserve.txt").read_text() == "original"
    evidence = store.owned_transfer(world["principal"], accepted["job_id"])["evidence"]
    staged = (
        Path(world["config"]["downloads_path"])
        / evidence["staging_relative"]
        / "One.flac"
    )
    staged.unlink()
    staged.symlink_to(world["sample"])
    assert _publication(world, accepted["job_id"])["execution"]["status"] == "conflict"


def test_schedule_review_rejects_indirect_unsafe_enable_and_tight_intervals(world):
    from crate import agent_operations, agent_runtime, scheduler
    from crate.db.repositories.runtime_policy import read_schedules_state

    state = read_schedules_state()
    readiness = agent_operations.list_schedules()["data"]["readiness"]
    for name in scheduler.DEFAULT_SCHEDULES.keys() - {"compute_analytics"}:
        assert readiness[name]["update"] is False
        assert readiness[name]["reason"]
        parameters = {
            "schedule": name,
            "interval_seconds": 600,
            "expected_revision": state["revision"],
        }
        for call in (
            lambda parameters=parameters: agent_runtime.compile_operation(
                "schedule_update", parameters, {}
            ),
            lambda parameters=parameters: agent_runtime.apply_operation(
                "schedule_update",
                parameters,
                {},
                task_id="invalid",
                authorize=lambda fn: fn(),
            ),
        ):
            with pytest.raises(DiagnosticError, match="reviewed"):
                call()
    with pytest.raises(DiagnosticError, match="600 seconds"):
        agent_runtime.compile_operation(
            "schedule_update",
            {
                "schedule": "compute_analytics",
                "interval_seconds": 1,
                "expected_revision": state["revision"],
            },
            {},
        )


def test_schedule_run_rechecks_revision_inside_atomic_admission(world, monkeypatch):
    from crate import agent_instance_operations, resource_governor
    from crate.db.repositories import runtime_policy

    state = runtime_policy.read_schedules_state()
    compiled = agent_instance_operations.compile_operation(
        "schedule_run",
        {"schedule": "compute_analytics"},
        {},
        principal=world["principal"],
    )
    runtime_policy.update_schedules(
        {"compute_analytics": 600}, expected_revision=state["revision"]
    )
    monkeypatch.setattr(
        resource_governor,
        "should_defer_task",
        lambda *_: resource_governor.ResourceDecision(allowed=True),
    )
    with pytest.raises(DiagnosticError, match="configuration changed"):
        agent_instance_operations.apply_operation(
            "schedule_run",
            compiled["execution"],
            {},
            task_id="schedule",
            authorize=lambda fn: fn(),
        )
    assert scalar("SELECT count(*) FROM tasks WHERE type='compute_analytics'") == 0


def test_download_semaphore_is_fail_closed_for_agent_only(monkeypatch):
    from crate import actors

    monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: None)
    assert actors._acquire_download_slot("legacy") is True
    assert actors._acquire_download_slot("agent", fail_closed=True) is False


def test_staging_must_be_disjoint_from_library(world):
    from crate.agent_acquisition_publish import staging_root

    world["config"]["downloads_path"] = world["config"]["library_path"]
    with pytest.raises(DiagnosticError, match="disjoint"):
        staging_root(world["config"])


def test_acquisition_migration_adds_and_removes_receipts_and_grants():
    import importlib

    migration = importlib.import_module(
        "crate.db.migrations.versions.132_agent_acquisition"
    )
    from crate.db.schema_sections.agent_acquisition_v132 import (
        create_agent_acquisition_v132_schema,
    )

    class Recorder:
        def __init__(self):
            self.sql = []

        def execute(self, sql):
            self.sql.append(sql)

    recorder = Recorder()
    create_agent_acquisition_v132_schema(recorder)
    joined = " ".join(recorder.sql)
    assert (
        "library.acquisition.search" in joined and "library.acquisition.write" in joined
    )
    assert "source_hash TEXT PRIMARY KEY" in joined
    assert "expires_at TIMESTAMPTZ" in joined
    previous = migration.op
    try:
        migration.op = recorder
        migration.upgrade()
        migration.downgrade()
    finally:
        migration.op = previous
    assert any(
        "DROP TABLE IF EXISTS agent_acquisition_transfers" in sql
        for sql in recorder.sql
    )
    assert "library.acquisition.write" not in recorder.sql[-1]


def test_receipt_expiry_after_approval_blocks_transfer(world, human_actor):
    plan = _preview(world)["plan"]
    change("UPDATE agent_acquisition_receipts SET expires_at=NOW()-INTERVAL '1 second'")
    _, result = _execute(world, human_actor, plan)
    assert result["execution"]["error_code"] == "EVIDENCE_STALE"
    assert world["state"]["posts"] == 0


@pytest.mark.parametrize("gate", ["governor", "window", "slot"])
def test_actual_actor_keeps_download_and_governor_admission(monkeypatch, gate):
    from unittest.mock import Mock

    from crate import actors, resource_governor, worker

    task = {
        "id": "strict",
        "status": "pending",
        "params": {"agent_command": True},
        "origin": "agent",
    }
    monkeypatch.setattr("crate.db.queries.tasks.get_task", lambda _: task)
    update = Mock()
    start = Mock(side_effect=AssertionError("Deferred download must not start"))
    monkeypatch.setattr("crate.db.repositories.tasks.update_task", update)
    monkeypatch.setattr("crate.db.repositories.tasks.start_task", start)
    decide = Mock(
        return_value=resource_governor.ResourceDecision(
            allowed=gate != "governor", reason="busy", defer_seconds=1
        )
    )
    monkeypatch.setattr(resource_governor, "should_defer_task", decide)
    monkeypatch.setattr(resource_governor, "record_decision", Mock())
    monkeypatch.setattr(actors, "_is_download_allowed", lambda: gate != "window")
    monkeypatch.setattr(actors, "_ms_until_download_window", lambda: 1000)
    monkeypatch.setattr(actors, "_count_active_users", lambda: 0)
    monkeypatch.setattr(actors, "_count_active_streams", lambda: 0)
    monkeypatch.setattr("crate.db.cache_settings.get_setting", lambda *args: "false")
    slot = Mock(return_value=False)
    monkeypatch.setattr(actors, "_acquire_download_slot", slot)
    handler = Mock(side_effect=AssertionError("Deferred download must not execute"))
    monkeypatch.setitem(worker.TASK_HANDLERS, "soulseek_download", handler)
    enqueue = Mock()
    monkeypatch.setitem(actors._actors, "soulseek_download", enqueue)
    actors._execute_task("soulseek_download", "strict")
    decide.assert_called_once_with("agent_maintenance", {"agent_command": True})
    assert enqueue.send_with_options.call_count == 1
    if gate == "slot":
        slot.assert_called_once_with("strict", fail_closed=True)
    start.assert_not_called()
    handler.assert_not_called()


def test_publication_cancels_within_large_file_copy(world, human_actor, monkeypatch):
    audio = FLAC(world["sample"])
    audio.save(padding=lambda _: 4 * 1024 * 1024)
    world["state"]["raw"][0]["files"][0]["size"] = world["sample"].stat().st_size
    accepted, _ = _execute(
        world, human_actor, _preview(world, max_bytes=8 * 1024 * 1024)["plan"]
    )
    publication = _publication(world, accepted["job_id"])
    artist_root = Path(world["config"]["library_path"]) / UID
    monkeypatch.setattr(
        "crate.worker_handlers.is_cancelled",
        lambda _: any(
            p.stat().st_size > 0
            for p in artist_root.glob(".crate-acquisition-*/*.flac")
        ),
    )
    _, result = _execute(world, human_actor, publication["plan"], publish=True)
    assert result["execution"]["status"] == "partial"
    assert scalar("SELECT count(*) FROM library_albums") == 0
    assert list(artist_root.iterdir()) == []


def test_database_failure_after_atomic_publication_is_partial_and_not_replayed(
    world, human_actor, monkeypatch
):
    accepted, _ = _execute(world, human_actor, _preview(world)["plan"])
    publication = _publication(world, accepted["job_id"])

    def fail(*args, **kwargs):
        raise RuntimeError("Synthetic DB write failure after files")

    monkeypatch.setattr(
        "crate.db.repositories.library_track_upserts.upsert_track", fail
    )
    published_job, result = _execute(
        world, human_actor, publication["plan"], publish=True
    )
    assert result["execution"]["status"] == "partial"
    assert result["verification"]["status"] == "manual_reconciliation_required"
    assert scalar("SELECT count(*) FROM library_albums") == 0
    destination = (
        Path(world["config"]["library_path"])
        / publication["plan"]["changes"][0]["destination"]
    )
    assert len(list(destination.glob("*.flac"))) == 1
    assert _run(world, published_job["job_id"]) == result
    assert world["state"]["posts"] == 1


def test_search_checks_current_authority_before_provider_call(world):
    change(
        "UPDATE agent_principals SET enabled=FALSE WHERE id=:id",
        {"id": world["principal"].id},
    )
    with pytest.raises(DiagnosticError, match="authorized"):
        acquisition.search_acquisition(
            world["principal"], provider="soulseek", query="Echo"
        )
    assert world["state"]["calls"] == []


def test_transfer_history_reads_only_urlencoded_selected_peer(world, monkeypatch):
    original = acquisition._transport

    def provider(method, endpoint, body=None):
        if endpoint == "transfers/downloads":
            pytest.fail("Unrelated provider history must never be requested")
        return original(method, endpoint, body)

    monkeypatch.setattr(acquisition, "_transport", provider)
    assert acquisition._downloads("peer name") == []
    assert world["state"]["calls"][-1][1] == "transfers/downloads/peer%20name"


@pytest.mark.parametrize(
    "raw,valid",
    [
        (None, True),
        ({"username": "peer", "directories": []}, True),
        ([], False),
        ({"username": "other", "directories": []}, False),
        ({"username": "peer", "directories": [None]}, False),
        ({"username": "peer", "directories": [{"files": None}]}, False),
        ({"username": "peer", "directories": [{"files": [None]}]}, False),
    ],
)
def test_selected_peer_history_normalizes_404_and_rejects_wrong_peer(
    monkeypatch, raw, valid
):
    monkeypatch.setattr(acquisition, "_transport", lambda *args: raw)
    if valid:
        assert acquisition._downloads("peer") == []
    else:
        with pytest.raises(DiagnosticError):
            acquisition._downloads("peer")


@pytest.mark.parametrize(
    "value,expected",
    [(0, 0), (4, 4), (True, 1), (4.0, 4), (4.5, 0), ("4", 4), ("bad", 0), (None, 0)],
)
def test_moved_count_accepts_only_safely_coercible_values(value, expected):
    assert _coerce_moved_count(value) == expected
