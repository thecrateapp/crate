"""Explicit health scopes and quality jobs share the worker-only plan contract."""

from unittest.mock import Mock

import pytest

from crate import agent_health
from crate.db import analytics_quality_surface as surface
from crate.db.health import upsert_health_issue
from crate.db.repositories import agent_operation_jobs as jobs
from crate.db.repositories.tasks_updates import start_task
from crate.health_check import LibraryHealthCheck

from tests.agent_command_fixtures import UID, OTHER_UID, change, scalar
from tests.agent_command_fixtures import command_world as command_world  # noqa: PLC0414


def _authorize(effect=None):
    return effect() if effect is not None else None


@pytest.mark.parametrize(
    "operation,parameters",
    [
        ("delete_library", {"scope": "global", "check_types": ["has_photo_desync"]}),
        ("health_check", {"scope": "global", "check_types": []}),
        ("health_check", {"scope": "global"}),
        ("health_check", {"scope": "artist", "check_types": ["has_photo_desync"]}),
        (
            "health_check",
            {"scope": "artist", "artist_uid": UID, "check_types": ["stale_tracks"]},
        ),
        (
            "health_check",
            {"scope": "global", "artist_uid": UID, "check_types": ["has_photo_desync"]},
        ),
        ("health_check", {"scope": "global", "check_types": ["has_photo_desync"] * 2}),
        ("health_check", {"scope": "global", "check_types": ["shell_command"]}),
        (
            "health_check",
            {"scope": "global", "check_types": ["has_photo_desync"], "path": "/music"},
        ),
        ("quality_check", {"scope": "artist", "artist_uid": UID}),
        ("quality_check", {"scope": "global", "artist_uid": UID}),
        ("quality_check", {"scope": "global", "check_types": ["has_photo_desync"]}),
    ],
)
def test_health_compilation_rejects_implicit_widened_or_unsupported_scopes_before_reads(
    monkeypatch, operation, parameters
):
    monkeypatch.setattr(
        agent_health,
        "read_artist_photo",
        Mock(side_effect=AssertionError("invalid scope reached the database")),
    )
    with pytest.raises(ValueError):
        agent_health.compile_operation(operation, parameters, {})


def test_artist_plan_freezes_identity_and_declares_exact_selected_checks(command_world):
    world = command_world
    plan = agent_health.compile_operation(
        "health_check",
        {"scope": "artist", "artist_uid": UID, "check_types": ["has_photo_desync"]},
        world["config"],
    )
    assert plan["document"]["targets"] == [
        {"entity_type": "artist", "entity_uid": UID, "name": "Echo"}
    ]
    assert plan["document"]["changes"][0]["checks"] == ["has_photo_desync"]
    assert plan["document"]["changes"][0]["entity_uid"] == UID
    assert plan["document"]["impact"]["filesystem_writes"] is False
    assert plan["execution"]["artist"]["artist_uid"] == UID
    assert scalar("SELECT COUNT(*) FROM health_issues") == 0


def test_artist_check_persists_only_selected_artist_and_leaves_other_open_issues(
    command_world,
):
    world = command_world
    other_issue = upsert_health_issue(
        "has_photo_desync",
        "low",
        "Other prior observation",
        {"artist": "Other", "artist_uid": OTHER_UID},
    )
    other_type = upsert_health_issue(
        "duplicate_albums", "medium", "Echo prior duplicate", {"artist": "Echo"}
    )
    plan = agent_health.compile_operation(
        "health_check",
        {"scope": "artist", "artist_uid": UID, "check_types": ["has_photo_desync"]},
        world["config"],
    )

    result = agent_health.apply_operation(
        "health_check",
        plan["execution"],
        world["config"],
        task_id="artist-check",
        authorize=_authorize,
    )

    assert result["execution"]["status"] == "completed"
    assert result["execution"]["issue_count"] == 1
    assert result["verification"] == {"status": "observed", "coverage": "artist"}
    assert (
        scalar(
            "SELECT COUNT(*) FROM health_issues WHERE check_type='has_photo_desync' AND details_json->>'artist'='Echo' AND status='open'"
        )
        == 1
    )
    assert (
        scalar("SELECT status FROM health_issues WHERE id=:id", {"id": other_issue})
        == "open"
    )
    assert (
        scalar("SELECT status FROM health_issues WHERE id=:id", {"id": other_type})
        == "open"
    )
    assert (
        scalar(
            "SELECT has_photo FROM library_artists WHERE entity_uid=:uid", {"uid": UID}
        )
        == 0
    )


def test_changed_artist_identity_prevents_stale_check_and_persistence(command_world):
    world = command_world
    plan = agent_health.compile_operation(
        "health_check",
        {"scope": "artist", "artist_uid": UID, "check_types": ["has_photo_desync"]},
        world["config"],
    )
    change(
        "UPDATE library_artists SET folder_name='changed-folder' WHERE entity_uid=:uid",
        {"uid": UID},
    )

    with pytest.raises(ValueError, match="identity changed"):
        agent_health.apply_operation(
            "health_check",
            plan["execution"],
            world["config"],
            task_id="stale-check",
            authorize=_authorize,
        )
    assert scalar("SELECT COUNT(*) FROM health_issues") == 0


