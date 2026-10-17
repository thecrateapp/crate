"""Application permissions and worker lifecycle for bounded machine actions."""

from unittest.mock import Mock, call

import pytest
from crate.agent_access import AgentPrincipal
from crate.agent_diagnostics import DiagnosticError
from crate.artist_photo import PhotoObservationError

ARTIST_UID = "7e989a1d-ef6d-409e-95f1-cb0b2aa50b15"
PLAN_ID = "a3df9dca-dca2-42f0-b35b-dbf5ddf1c89f"
PLAN_VERSION = "a" * 64
CONFIG = {"library_path": "/test-library"}
PRINCIPAL = AgentPrincipal(
    "integration",
    "credential",
    "Maintenance",
    frozenset(
        {
            "library.health.run",
            "library.repair.photo_flag",
            "ops.jobs.retry",
            "ops.jobs.cancel_pending",
        }
    ),
)
CASES = [
    (
        "run_health_check",
        "accept_health_check",
        {"artist_uid": ARTIST_UID, "idempotency_key": "operation-1"},
        (ARTIST_UID, "operation-1"),
    ),
    ("preview_repairs", "preview_repair", {"issue_id": 12}, (12,)),
    (
        "apply_repairs",
        "accept_apply",
        {
            "plan_id": PLAN_ID,
            "plan_version": PLAN_VERSION,
            "idempotency_key": "operation-1",
        },
        (PLAN_ID, PLAN_VERSION, "operation-1"),
    ),
    (
        "retry_job",
        "retry_job",
        {"job_id": "job-1", "idempotency_key": "operation-1"},
        ("job-1", "operation-1"),
    ),
    ("cancel_job", "cancel_job", {"job_id": "job-1"}, ("job-1",)),
]


@pytest.fixture
def boundary(monkeypatch):
    from crate import agent_maintenance as maintenance

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    operations = {}
    for name in (
        "accept_health_check",
        "accept_apply",
        "retry_job",
        "cancel_job",
        "load_job_for_execution",
        "record_photo_observation",
        "complete_photo_repair",
        "record_photo_verification",
        "fail_job",
    ):
        operations[name] = Mock(name=name, return_value={"status": name})
        monkeypatch.setattr(maintenance.agent_requests, name, operations[name])
    operations["preview_repair"] = Mock(return_value={"status": "preview"})
    monkeypatch.setattr(
        maintenance.agent_repair_plans, "preview_repair", operations["preview_repair"]
    )
    observation = {
        "artist_uid": ARTIST_UID,
        "db_has_photo": False,
        "fs_has_photo": True,
    }
    operations["observe"] = Mock(return_value=observation)
    monkeypatch.setattr(
        "crate.artist_photo.observe_artist_photo", operations["observe"]
    )
    return maintenance, operations, observation


@pytest.mark.parametrize("name,target,arguments,db_arguments", CASES)
def test_operations_forward_machine_identity_and_trace_without_changing_arguments(
    boundary, name, target, arguments, db_arguments
):
    maintenance, operations, _ = boundary
    result = getattr(maintenance, name)(PRINCIPAL, **arguments, trace_id="trace-1")
    operations[target].assert_called_once_with(
        PRINCIPAL, *db_arguments, trace_id="trace-1"
    )
    assert result["data"] == operations[target].return_value
    assert result["schema_version"] == "1"
    assert result["availability"] == "available"
    assert (
        "Acceptance, execution and verification are separate"
        in result["interpretation"]
    )


@pytest.mark.parametrize("name,target,arguments,db_arguments", CASES)
@pytest.mark.parametrize("denied_by", ["flag", "grant"])
def test_application_rechecks_permissions_before_acceptance(
    boundary, monkeypatch, name, target, arguments, db_arguments, denied_by
):
    maintenance, operations, _ = boundary
    principal = PRINCIPAL
    if denied_by == "flag":
        monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "false")
    else:
        principal = AgentPrincipal(
            PRINCIPAL.id, PRINCIPAL.credential_id, PRINCIPAL.name, frozenset()
        )
    with pytest.raises(DiagnosticError) as caught:
        getattr(maintenance, name)(principal, **arguments)
    assert caught.value.code == "FORBIDDEN"
    for operation in operations.values():
        operation.assert_not_called()


def test_direct_health_check_rejects_non_catalogued_check_before_acceptance(boundary):
    maintenance, operations, _ = boundary
    with pytest.raises(DiagnosticError) as caught:
        maintenance.run_health_check(
            PRINCIPAL,
            artist_uid=ARTIST_UID,
            idempotency_key="operation-1",
            check_type="missing_artwork",
        )
    assert caught.value.code == "INVALID_ARGUMENT"
    operations["accept_health_check"].assert_not_called()


