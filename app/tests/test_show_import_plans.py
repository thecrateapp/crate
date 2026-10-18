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


def show_records():
    with read_scope() as session:
        return {
            table: [
                dict(row)
                for row in session.execute(
                    text(f"SELECT * FROM {table} ORDER BY {ordering}")
                ).mappings()
            ]
            for table, ordering in (
                ("shows", "id"),
                ("show_sources", "id"),
                ("show_source_aliases", "provider,event_id"),
                ("user_show_attendance", "id"),
                ("user_show_reminders", "id"),
            )
        }


def test_selection_rejects_two_corrections_of_the_same_physical_show(show_world):
    _, original = prepare(show_world)
    _, written = apply(show_world, original)
    show = written["execution"]["items"][0]
    _, plan = prepare(
        show_world,
        key="duplicate-corrections",
        candidates=[
            {
                **items()[0],
                "item_id": f"correction-{day}",
                "existing_show_id": show["show_id"],
                "expected_revision": show["revision"],
                "date": f"2027-03-0{day}",
            }
            for day in (3, 4)
        ],
    )
    assert plan["executable"] is False
    assert {issue["item_id"] for issue in plan["issues"]} == {
        "correction-3",
        "correction-4",
    }
    assert scalar("SELECT date::text FROM shows") == "2027-03-02"


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
    with pytest.raises(DiagnosticError) as wrong_operation:
        operations.prepare_operation(principal, "metadata_update", {}, "forbidden")
    assert wrong_operation.value.code == "FORBIDDEN"
    remote = create_credential(
        "Remote", ["library.health.read"], datetime.now(UTC) + timedelta(days=1)
    ).principal
    with pytest.raises(DiagnosticError) as denied:
        with transaction_scope() as session:
            requests._authorize(
                session,
                replace(remote, human_actor_id=show_world["user"]["id"]),
                {"curation.shows.write"},
            )
    assert denied.value.code == "FORBIDDEN"


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
    assert other_result["execution"]["items"][0]["status"] == "linked_source"
    assert scalar("SELECT count(*) FROM show_sources") == 2
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


@pytest.mark.parametrize(
    ("selected_lineup", "provider_lineup"),
    [
        (["Support"], ["Support", "Extra support"]),
        ([], ["Support"]),
        (["Support", "Extra support"], ["Support"]),
        (["Support"], ["Support tribute"]),
    ],
    ids=["extra-performer", "empty-selection", "missing-performer", "similar-name"],
)
def test_creation_plan_rejects_unreviewed_lineup_and_rolls_back_selection(
    show_world, selected_lineup, provider_lineup
):
    from crate.db.repositories.show_imports import read_show_job
    from crate.db.repositories.shows_attendance import attend_show, create_show_reminder
    from crate.db.repositories.shows_ticketmaster_upserts import upsert_show

    _, plan = prepare(
        show_world,
        candidates=[
            *items(item_id="other-date", date="2027-03-03"),
            *items(lineup=selected_lineup),
        ],
    )
    assert plan["executable"] is True
    assert all(change["before"] == {} for change in plan["changes"])
    assert plan["changes"][1]["after"]["lineup"] == selected_lineup
    show_id = upsert_show(
        "provider-after-preview",
        "External Band",
        "2027-03-02",
        venue="Sala Norte",
        city="Madrid",
        country_code="ES",
        lineup=provider_lineup,
        tickets_url="https://tickets.example/provider",
        doors_time="19:00",
    )
    assert attend_show(show_world["user"]["id"], show_id)
    assert create_show_reminder(show_world["user"]["id"], show_id, "day_before")
    before = show_records()
    invalidations = scalar(
        "SELECT count(*) FROM domain_event_outbox WHERE payload_json->>'source'='show_write'"
    )

    job, result = apply(show_world, plan)

    assert result["execution"]["status"] == "conflict", result
    assert result["execution"]["error_code"] == "PLAN_STALE"
    assert result["execution"]["items"] == [
        {"item_id": item_id, "status": "conflict", "code": "BATCH_NOT_APPLIED"}
        for item_id in ("other-date", "date-1")
    ]
    assert show_records() == before
    assert (
        scalar(
            "SELECT count(*) FROM domain_event_outbox WHERE payload_json->>'source'='show_write'"
        )
        == invalidations
    )
    replay = operations.apply_operation(
        show_world["principal"],
        "shows_import",
        plan["plan_id"],
        plan["plan_version"],
        "apply",
    )["data"]
    assert replay["job_id"] == job["job_id"]
    assert read_show_job(show_world["principal"], job["job_id"])["result"] == result
    assert show_records() == before


