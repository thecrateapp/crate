"""Job controls preserve ownership, state transitions and retry budgets."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier

import pytest
from crate.agent_access import authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_operation_jobs as operation_jobs
from crate.db.repositories import agent_requests as requests
from crate.db.repositories import mcp_oauth as oauth_store
from crate.db.repositories.tasks_updates import start_task

from tests.agent_command_fixtures import (
    UID,
    change,
    observed_plan,
    other_principal,
    scalar,
)
from tests.test_mcp_oauth_integration import _code, _exchange, _refresh

pytest_plugins = [
    "tests.agent_command_fixtures",
    "tests.test_mcp_oauth_integration",
]


@pytest.fixture
def delegated_cancel_world(command_world, oauth_env):
    scopes = {
        "library.health.run",
        "ops.jobs.cancel_pending",
        "ops.jobs.cancel",
        "ops.status.read",
    }
    oauth_store.update_oauth_client("test-client", scopes=scopes)
    exchanged = _exchange(_code(oauth_env, scope=" ".join(sorted(scopes))))
    assert exchanged[0] == 200, exchanged
    tokens = exchanged[1]
    principal = oauth_store.resolve_oauth_access_token(tokens["access_token"])[0]
    return {**command_world, "principal": principal, "tokens": tokens}


@pytest.mark.parametrize("status", ["pending", "cancelled"])
@pytest.mark.parametrize("retain_original_grant", [False, True])
def test_cancel_denies_reduced_oauth_context_even_with_same_authorization(
    delegated_cancel_world, status, retain_original_grant
):
    world = delegated_cancel_world
    original = world["principal"]
    job = requests.accept_health_check(original, UID, "scope-context-job")
    if status == "cancelled":
        requests.cancel_job(original, job["job_id"])
    previous_result = scalar(
        "SELECT result FROM agent_jobs WHERE task_id=:id", {"id": job["job_id"]}
    )
    scopes = {"ops.jobs.cancel", "ops.jobs.cancel_pending"}
    if retain_original_grant:
        scopes.add("library.health.run")
    refreshed = _refresh(
        world["tokens"]["refresh_token"], scope=" ".join(sorted(scopes))
    )
    assert refreshed[0] == 200, refreshed
    narrowed = oauth_store.resolve_oauth_access_token(refreshed[1]["access_token"])[0]
    assert original.authorization_id == narrowed.authorization_id
    assert authorization_context(original) != authorization_context(narrowed)

    with pytest.raises(DiagnosticError) as error:
        requests.cancel_job(narrowed, job["job_id"])

    assert error.value.code == "NOT_FOUND"
    assert (
        scalar("SELECT status FROM tasks WHERE id=:id", {"id": job["job_id"]}) == status
    )
    assert (
        scalar("SELECT result FROM agent_jobs WHERE task_id=:id", {"id": job["job_id"]})
        == previous_result
    )
    assert scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action='agent.command.cancelled'"
    ) == (1 if status == "cancelled" else 0)


def test_cancel_after_refresh_with_identical_oauth_context_remains_idempotent(
    delegated_cancel_world,
):
    world = delegated_cancel_world
    original = world["principal"]
    job = requests.accept_health_check(original, UID, "same-context-job")
    refreshed = _refresh(world["tokens"]["refresh_token"])
    assert refreshed[0] == 200, refreshed
    principal = oauth_store.resolve_oauth_access_token(refreshed[1]["access_token"])[0]
    assert authorization_context(original) == authorization_context(principal)

    cancelled = requests.cancel_job(principal, job["job_id"])
    replayed = requests.cancel_job(principal, job["job_id"])

    assert cancelled["status"] == replayed["status"] == "cancelled"
    assert replayed["result"] == cancelled["result"]
    assert replayed["replayed"] is True
    assert start_task(job["job_id"]) is None
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.command.cancelled'")
        == 1
    )


@pytest.mark.parametrize(
    ("operation", "original_grant"),
    [
        ("health_check", "library.health.run"),
        ("repair", "library.repair.photo_flag"),
    ],
)
@pytest.mark.parametrize("grant_source", ["caller", "stored"])
def test_cancel_requires_the_original_operation_grant(
    command_world, operation, original_grant, grant_source
):
    principal = command_world["principal"]
    if operation == "repair":
        _, plan = observed_plan(command_world)
        job = requests.accept_apply(
            principal, plan["plan_id"], plan["plan_version"], "original-grant"
        )
    else:
        job = requests.accept_health_check(principal, UID, "original-grant")
    if grant_source == "caller":
        principal = replace(principal, grants=principal.grants - {original_grant})
    else:
        change(
            "UPDATE agent_principals SET grants=array_remove(grants,:grant) WHERE id=:id",
            {"grant": original_grant, "id": principal.id},
        )

    with pytest.raises(DiagnosticError) as error:
        requests.cancel_job(principal, job["job_id"])

    assert error.value.code == "FORBIDDEN"
    assert (
        scalar("SELECT status FROM tasks WHERE id=:id", {"id": job["job_id"]})
        == "pending"
    )
    assert (
        scalar("SELECT result FROM agent_jobs WHERE task_id=:id", {"id": job["job_id"]})
        is None
    )
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.command.cancelled'")
        == 0
    )
    if operation == "repair":
        assert scalar("SELECT state FROM agent_repair_plans") == "queued"


def test_cancel_replay_revalidates_the_original_grant(command_world):
    principal = command_world["principal"]
    job = requests.accept_health_check(principal, UID, "cancel-before-revocation")
    cancelled = requests.cancel_job(principal, job["job_id"])
    change(
        "UPDATE agent_principals SET grants=array_remove(grants,'library.health.run') WHERE id=:id",
        {"id": principal.id},
    )

    with pytest.raises(DiagnosticError) as error:
        requests.cancel_job(principal, job["job_id"])

    assert error.value.code == "FORBIDDEN"
    assert (
        scalar("SELECT result FROM agent_jobs WHERE task_id=:id", {"id": job["job_id"]})
        == cancelled["result"]
    )
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.command.cancelled'")
        == 1
    )


@pytest.mark.parametrize(
    "kind", ["prepare_operation", "apply_operation", "agent_control"]
)
def test_legacy_cancel_rejects_catalog_jobs_outside_the_pilot(command_world, kind):
    principal = command_world["principal"]
    if kind == "agent_control":
        source = requests.accept_health_check(principal, UID, "control-source")
        job = operation_jobs.prepare_operation(
            principal,
            "job_cancel",
            {"job_id": source["job_id"], "scope": "own"},
            "catalog-control",
        )
    else:
        job = operation_jobs.prepare_operation(
            principal,
            "metadata_update",
            {"entity_uid": UID, "patch": {"bio": "New biography"}},
            "catalog-prepare",
        )
        if kind == "apply_operation":
            start_task(job["job_id"])
            result = operation_jobs.publish_plan(
                job["job_id"],
                {
                    "document": {
                        "operation": "metadata_update",
                        "targets": [{"entity_type": "artist", "entity_uid": UID}],
                        "changes": [
                            {"field": "bio", "before": None, "after": "New biography"}
                        ],
                        "impact": {"scope": "selected", "filesystem": False},
                        "risk": "safe",
                    },
                    "execution": {"target_keys": ["artist:" + UID]},
                },
            )
            plan = result["plan"]
            job = operation_jobs.apply_operation(
                principal,
                "metadata_update",
                plan["plan_id"],
                plan["plan_version"],
                "catalog-apply",
            )

    with pytest.raises(DiagnosticError) as error:
        requests.cancel_job(principal, job["job_id"])

    assert error.value.code == "NOT_EXECUTABLE"
    assert (
        scalar("SELECT status FROM tasks WHERE id=:id", {"id": job["job_id"]})
        == "pending"
    )
    assert (
        scalar("SELECT result FROM agent_jobs WHERE task_id=:id", {"id": job["job_id"]})
        is None
    )
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.command.cancelled'")
        == 0
    )
    if kind == "apply_operation":
        assert scalar("SELECT state FROM agent_repair_plans") == "queued"


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
    cancelled = requests.cancel_job(principal, job["job_id"])
    replayed = requests.cancel_job(principal, job["job_id"])
    assert cancelled["status"] == replayed["status"] == "cancelled"
    assert replayed["result"] == cancelled["result"]
    assert replayed["replayed"] is True
    assert start_task(job["job_id"]) is None
    assert scalar("SELECT state FROM agent_repair_plans") == "cancelled"
    assert scalar("SELECT has_photo FROM library_artists WHERE name='Echo'") == 0
    assert (
        requests.accept_apply(
            principal, plan["plan_id"], plan["plan_version"], "again"
        )["status"]
        == "cancelled"
    )
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.command.cancelled'")
        == 1
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