def test_domain_conflict_is_preserved_without_retry_or_implicit_refresh(boundary):
    maintenance, operations, _ = boundary
    conflict = DiagnosticError("EVIDENCE_STALE", "Run a directed health check first")
    operations["preview_repair"].side_effect = conflict
    with pytest.raises(DiagnosticError) as caught:
        maintenance.preview_repairs(PRINCIPAL, issue_id=12)
    assert caught.value is conflict
    operations["preview_repair"].assert_called_once()
    operations["accept_health_check"].assert_not_called()
    operations["observe"].assert_not_called()


@pytest.mark.parametrize("disabled", ["CRATE_MCP_ENABLED", "CRATE_MCP_ACTIONS_ENABLED"])
@pytest.mark.parametrize("value", [None, "false"])
def test_worker_disabled_flag_records_failure_before_loading_or_observing(
    boundary, monkeypatch, disabled, value
):
    maintenance, operations, _ = boundary
    if value is None:
        monkeypatch.delenv(disabled)
    else:
        monkeypatch.setenv(disabled, value)
    assert (
        maintenance.execute_agent_job("job-1", CONFIG)
        == operations["fail_job"].return_value
    )
    assert operations["fail_job"].call_args.args[:2] == ("job-1", "FORBIDDEN")
    operations["load_job_for_execution"].assert_not_called()
    operations["observe"].assert_not_called()


@pytest.mark.parametrize("code", ["FORBIDDEN", "NOT_FOUND", "STATE_CONFLICT"])
def test_worker_revalidates_persisted_authorization_before_filesystem_access(
    boundary, code
):
    maintenance, operations, _ = boundary
    operations["load_job_for_execution"].side_effect = DiagnosticError(
        code, "Job cannot run"
    )
    result = maintenance.execute_agent_job("job-1", CONFIG)
    assert result == operations["fail_job"].return_value
    operations["fail_job"].assert_called_once_with("job-1", code, "Job cannot run")
    operations["observe"].assert_not_called()


def test_worker_redelivery_returns_persisted_result_without_observing_or_reapplying(
    boundary,
):
    maintenance, operations, _ = boundary
    persisted = {"status": "completed", "execution": {"status": "applied"}}
    operations["load_job_for_execution"].return_value = {"result": persisted}
    assert maintenance.execute_agent_job("job-1", CONFIG) is persisted
    operations["load_job_for_execution"].assert_called_once_with("job-1")
    operations["observe"].assert_not_called()
    operations["complete_photo_repair"].assert_not_called()
    operations["fail_job"].assert_not_called()


@pytest.mark.parametrize("execution_status", ["applied", "already_satisfied"])
def test_worker_redelivery_resumes_pending_verification_without_reapplying(
    boundary, execution_status
):
    maintenance, operations, observation = boundary
    operations["load_job_for_execution"].return_value = {
        "operation": "apply_repairs",
        "artist_uid": ARTIST_UID,
        "result": {
            "execution": {"status": execution_status},
            "verification": {"status": "pending"},
        },
    }
    assert (
        maintenance.execute_agent_job("job-1", CONFIG)
        == operations["record_photo_verification"].return_value
    )
    operations["observe"].assert_called_once_with(CONFIG, ARTIST_UID)
    operations["record_photo_verification"].assert_called_once_with(
        "job-1", observation
    )
    operations["complete_photo_repair"].assert_not_called()
    operations["fail_job"].assert_not_called()


def test_directed_health_worker_observes_one_artist_and_only_records_evidence(boundary):
    maintenance, operations, observation = boundary
    operations["load_job_for_execution"].return_value = {
        "operation": "run_health_check",
        "artist_uid": ARTIST_UID,
    }
    assert (
        maintenance.execute_agent_job("job-1", CONFIG)
        == operations["record_photo_observation"].return_value
    )
    operations["observe"].assert_called_once_with(CONFIG, ARTIST_UID)
    operations["record_photo_observation"].assert_called_once_with("job-1", observation)
    operations["complete_photo_repair"].assert_not_called()
    operations["record_photo_verification"].assert_not_called()


def test_worker_rejects_unknown_operation_before_observing_library(boundary):
    maintenance, operations, _ = boundary
    operations["load_job_for_execution"].return_value = {
        "operation": "download_artist_artwork",
        "artist_uid": ARTIST_UID,
    }
    maintenance.execute_agent_job("job-1", CONFIG)
    assert operations["fail_job"].call_args.args[:2] == ("job-1", "FORBIDDEN")
    operations["observe"].assert_not_called()
    operations["complete_photo_repair"].assert_not_called()


