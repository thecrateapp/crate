"""Job controls preserve ownership, state transitions and retry budgets."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.tasks_updates import start_task

from tests.agent_command_fixtures import (
    UID,
    change,
    observed_plan,
    other_principal,
    scalar,
)

pytest_plugins = ["tests.agent_command_fixtures"]


def test_retry_is_owned_server_derived_idempotent_and_budgeted(command_world):
    principal = command_world["principal"]
    original = requests.accept_health_check(principal, UID, "first")
    start_task(original["job_id"])
    requests.fail_job(
        original["job_id"], "FILESYSTEM_UNAVAILABLE", "Temporary storage issue"
    )
    previous = original
    for attempt in range(3):
        retried = requests.retry_job(principal, previous["job_id"], f"retry-{attempt}")
        assert retried["retry_of"] == previous["job_id"]
        assert retried["artist_uid"] == UID
        assert (
            requests.retry_job(principal, previous["job_id"], f"retry-{attempt}")[
                "job_id"
            ]
            == retried["job_id"]
        )
        start_task(retried["job_id"])
        requests.fail_job(
            retried["job_id"], "FILESYSTEM_UNAVAILABLE", "Temporary storage issue"
        )
        previous = retried
    with pytest.raises(DiagnosticError) as error:
        requests.retry_job(principal, original["job_id"], "bypass-chain")
    assert error.value.code == "NOT_RETRIABLE"
    assert scalar("SELECT MAX(retry_depth) FROM agent_jobs") == 3
    assert scalar("SELECT COUNT(*) FROM tasks WHERE max_retries <> 0") == 0


@pytest.mark.parametrize("action", ["retry", "cancel"])
def test_controls_cannot_access_alien_or_generic_jobs(command_world, action):
    owned = requests.accept_health_check(command_world["principal"], UID, "first")
    other = other_principal()
    if action == "retry":
        start_task(owned["job_id"])
        requests.fail_job(owned["job_id"], "FILESYSTEM_UNAVAILABLE", "Temporary")

    def call():
        if action == "retry":
            return requests.retry_job(other, owned["job_id"], "foreign")
        return requests.cancel_job(other, owned["job_id"])

    with pytest.raises(DiagnosticError) as error:
        call()
    assert error.value.code == "NOT_FOUND"


def test_retry_denies_permanent_failure_missing_original_grant_and_repair(
    command_world,
):
    principal = command_world["principal"]
    first = requests.accept_health_check(principal, UID, "first")
    start_task(first["job_id"])
    requests.fail_job(first["job_id"], "PATH_UNSAFE", "Unsafe path")
    with pytest.raises(DiagnosticError) as error:
        requests.retry_job(principal, first["job_id"], "permanent")
    assert error.value.code == "NOT_RETRIABLE"
    _, plan = observed_plan(command_world)
    repair = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "repair"
    )
    start_task(repair["job_id"])
    requests.fail_job(repair["job_id"], "OPERATION_FAILED", "Temporary")
    with pytest.raises(DiagnosticError) as error:
        requests.retry_job(principal, repair["job_id"], "repair-retry")
    assert error.value.code == "NOT_RETRIABLE"
    change("UPDATE agent_principals SET grants=ARRAY['ops.jobs.retry']")
    with pytest.raises(DiagnosticError) as error:
        requests.retry_job(principal, first["job_id"], "missing-original")
    assert error.value.code == "FORBIDDEN"


@pytest.mark.parametrize("state", ["running", "completed", "failed"])
def test_cancel_and_retry_do_not_overwrite_terminal_or_running_jobs(
    command_world, state
):
    principal = command_world["principal"]
    job = requests.accept_health_check(principal, UID, "first")
    change(
        "UPDATE tasks SET status=:status WHERE id=:id",
        {"status": state, "id": job["job_id"]},
    )
    with pytest.raises(DiagnosticError) as error:
        requests.cancel_job(principal, job["job_id"])
    assert error.value.code == "STATE_CONFLICT"
    if state != "failed":
        with pytest.raises(DiagnosticError) as error:
            requests.retry_job(principal, job["job_id"], "retry")
        assert error.value.code == "STATE_CONFLICT"
    assert (
        scalar("SELECT status FROM tasks WHERE id=:id", {"id": job["job_id"]}) == state
    )


def test_cancel_is_idempotent_and_actor_claim_cannot_start_it(command_world):
    principal = command_world["principal"]
    job = requests.accept_health_check(principal, UID, "first")
    cancelled = requests.cancel_job(principal, job["job_id"])
    assert cancelled["status"] == "cancelled"
    assert (
        requests.cancel_job(principal, job["job_id"])["result"] == cancelled["result"]
    )
    assert start_task(job["job_id"]) is None
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.command.cancelled'")
        == 1
    )


def test_cancel_pending_repair_consumes_plan_without_library_effect(command_world):
    _, plan = observed_plan(command_world)
    principal = command_world["principal"]
    job = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "repair"
    )
    requests.cancel_job(principal, job["job_id"])
    assert scalar("SELECT state FROM agent_repair_plans") == "cancelled"
    assert scalar("SELECT has_photo FROM library_artists WHERE name='Echo'") == 0
    assert (
        requests.accept_apply(
            principal, plan["plan_id"], plan["plan_version"], "again"
        )["status"]
        == "cancelled"
    )


def test_cancel_claim_race_has_exactly_one_winner(command_world):
    principal = command_world["principal"]
    job = requests.accept_health_check(principal, UID, "first")
    barrier = Barrier(2)

    def claim():
        barrier.wait()
        return start_task(job["job_id"])

    def cancel():
        barrier.wait()
        try:
            return requests.cancel_job(principal, job["job_id"])
        except DiagnosticError as error:
            assert error.code == "STATE_CONFLICT"
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        claimed, cancelled = pool.submit(claim), pool.submit(cancel)
        results = [claimed.result(), cancelled.result()]
    assert sum(result is not None for result in results) == 1
    assert scalar("SELECT status FROM tasks WHERE id=:id", {"id": job["job_id"]}) in {
        "running",
        "cancelled",
    }


def test_two_concurrent_cancels_return_the_same_result(command_world):
    principal = command_world["principal"]
    job = requests.accept_health_check(principal, UID, "first")
    barrier = Barrier(2)

    def cancel():
        barrier.wait()
        return requests.cancel_job(principal, job["job_id"])

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: cancel(), range(2)))
    assert results[0]["result"] == results[1]["result"]
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.command.cancelled'")
        == 1
    )