@pytest.mark.parametrize(
    ("selected_artist", "selected_lineup", "provider_artist", "provider_lineup"),
    [
        ("External Band", ["Support"], "External Band", ["Support"]),
        (
            "External Band",
            ["Support", "External Band", "Support"],
            "External Band",
            ["Support"],
        ),
        ("External Band", ["Support"], "Support", ["External Band"]),
        ("external   BAND", [" SUPPORT "], "External Band", ["Support"]),
        (" SUPPORT ", [" external   BAND "], "External Band", ["Support"]),
        ("External Band", None, "External Band", ["Support"]),
    ],
    ids=[
        "identical",
        "repeated-primary",
        "inverted-primary",
        "normalized",
        "normalized-inverted",
        "unselected-lineup",
    ],
)
def test_creation_plan_links_same_complete_lineup_and_replays_without_writes(
    show_world, selected_artist, selected_lineup, provider_artist, provider_lineup
):
    from crate.db.repositories.show_imports import read_show_job
    from crate.db.repositories.shows_attendance import attend_show, create_show_reminder
    from crate.db.repositories.shows_ticketmaster_upserts import upsert_show

    selection = {"artist_name": selected_artist}
    if selected_lineup is not None:
        selection["lineup"] = selected_lineup
    _, plan = prepare(show_world, candidates=items(**selection))
    assert plan["executable"] is True
    assert plan["changes"][0]["before"] == {}
    show_id = upsert_show(
        "same-lineup-after-preview",
        provider_artist,
        "2027-03-02",
        venue="Sala Norte",
        city="Madrid",
        country_code="ES",
        lineup=provider_lineup,
        tickets_url="https://tickets.example/provider",
        doors_time="19:00",
    )
    assert attend_show(show_world["user"]["id"], show_id)
    assert create_show_reminder(show_world["user"]["id"], show_id, "day_before")
    before = show_records()

    job, result = apply(show_world, plan)

    assert result["execution"]["status"] == "completed", result
    assert result["verification"]["status"] == "passed"
    assert result["execution"]["items"][0]["status"] == "linked_source"
    assert result["execution"]["items"][0]["show_id"] == show_id
    saved = show_records()
    assert len(saved["shows"]) == 1
    row = saved["shows"][0]
    assert row["artist_name"] == provider_artist
    assert {" ".join(name.lower().split()) for name in row["lineup"]} == {
        "external band",
        "support",
    }
    assert row["revision"] > before["shows"][0]["revision"]
    assert row["tickets_url"] == "https://tickets.example/provider"
    assert str(row["doors_time"])[:5] == "19:00"
    assert (
        row["field_provenance"]["tickets_url"]
        == before["shows"][0]["field_provenance"]["tickets_url"]
    )
    assert len(saved["show_sources"]) == 2
    assert saved["show_sources"][0] == before["show_sources"][0]
    assert saved["show_sources"][1]["provider"] == "manual"
    for table in ("show_source_aliases", "user_show_attendance", "user_show_reminders"):
        assert saved[table] == before[table]
    replay = operations.apply_operation(
        show_world["principal"],
        "shows_import",
        plan["plan_id"],
        plan["plan_version"],
        "apply",
    )["data"]
    assert replay["job_id"] == job["job_id"]
    assert read_show_job(show_world["principal"], job["job_id"])["result"] == result
    assert show_records() == saved


@pytest.mark.parametrize(
    "changed_after_review", [False, True], ids=["approved-removal", "stale-revision"]
)
def test_existing_lineup_removal_requires_its_reviewed_revision(
    show_world, changed_after_review
):
    from crate.db.repositories.shows_attendance import attend_show, create_show_reminder
    from crate.db.repositories.shows_ticketmaster_upserts import upsert_show

    provider = {
        "venue": "Sala Norte",
        "city": "Madrid",
        "country_code": "ES",
        "lineup": ["Support", "Extra support"],
        "tickets_url": "https://tickets.example/provider",
    }
    show_id = upsert_show("reviewed-lineup", "External Band", "2027-03-02", **provider)
    assert attend_show(show_world["user"]["id"], show_id)
    assert create_show_reminder(show_world["user"]["id"], show_id, "day_before")
    initial = show_records()
    _, plan = prepare(
        show_world,
        candidates=items(
            existing_show_id=show_id,
            expected_revision=initial["shows"][0]["revision"],
            lineup=["Support"],
        ),
    )
    assert plan["executable"] is True
    assert plan["changes"][0]["before"]["lineup"] == [
        "External Band",
        "Support",
        "Extra support",
    ]
    assert plan["changes"][0]["after"]["lineup"] == ["Support"]
    if changed_after_review:
        upsert_show(
            "reviewed-lineup",
            "External Band",
            "2027-03-02",
            **{**provider, "tickets_url": "https://tickets.example/changed"},
        )
    before = show_records()

    _, result = apply(show_world, plan)

    saved = show_records()
    if changed_after_review:
        assert result["execution"]["status"] == "conflict", result
        assert result["execution"]["error_code"] == "PLAN_STALE"
        assert saved == before
    else:
        assert result["verification"]["status"] == "passed", result
        assert result["execution"]["items"][0]["show_id"] == show_id
        assert saved["shows"][0]["lineup"] == ["External Band", "Support"]
        assert saved["shows"][0]["revision"] > before["shows"][0]["revision"]
        assert saved["shows"][0]["tickets_url"] == "https://tickets.example/provider"
        for table in (
            "show_source_aliases",
            "user_show_attendance",
            "user_show_reminders",
        ):
            assert saved[table] == before[table]
        upsert_show("reviewed-lineup", "External Band", "2027-03-02", **provider)
        assert show_records()["shows"][0]["lineup"] == ["External Band", "Support"]


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
        operations.apply_operation(
            show_world["principal"],
            "shows_import",
            plan["plan_id"],
            plan["plan_version"],
            "invalid-apply",
        )
    assert error.value.code == "NOT_EXECUTABLE"
    assert scalar("SELECT count(*) FROM shows") == 0


