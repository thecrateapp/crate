"""Admin and MCP use the same exact plans, authority and accepted-job ledger."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from crate import agent_library_operations as operations
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.auth_user_accounts import create_user
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope, transaction_scope


def items(**changes):
    return [
        {
            "item_id": "date-1",
            "artist_name": "External Band",
            "date": "2027-03-02",
            "venue": "Sala Norte",
            "city": "Madrid",
            "country_code": "ES",
            **changes,
        }
    ]


@pytest.fixture
def show_world(pg_db, monkeypatch):
    from crate.db.repositories.show_imports import get_show_editor_principal

    user = create_user("shows-editor@example.test", role="curator")
    monkeypatch.setenv("CRATE_MCP_ENABLED", "false")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "false")
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_shared.publish_tasks_surface_signal", lambda: None
    )
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    return {"user": user, "principal": get_show_editor_principal(user["id"])}


def execute(job):
    start_task(job["job_id"])
    return operations.execute_operation_job(job["job_id"], {})


def prepare(world, *, key="prepare", candidates=None):
    accepted = operations.prepare_operation(
        world["principal"], "shows_import", {"candidates": candidates or items()}, key
    )["data"]
    result = execute(accepted)
    assert result["execution"]["status"] == "prepared", result
    return accepted, result["plan"]


def apply(world, plan, *, key="apply"):
    accepted = operations.apply_operation(
        world["principal"], "shows_import", plan["plan_id"], plan["plan_version"], key
    )["data"]
    return accepted, execute(accepted)


def scalar(sql):
    with read_scope() as session:
        return session.execute(text(sql)).scalar_one()


def test_admin_show_plan_works_without_mcp_flags_or_llm_and_replays_durable_ids(
    show_world,
):
    from crate.db.repositories.show_imports import (
        get_show_editor_principal,
        read_show_job,
    )

    accepted, plan = prepare(show_world)
    assert scalar("SELECT count(*) FROM shows") == 0
    job, result = apply(show_world, plan)
    assert result["verification"]["status"] == "passed", result
    assert result["execution"]["items"][0]["status"] == "created"
    show_id = result["execution"]["items"][0]["show_id"]
    fresh = get_show_editor_principal(show_world["user"]["id"])
    replay = operations.apply_operation(
        fresh, "shows_import", plan["plan_id"], plan["plan_version"], "apply"
    )["data"]
    assert replay["job_id"] == job["job_id"]
    assert (
        read_show_job(fresh, job["job_id"])["result"]["execution"]["items"][0][
            "show_id"
        ]
        == show_id
    )
    assert scalar("SELECT count(*) FROM shows") == 1
    with pytest.raises(DiagnosticError, match="Idempotency"):
        operations.prepare_operation(
            fresh,
            "shows_import",
            {"candidates": items(venue="Another Venue")},
            "prepare",
        )
    assert scalar("SELECT count(*) FROM library_artists") == 0


def test_human_editor_is_not_a_remote_credential_and_cannot_run_other_operations(
    show_world,
):
    from crate.db.repositories.agent_credentials import (
        create_credential,
        list_credentials,
    )
    from crate.db.repositories import agent_requests as requests

    principal = show_world["principal"]
    assert principal.id not in {row["principal_id"] for row in list_credentials()}
    with pytest.raises(DiagnosticError):
        operations.prepare_operation(principal, "metadata_update", {}, "forbidden")
    remote = create_credential(
        "Remote", ["library.health.read"], datetime.now(UTC) + timedelta(days=1)
    ).principal
    with transaction_scope() as session, pytest.raises(DiagnosticError):
        requests._authorize(
            session,
            replace(remote, human_actor_id=show_world["user"]["id"]),
            {"curation.shows.write"},
        )


def test_worker_rechecks_human_permissions_before_any_show_write(show_world):
    _, plan = prepare(show_world)
    queued = operations.apply_operation(
        show_world["principal"],
        "shows_import",
        plan["plan_id"],
        plan["plan_version"],
        "apply",
    )["data"]
    set_user_roles(show_world["user"]["id"], ["user"])
    result = execute(queued)
    assert result["execution"]["error_code"] == "FORBIDDEN"
    assert scalar("SELECT count(*) FROM shows") == 0


def test_two_editors_recheck_new_identity_without_creating_duplicate_rows(show_world):
    from crate.db.repositories.show_imports import get_show_editor_principal

    other = create_user("other-editor@example.test", role="curator")
    second = {"principal": get_show_editor_principal(other["id"])}
    _, first_plan = prepare(show_world)
    _, other_plan = prepare(second)
    _, first_result = apply(show_world, first_plan)
    _, other_result = apply(second, other_plan)
    assert (
        first_result["execution"]["items"][0]["show_id"]
        == other_result["execution"]["items"][0]["show_id"]
    )
    assert other_result["execution"]["items"][0]["status"] == "already_exists"
    assert scalar("SELECT count(*) FROM shows") == 1


def test_changed_show_blocks_entire_exact_selection(show_world):
    from crate.db.repositories.shows_ticketmaster_upserts import upsert_show

    _, first_plan = prepare(show_world)
    apply(show_world, first_plan)
    _, edited = prepare(
        show_world,
        key="edit",
        candidates=[
            *items(local_time="20:00"),
            {**items()[0], "item_id": "date-2", "date": "2027-03-03"},
        ],
    )
    upsert_show(
        "tm-new-source",
        "External Band",
        "2027-03-02",
        venue="Sala Norte",
        city="Madrid",
    )
    _, result = apply(show_world, edited, key="edit-apply")
    assert result["execution"]["status"] == "conflict"
    assert scalar("SELECT count(*) FROM shows") == 1


def test_private_show_job_is_scoped_to_its_current_human_owner(show_world):
    from crate.db.repositories.show_imports import (
        get_show_editor_principal,
        read_show_job,
    )

    accepted, _ = prepare(show_world)
    other = create_user("other@example.test", role="curator")
    with pytest.raises(DiagnosticError):
        read_show_job(get_show_editor_principal(other["id"]), accepted["job_id"])


def test_unresolved_draft_can_be_reviewed_but_cannot_be_accepted_for_apply(show_world):
    _, plan = prepare(show_world, candidates=items(date=None))
    assert plan["executable"] is False
    assert plan["issues"][0]["missing"] == ["date"]
    with pytest.raises(DiagnosticError) as error:
        operations.apply_operation(show_world["principal"], "shows_import", plan["plan_id"], plan["plan_version"], "invalid-apply")
    assert error.value.code == "NOT_EXECUTABLE"
    assert scalar("SELECT count(*) FROM shows") == 0


def test_atomic_result_is_durable_even_if_outer_worker_completion_is_interrupted(show_world, monkeypatch):
    from crate.db.repositories import agent_operation_jobs as jobs
    from crate.db.repositories.show_imports import read_show_job

    _, plan = prepare(show_world)
    accepted = operations.apply_operation(show_world["principal"], "shows_import", plan["plan_id"], plan["plan_version"], "apply")["data"]
    original = jobs.finish_operation

    def lost_outer_completion(*args, **kwargs):
        if kwargs.get("session") is not None:
            return original(*args, **kwargs)
        raise RuntimeError("worker connection interrupted after the atomic commit")

    monkeypatch.setattr(jobs, "finish_operation", lost_outer_completion)
    with pytest.raises(RuntimeError):
        execute(accepted)
    durable = read_show_job(show_world["principal"], accepted["job_id"])
    assert durable["status"] == "completed"
    assert durable["result"]["execution"]["items"][0]["show_id"] > 0
    assert scalar("SELECT count(*) FROM shows") == 1