@pytest.mark.parametrize("execution_status", ["applied", "already_satisfied"])
def test_photo_apply_observes_before_effect_and_verifies_again_after_commit(
    boundary, execution_status
):
    maintenance, operations, before = boundary
    after = {**before, "db_has_photo": True}
    operations["load_job_for_execution"].return_value = {
        "operation": "apply_repairs",
        "artist_uid": ARTIST_UID,
    }
    operations["observe"].side_effect = [before, after]
    operations["complete_photo_repair"].return_value = {
        "execution": {"status": execution_status}
    }
    order = Mock()
    order.attach_mock(operations["observe"], "observe")
    order.attach_mock(operations["complete_photo_repair"], "apply")
    order.attach_mock(operations["record_photo_verification"], "verify")
    assert (
        maintenance.execute_agent_job("job-1", CONFIG)
        == operations["record_photo_verification"].return_value
    )
    assert order.mock_calls == [
        call.observe(CONFIG, ARTIST_UID),
        call.apply("job-1", before),
        call.observe(CONFIG, ARTIST_UID),
        call.verify("job-1", after),
    ]
    operations["fail_job"].assert_not_called()


@pytest.mark.parametrize("execution_status", ["conflict", "failed"])
def test_rejected_photo_apply_does_not_claim_verification_or_retry(
    boundary, execution_status
):
    maintenance, operations, _ = boundary
    operations["load_job_for_execution"].return_value = {
        "operation": "apply_repairs",
        "artist_uid": ARTIST_UID,
    }
    stored = {"execution": {"status": execution_status}}
    operations["complete_photo_repair"].return_value = stored
    assert maintenance.execute_agent_job("job-1", CONFIG) is stored
    operations["observe"].assert_called_once()
    operations["complete_photo_repair"].assert_called_once()
    operations["record_photo_verification"].assert_not_called()


@pytest.mark.parametrize(
    "code", ["DIRECTORY_MISSING", "ARTIST_NOT_FOUND", "PATH_UNSAFE"]
)
def test_worker_preserves_typed_filesystem_failure_without_attempting_effect(
    boundary, code
):
    maintenance, operations, _ = boundary
    operations["load_job_for_execution"].return_value = {
        "operation": "apply_repairs",
        "artist_uid": ARTIST_UID,
    }
    operations["observe"].side_effect = PhotoObservationError(
        code, "Photo cannot be observed"
    )
    maintenance.execute_agent_job("job-1", CONFIG)
    operations["fail_job"].assert_called_once_with(
        "job-1", code, "Photo cannot be observed"
    )
    operations["complete_photo_repair"].assert_not_called()


def test_verification_failure_returns_repository_result_preserving_committed_effect(
    boundary,
):
    maintenance, operations, before = boundary
    operations["load_job_for_execution"].return_value = {
        "operation": "apply_repairs",
        "artist_uid": ARTIST_UID,
    }
    operations["observe"].side_effect = [
        before,
        PhotoObservationError("FILESYSTEM_UNAVAILABLE", "Cannot verify photo"),
    ]
    operations["complete_photo_repair"].return_value = {
        "execution": {"status": "applied"}
    }
    persisted = {
        "execution": {"status": "applied"},
        "verification": {"status": "pending", "error_code": "FILESYSTEM_UNAVAILABLE"},
    }
    operations["record_photo_verification"].return_value = persisted
    assert maintenance.execute_agent_job("job-1", CONFIG) is persisted
    operations["complete_photo_repair"].assert_called_once()
    operations["record_photo_verification"].assert_called_once_with(
        "job-1", None, error_code="FILESYSTEM_UNAVAILABLE"
    )
    operations["fail_job"].assert_not_called()


def test_worker_sanitizes_unexpected_failure_before_persisting(boundary):
    maintenance, operations, _ = boundary
    operations["load_job_for_execution"].side_effect = RuntimeError(
        "postgresql://operator:private-secret@db/private"
    )
    assert (
        maintenance.execute_agent_job("job-1", CONFIG)
        == operations["fail_job"].return_value
    )
    job_id, code, message = operations["fail_job"].call_args.args
    assert job_id == "job-1"
    assert code == "OPERATION_FAILED"
    assert "private-secret" not in message
    assert "postgresql" not in message
    operations["observe"].assert_not_called()


def test_failure_to_persist_worker_result_propagates_instead_of_claiming_completion(
    boundary,
):
    maintenance, operations, _ = boundary
    operations["load_job_for_execution"].side_effect = DiagnosticError(
        "FORBIDDEN", "Credential revoked"
    )
    operations["fail_job"].side_effect = RuntimeError("DB unavailable")
    with pytest.raises(RuntimeError, match="DB unavailable"):
        maintenance.execute_agent_job("job-1", CONFIG)
    operations["fail_job"].assert_called_once()
    operations["observe"].assert_not_called()