def test_atomic_result_is_durable_even_if_outer_worker_completion_is_interrupted(
    show_world, monkeypatch
):
    from crate.db.repositories import agent_operation_jobs as jobs
    from crate.db.repositories.show_imports import read_show_job

    _, plan = prepare(show_world)
    accepted = operations.apply_operation(
        show_world["principal"],
        "shows_import",
        plan["plan_id"],
        plan["plan_version"],
        "apply",
    )["data"]
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


def test_tour_preview_batches_artist_and_show_lookups(pg_db):
    from datetime import date, timedelta
    from sqlalchemy import event
    from crate.db.engine import get_engine
    from crate.db.repositories.show_imports import compile_show_import

    queries = []

    def observe(_conn, _cursor, statement, _params, _context, _many):
        if "FROM shows" in statement or "FROM library_artists" in statement:
            queries.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", observe)
    try:
        selected = [
            {
                **items()[0],
                "item_id": f"date-{index}",
                "date": str(date(2027, 3, 1) + timedelta(days=index)),
            }
            for index in range(50)
        ]
        compiled = compile_show_import(
            selected, {"provider": "manual", "actor": "test"}
        )
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert compiled["executable"] is True
    assert len(compiled["items"]) == 50
    assert len(queries) == 2


@pytest.mark.parametrize(
    ("times", "executable"),
    [([None, None], False), ([None, "20:00"], False), (["18:00", "21:00"], True)],
)
def test_selection_resolves_its_own_duplicate_or_uncertain_sessions(
    show_world, times, executable
):
    _, plan = prepare(
        show_world,
        candidates=[
            {**items(local_time=time)[0], "item_id": f"date-{index}"}
            for index, time in enumerate(times)
        ],
    )
    assert plan["executable"] is executable
    if not executable:
        assert any(issue["status"] == "conflict" for issue in plan["issues"])


def test_show_consolidation_requires_exact_plan_and_human_approval(show_world):
    from crate.db.repositories.show_identities import upsert_canonical_show
    from crate.db.repositories.agent_plans import get_plan
    from tests.agent_plan_support import decide

    original = upsert_canonical_show(
        items(local_time="18:00")[0], {"provider": "manual", "actor": "test"}
    )
    duplicate = upsert_canonical_show(
        items(local_time="21:00")[0], {"provider": "manual", "actor": "test"}
    )
    selection = {
        "canonical_show_id": original["show_id"],
        "duplicate_show_ids": [duplicate["show_id"]],
        "revisions": {
            str(original["show_id"]): original["revision"],
            str(duplicate["show_id"]): duplicate["revision"],
        },
    }
    accepted = operations.prepare_operation(
        show_world["principal"],
        "shows_import",
        {"consolidation": selection},
        "merge-preview",
    )["data"]
    result = execute(accepted)
    assert result["execution"]["status"] == "prepared", result
    plan = result["plan"]
    assert plan["approval_required"] is True
    with pytest.raises(DiagnosticError) as refused:
        operations.apply_operation(
            show_world["principal"],
            "shows_import",
            plan["plan_id"],
            plan["plan_version"],
            "merge-apply",
        )
    assert refused.value.code == "APPROVAL_REQUIRED"
    stored = get_plan(plan["plan_id"])
    reviewer = create_user("show-reviewer@example.test", role="admin")
    from uuid import uuid4
    from crate.db.repositories.auth_sessions import create_session

    reviewer["session_id"] = str(uuid4())
    create_session(
        reviewer["session_id"],
        reviewer["id"],
        datetime.now(UTC) + timedelta(days=1),
        app_id="admin-web",
    )
    decide(reviewer, stored)
    job = operations.apply_operation(
        show_world["principal"],
        "shows_import",
        plan["plan_id"],
        plan["plan_version"],
        "merge-apply",
    )["data"]
    applied = execute(job)
    assert applied["verification"]["status"] == "passed", applied
    assert applied["execution"]["items"][0]["show_id"] == original["show_id"]