def test_global_check_runs_only_declared_scanner_and_records_its_coverage(
    command_world, monkeypatch
):
    world = command_world
    monkeypatch.setattr(
        LibraryHealthCheck,
        "_check_duplicate_tracks",
        lambda *_args: pytest.fail("unselected scanner ran"),
    )
    plan = agent_health.compile_operation(
        "health_check",
        {"scope": "global", "check_types": ["has_photo_desync"]},
        world["config"],
    )

    result = agent_health.apply_operation(
        "health_check",
        plan["execution"],
        world["config"],
        task_id="global-check",
        authorize=_authorize,
    )

    assert plan["document"]["targets"] == [
        {"entity_type": "library", "scope": "global"}
    ]
    assert result["execution"]["status"] == "completed"
    assert result["execution"]["checks"] == ["has_photo_desync"]
    assert result["verification"]["coverage"] == "global_check_specific"
    assert (
        scalar(
            "SELECT COUNT(*) FROM health_check_runs WHERE check_type='has_photo_desync'"
        )
        == 1
    )
    assert (
        scalar(
            "SELECT COUNT(*) FROM health_check_runs WHERE check_type='duplicate_tracks'"
        )
        == 0
    )


def test_failed_global_scanner_does_not_resolve_existing_issues_or_claim_full_observation(
    command_world, monkeypatch
):
    world = command_world
    issue = upsert_health_issue(
        "has_photo_desync",
        "low",
        "Prior photo observation",
        {"artist": "Echo", "artist_uid": UID},
    )

    def unavailable(*_args):
        raise RuntimeError("Filesystem metadata source unavailable")

    monkeypatch.setattr(LibraryHealthCheck, "_check_has_photo_desync", unavailable)
    plan = agent_health.compile_operation(
        "health_check",
        {"scope": "global", "check_types": ["has_photo_desync"]},
        world["config"],
    )

    result = agent_health.apply_operation(
        "health_check",
        plan["execution"],
        world["config"],
        task_id="failed-check",
        authorize=_authorize,
    )

    assert (
        scalar("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "open"
    )
    assert result["execution"]["status"] != "completed"
    assert result["verification"]["status"] != "observed"


def test_authorization_checkpoint_stops_before_a_real_scanner_or_persistence(
    command_world, monkeypatch
):
    world = command_world
    plan = agent_health.compile_operation(
        "health_check",
        {"scope": "global", "check_types": ["has_photo_desync"]},
        world["config"],
    )
    scanner = Mock(side_effect=AssertionError("revoked authority reached scanner"))
    monkeypatch.setattr(LibraryHealthCheck, "_check_has_photo_desync", scanner)

    class Revoked(RuntimeError):
        pass

    def authorize(effect=None):
        if effect is None:
            raise Revoked()
        return effect()

    with pytest.raises(Revoked):
        agent_health.apply_operation(
            "health_check",
            plan["execution"],
            world["config"],
            task_id="revoked-check",
            authorize=authorize,
        )
    scanner.assert_not_called()
    assert scalar("SELECT COUNT(*) FROM health_issues") == 0


def _claimed_generic(world, operation, *, stage="apply_operation"):
    queued = jobs.prepare_operation(
        world["principal"], operation, {}, "prepare-" + operation
    )
    start_task(queued["job_id"])
    if stage == "prepare_operation":
        return queued
    result = jobs.publish_plan(
        queued["job_id"],
        {
            "document": {
                "operation": operation,
                "targets": [{"entity_type": "artist", "entity_uid": UID}],
                "changes": [{"entity_uid": UID, "action": operation}],
                "impact": {"scope": "artist"},
                "risk": "safe",
            },
            "execution": {"target_keys": [f"artist:{UID}"]},
        },
    )
    plan = result["plan"]
    accepted = jobs.apply_operation(
        world["principal"],
        operation,
        plan["plan_id"],
        plan["plan_version"],
        "apply-" + operation,
    )
    start_task(accepted["job_id"])
    return accepted


@pytest.mark.parametrize(
    "operation",
    ["repairs", "metadata_update", "enrichment", "library_sync", "metadata_rehydrate"],
)
def test_quality_scan_rejects_active_generic_library_mutations(
    command_world, monkeypatch, operation
):
    monkeypatch.setattr(surface, "publish_snapshot_update", Mock())
    observation = surface.begin_quality_report_scan()
    _claimed_generic(command_world, operation)

    with pytest.raises(surface.QualityMutationInProgress):
        surface.begin_quality_report_scan()
    assert (
        surface.complete_quality_report_scan(
            surface.empty_quality_report(), observation=observation
        )
        is False
    )
    assert surface.read_quality_report_snapshot()["active_mutation"] is True


@pytest.mark.parametrize(
    "operation,stage",
    [
        ("metadata_update", "prepare_operation"),
        ("health_check", "apply_operation"),
        ("quality_check", "apply_operation"),
        ("analysis", "apply_operation"),
        ("metadata_export", "apply_operation"),
    ],
)
def test_quality_scan_excludes_preparation_diagnostics_and_non_audio_mutating_generic_jobs(
    command_world, monkeypatch, operation, stage
):
    monkeypatch.setattr(surface, "publish_snapshot_update", Mock())
    _claimed_generic(command_world, operation, stage=stage)

    observation = surface.begin_quality_report_scan()
    assert (
        surface.complete_quality_report_scan(
            surface.empty_quality_report(), observation=observation
        )
        is True
    )
    assert surface.read_quality_report_snapshot()["active_mutation"] is False


def test_quality_adapter_publishes_real_worker_snapshot_instead_of_scanning_in_compile(
    command_world, monkeypatch
):
    world = command_world
    from crate.worker_handlers import quality as worker

    monkeypatch.setattr(surface, "publish_snapshot_update", Mock())
    monkeypatch.setattr(worker, "is_cancelled", lambda _: False)
    monkeypatch.setattr(worker, "audio_extensions", lambda: {".flac"})
    plan = agent_health.compile_operation(
        "quality_check", {"scope": "global"}, world["config"]
    )
    assert surface.read_quality_report_snapshot() is None

    result = agent_health.apply_operation(
        "quality_check",
        plan["execution"],
        world["config"],
        task_id="quality-worker",
        authorize=_authorize,
    )

    assert result["execution"]["status"] == "completed"
    assert result["execution"]["report"]["published"] is True
    assert result["verification"]["status"] == "verified"
    snapshot = surface.read_quality_report_snapshot()
    assert snapshot["summary"]["method"] == "metadata_heuristics_v1"
    assert snapshot["summary"]["ready"] is True
    assert snapshot["summary"]["audio_decode_verified"] is False


def test_quality_adapter_preserves_cancellation_and_concurrent_mutation_outcomes(
    monkeypatch,
):
    producer = Mock()
    monkeypatch.setattr("crate.worker_handlers.quality._handle_quality_check", producer)
    producer.return_value = {"status": "cancelled", "published": False}
    result = agent_health.apply_operation(
        "quality_check",
        {"scope": "global"},
        {},
        task_id="quality-cancelled",
        authorize=_authorize,
    )
    assert result["execution"]["status"] == "cancelled"
    assert result["verification"]["status"] != "verified"
    producer.return_value = {"status": "conflict", "published": False}
    result = agent_health.apply_operation(
        "quality_check",
        {"scope": "global"},
        {},
        task_id="quality-conflict",
        authorize=_authorize,
    )
    assert result["execution"]["status"] == "conflict"
    assert result["verification"]["status"] != "verified"


def test_agent_maintenance_runtime_is_lazy_governed_and_cannot_dispatch_from_task_parameters(
    monkeypatch,
):
    from crate import worker
    from crate.actors import TASK_POOL_CONFIG
    from crate.resource_governor import RESOURCE_GOVERNED_TASK_TYPES
    from crate.task_registry import TASK_TYPES
    from crate.worker_handlers import agent_library

    assert "agent_maintenance" in TASK_TYPES
    assert "agent_maintenance" in RESOURCE_GOVERNED_TASK_TYPES
    runtime = TASK_POOL_CONFIG["agent_maintenance"]
    assert runtime.queue == "maintenance"
    assert runtime.time_limit_seconds == 1800
    assert runtime.max_retries == 0
    executor = Mock(
        return_value={
            "status": "completed",
            "execution": {"status": "completed", "items": [{"path": "/private"}]},
            "verification": {"status": "passed", "private_evidence": "source"},
            "projection": {"status": "pending"},
            "plan": {"changes": [{"after": "private metadata"}]},
        }
    )
    monkeypatch.setattr(agent_library, "execute_operation_job", executor)
    importer = Mock(wraps=worker.import_module)
    monkeypatch.setattr(worker, "import_module", importer)
    registry = worker.LazyTaskHandlers(
        tuple(
            group for group in worker._HANDLER_GROUPS if "agent_maintenance" in group[2]
        )
    )
    assert list(registry) == ["agent_maintenance"]
    importer.assert_not_called()
    handler = registry["agent_maintenance"]
    assert handler(
        "task",
        {"operation": "arbitrary_task", "path": "/outside"},
        {"library_path": "/music"},
    ) == {
        "status": "completed",
        "execution": {"status": "completed"},
        "verification": {"status": "passed"},
        "projection": {"status": "pending"},
    }
    executor.assert_called_once_with("task", {"library_path": "/music"})
    importer.assert_called_once_with("crate.worker_handlers.agent_library")
