"""Acceptance is atomic, durable and isolated across integration identities."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from crate.agent_diagnostics import DiagnosticError
from crate.artist_photo import observe_artist_photo
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.agent_credentials import revoke_credential
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import transaction_scope

from tests.agent_command_fixtures import (
    OTHER_UID,
    UID,
    change,
    other_principal,
    scalar,
)

pytest_plugins = ["tests.agent_command_fixtures"]


def test_acceptance_replay_after_completion_and_purge(command_world):
    world, principal = command_world, command_world["principal"]
    first = requests.accept_health_check(principal, UID, "same")
    assert world["dispatched"] == [("health_check", first["job_id"])]
    assert (
        requests.accept_health_check(principal, UID, "same")["job_id"]
        == first["job_id"]
    )
    start_task(first["job_id"])
    result = requests.record_photo_observation(
        first["job_id"], observe_artist_photo(world["config"], UID)
    )
    replay = requests.accept_health_check(principal, UID, "same")
    assert replay["result"] == result and replay["status"] == "completed"
    change("DELETE FROM tasks WHERE id = :id", {"id": first["job_id"]})
    with pytest.raises(DiagnosticError) as error:
        requests.accept_health_check(principal, UID, "same")
    assert error.value.code == "RESULT_EXPIRED"
    assert len(world["dispatched"]) == 1
    assert scalar("SELECT COUNT(*) FROM agent_requests") == 1


def test_conflicting_key_payload_and_active_duplicate(command_world):
    principal = command_world["principal"]
    first = requests.accept_health_check(principal, UID, "first")
    with pytest.raises(DiagnosticError) as error:
        requests.accept_health_check(principal, OTHER_UID, "first")
    assert error.value.code == "IDEMPOTENCY_CONFLICT"
    duplicate = requests.accept_health_check(principal, UID, "different-key")
    assert duplicate["job_id"] == first["job_id"] and duplicate["replayed"]
    assert scalar("SELECT COUNT(*) FROM agent_requests") == 2
    with pytest.raises(DiagnosticError) as error:
        requests.accept_health_check(principal, OTHER_UID, "second-target")
    assert error.value.code == "LIMIT_EXCEEDED"


def test_acceptance_audit_failure_rolls_back_task_request_and_dispatch(
    command_world, monkeypatch
):
    def fail(*_args, **_kwargs):
        raise RuntimeError("audit failed")

    monkeypatch.setattr(requests, "_audit", fail)
    with pytest.raises(RuntimeError, match="audit failed"):
        requests.accept_health_check(command_world["principal"], UID, "rollback")
    assert command_world["dispatched"] == []
    for table in ("tasks", "agent_jobs", "agent_requests"):
        assert scalar(f"SELECT COUNT(*) FROM {table}") == 0


def test_external_transaction_defers_dispatch_and_rolls_back(command_world):
    with pytest.raises(RuntimeError), transaction_scope() as session:
        requests.accept_health_check(
            command_world["principal"], UID, "rollback", session=session
        )
        assert command_world["dispatched"] == []
        raise RuntimeError("abort")
    assert command_world["dispatched"] == []
    assert scalar("SELECT COUNT(*) FROM agent_requests") == 0
    with transaction_scope() as session:
        job = requests.accept_health_check(
            command_world["principal"], UID, "commit", session=session
        )
        assert command_world["dispatched"] == []
    assert command_world["dispatched"] == [("health_check", job["job_id"])]


def test_concurrent_same_key_creates_one_task(command_world):
    barrier = Barrier(2)

    def accept():
        barrier.wait()
        return requests.accept_health_check(
            command_world["principal"], UID, "concurrent"
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: accept(), range(2)))
    assert len({item["job_id"] for item in results}) == 1
    assert len(command_world["dispatched"]) == 1


def test_concurrent_different_principals_do_not_leak_busy_job(command_world):
    principals = [command_world["principal"], other_principal()]
    barrier = Barrier(2)

    def accept(principal):
        barrier.wait()
        try:
            return requests.accept_health_check(principal, UID, "concurrent")
        except DiagnosticError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(accept, principals))
    job = next(item for item in results if isinstance(item, dict))
    error = next(item for item in results if isinstance(item, DiagnosticError))
    assert error.code == "TARGET_BUSY"
    assert job["job_id"] not in str(error)
    assert len(command_world["dispatched"]) == 1


@pytest.mark.parametrize("mutation", ["revoked", "disabled", "grant_removed"])
def test_current_authorization_is_checked_before_replay_and_worker(
    command_world, mutation
):
    principal = command_world["principal"]
    job = requests.accept_health_check(principal, UID, "first")
    start_task(job["job_id"])
    if mutation == "revoked":
        revoke_credential(principal.credential_id)
    elif mutation == "disabled":
        change("UPDATE agent_principals SET enabled = false")
    else:
        change("UPDATE agent_principals SET grants = ARRAY['library.health.read']")
    for action in [
        lambda: requests.accept_health_check(principal, UID, "first"),
        lambda: requests.load_job_for_execution(job["job_id"]),
        lambda: requests.record_photo_observation(
            job["job_id"], observe_artist_photo(command_world["config"], UID)
        ),
    ]:
        with pytest.raises(DiagnosticError) as error:
            action()
        assert error.value.code == "FORBIDDEN"
    assert scalar("SELECT COUNT(*) FROM agent_photo_observations") == 0


def test_worker_allows_normal_credential_expiry_but_not_new_calls(command_world):
    principal = command_world["principal"]
    job = requests.accept_health_check(principal, UID, "first")
    start_task(job["job_id"])
    change(
        "UPDATE agent_credentials SET created_at=NOW()-INTERVAL '2 days', expires_at=NOW()-INTERVAL '1 day'"
    )
    assert requests.load_job_for_execution(job["job_id"])["task_id"] == job["job_id"]
    with pytest.raises(DiagnosticError) as error:
        requests.accept_health_check(principal, UID, "first")
    assert error.value.code == "FORBIDDEN"


@pytest.mark.parametrize(
    "uid,key", [("bad", "key"), (UID, ""), (UID, "../bad"), (UID, "a" * 129)]
)
def test_command_input_validation_precedes_database_work(command_world, uid, key):
    with pytest.raises(DiagnosticError) as error:
        requests.accept_health_check(command_world["principal"], uid, key)
    assert error.value.code == "INVALID_ARGUMENT"
    assert command_world["dispatched"] == []


def test_missing_artist_is_explicit_and_no_job_is_accepted(command_world):
    with pytest.raises(DiagnosticError) as error:
        requests.accept_health_check(
            command_world["principal"], "20000000-0000-0000-0000-000000000001", "key"
        )
    assert error.value.code == "ARTIST_NOT_FOUND"
    assert command_world["dispatched"] == []