def test_fifty_date_apply_uses_batched_reads_and_one_invalidation_set(
    show_world, monkeypatch
):
    import json
    from time import perf_counter
    from datetime import date
    from sqlalchemy import event
    from crate.db.engine import get_engine

    monkeypatch.setattr("crate.metrics.record_later", lambda *args, **kwargs: None)
    statements = []

    def read_count(conn, cursor, statement, parameters, context, executemany):
        if (
            statement.lstrip().upper().startswith(("SELECT", "WITH"))
            and "pg_advisory" not in statement
        ):
            statements.append(statement)

    engine = get_engine()

    def measured(count, month):
        candidates = [
            {
                **items()[0],
                "item_id": f"tour-{month}-{index}",
                "date": (date(2027, month, 1) + timedelta(days=index)).isoformat(),
            }
            for index in range(count)
        ]
        _, plan = prepare(show_world, candidates=candidates, key=f"preview-{month}")
        statements.clear()
        event.listen(engine, "before_cursor_execute", read_count)
        started = perf_counter()
        try:
            _, result = apply(show_world, plan, key=f"save-{month}")
        finally:
            event.remove(engine, "before_cursor_execute", read_count)
        assert result["verification"]["status"] == "passed", result
        assert len(result["execution"]["items"]) == count
        return {
            "selected_shows": count,
            "read_statements": len(statements),
            "elapsed_seconds": round(perf_counter() - started, 3),
        }

    baseline = measured(1, 6)
    before = scalar(
        "SELECT count(*) FROM domain_event_outbox WHERE event_type='ui.invalidate' AND payload_json->>'source'='show_write'"
    )
    batch = measured(50, 1)
    assert batch["read_statements"] <= baseline["read_statements"] + 2
    after = scalar(
        "SELECT count(*) FROM domain_event_outbox WHERE event_type='ui.invalidate' AND payload_json->>'source'='show_write'"
    )
    assert after - before == 3
    print(
        json.dumps({"single": baseline, "batch": batch, "batch_invalidation_events": 3})
    )


def test_exact_artist_resolution_normalizes_internal_whitespace_in_one_batch(pg_db):
    from crate.db.repositories.show_imports import compile_show_import

    pg_db.upsert_artist({"name": "AC  DC"})
    compiled = compile_show_import(
        items(artist_name="AC DC"), {"provider": "manual", "actor": "human"}
    )
    assert compiled["items"][0]["candidate"]["artist_name"] == "AC  DC"
    assert compiled["executable"]


def test_show_write_failure_rolls_back_batch_and_reports_each_item_privately(
    show_world, monkeypatch
):
    from crate.db.repositories import show_identities

    original = show_identities.upsert_canonical_show
    calls = 0

    def failing(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("PRIVATE DATABASE PARAMS")
        return original(*args, **kwargs)

    _, plan = prepare(
        show_world,
        candidates=[*items(), {**items(date="2027-03-04")[0], "item_id": "second"}],
    )
    monkeypatch.setattr(show_identities, "upsert_canonical_show", failing)
    _, result = apply(show_world, plan)
    assert scalar("SELECT count(*) FROM shows") == 0
    assert len(result["execution"]["items"]) == 2
    assert {row["status"] for row in result["execution"]["items"]} == {"failed"}
    assert "PRIVATE DATABASE PARAMS" not in str(result)


def test_ambiguous_artist_names_offer_uids_and_explicit_uid_resolves_selection(pg_db):
    from crate.db.repositories.show_imports import compile_show_import

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists(name,entity_uid) VALUES('Band',gen_random_uuid()),('BAND',gen_random_uuid())"
            )
        )
    unresolved = compile_show_import(
        items(artist_name="band"), {"provider": "manual", "actor": "human"}
    )
    assert unresolved["executable"] is False
    matches = next(
        issue["artist_matches"]
        for issue in unresolved["issues"]
        if issue.get("artist_matches")
    )
    assert len(matches) == 2
    selected = compile_show_import(
        items(artist_name="band", artist_uid=matches[0]["artist_uid"]),
        {"provider": "manual", "actor": "human"},
    )
    assert selected["executable"] is True
    assert selected["items"][0]["candidate"]["artist_name"] == matches[0]["name"]
