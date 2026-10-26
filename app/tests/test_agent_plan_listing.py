"""Plan listing orders newest first and names the connection, risk and expiry."""

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from crate.agent_access import authorization_context
from crate.api.agent_plans import router
from crate.api.permissions import ROLE_CAPABILITIES
from crate.db.repositories import agent_plans as plans
from crate.db.repositories.agent_requests import _hash
from crate.db.repositories.auth_user_roles import set_user_roles

from tests.agent_command_fixtures import change
from tests.test_agent_admin import ORIGIN, human_token
from tests.test_agent_plan_approvals import pending_plan

pytest_plugins = ["tests.agent_command_fixtures", "tests.test_agent_admin"]


def plan_document(operation="shows_import", targets=1, risk="safe"):
    return {
        "operation": operation,
        "targets": [
            {"entity_type": "show", "name": f"s{i}", "label": f"Show {i}"}
            for i in range(targets)
        ],
        "changes": [],
        "impact": {},
        "risk": risk,
        "reversibility": "new_plan_required",
    }


def insert_plan(
    world,
    *,
    created_at,
    expires_at,
    state="awaiting_approval",
    operation="shows_import",
    targets=1,
    risk="safe",
):
    plan_id = str(uuid4())
    document = plan_document(operation, targets, risk)
    change(
        """INSERT INTO agent_repair_plans (id, principal_id, version, operation, document,
               state, approval_required, created_at, expires_at)
           VALUES (:id, :principal, :version, :operation, CAST(:document AS jsonb),
               :state, TRUE, :created, :expires)""",
        {
            "id": plan_id,
            "principal": world["principal"].id,
            "version": "a" * 64,
            "operation": operation,
            "document": json.dumps(document),
            "state": state,
            "created": created_at,
            "expires": expires_at,
        },
    )
    return plan_id


def test_list_is_newest_first_and_pages_without_gaps_or_duplicates(command_world):
    now = datetime.now(UTC)
    created_ats = [now - timedelta(minutes=m) for m in (3, 0, 4, 1, 2)]
    shared = now - timedelta(minutes=5)
    created_ats += [shared, shared]
    inserted = [
        (
            created_at,
            insert_plan(
                command_world,
                created_at=created_at,
                expires_at=now + timedelta(minutes=30),
            ),
        )
        for created_at in created_ats
    ]
    expected = [
        plan_id
        for _created_at, plan_id in sorted(
            inserted, key=lambda row: (row[0], row[1]), reverse=True
        )
    ]

    collected = []
    cursor = None
    while True:
        rows = plans.list_plans(limit=4, before=cursor)
        page = rows[:3]
        collected.extend(row["plan_id"] for row in page)
        if len(rows) < 4:
            break
        cursor = page[2]["plan_id"]

    assert collected == expected
    assert len(set(collected)) == 7


def test_rows_name_the_connection_and_summarise_targets_risk_and_expiry(command_world):
    now = datetime.now(UTC)
    insert_plan(
        command_world,
        created_at=now,
        expires_at=now - timedelta(minutes=1),
        targets=3,
        risk="caution",
    )
    row = plans.list_plans()[0]
    assert row["integration_name"] == "Command agent"
    assert row["integration_kind"] == "service"
    assert row["target_count"] == 3
    assert row["risk"] == "caution"
    assert row["expired"] is True


def test_pending_view_holds_only_unexpired_awaiting_plans(command_world):
    now = datetime.now(UTC)
    awaiting_unexpired = insert_plan(
        command_world,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
        state="awaiting_approval",
    )
    awaiting_expired = insert_plan(
        command_world,
        created_at=now - timedelta(minutes=1),
        expires_at=now - timedelta(minutes=1),
        state="awaiting_approval",
    )
    applied = insert_plan(
        command_world,
        created_at=now - timedelta(minutes=2),
        expires_at=now + timedelta(minutes=30),
        state="applied",
    )

    pending_ids = {row["plan_id"] for row in plans.list_plans(view="pending")}
    history_ids = {row["plan_id"] for row in plans.list_plans(view="history")}

    assert pending_ids == {awaiting_unexpired}
    assert history_ids == {awaiting_expired, applied}


def test_photo_flag_rows_count_one_target_with_low_risk(command_world):
    plan = pending_plan(command_world)
    row = next(row for row in plans.list_plans() if row["plan_id"] == plan["plan_id"])
    assert row["target_count"] == 1
    assert row["risk"] == "low"
    assert row["expired"] is False


def test_count_pending_plans_respects_visible_operations(command_world):
    now = datetime.now(UTC)
    insert_plan(
        command_world,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
        state="awaiting_approval",
        operation="shows_import",
    )
    insert_plan(
        command_world,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
        state="awaiting_approval",
        operation="repairs",
    )

    assert plans.count_pending_plans(operations=["shows_import"]) == 1
    assert plans.count_pending_plans(operations=["shows_import", "repairs"]) == 2
    assert plans.count_pending_plans(operations=[]) == 0


def test_http_summary_counts_pending_plans_visible_to_the_reviewer(
    command_world, human_actor, monkeypatch
):
    now = datetime.now(UTC)
    shows_plan_id = insert_plan(
        command_world,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
        operation="shows_import",
    )
    insert_plan(
        command_world,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
        operation="repairs",
    )

    app = FastAPI()
    app.include_router(router)
    with TestClient(app, base_url="https://api.example.test") as client:
        client.cookies.set("crate_session", human_token(human_actor))
        client.headers["Origin"] = ORIGIN

        summary = client.get("/api/admin/agent-plans/summary")
        assert summary.status_code == 200
        assert summary.json() == {"awaiting_approval": 2}
        assert summary.headers["Cache-Control"] == "no-store"

        monkeypatch.setitem(
            ROLE_CAPABILITIES,
            "ops",
            (*ROLE_CAPABILITIES["ops"], "agents.plans.review", "curation.shows.write"),
        )
        set_user_roles(human_actor["id"], ["ops"])

        restricted = client.get("/api/admin/agent-plans/summary")
        assert restricted.status_code == 200
        assert restricted.json() == {"awaiting_approval": 1}

        pending = client.get("/api/admin/agent-plans?view=pending")
        assert pending.status_code == 200
        assert {row["plan_id"] for row in pending.json()["items"]} == {shows_plan_id}


def test_http_rejects_unknown_view(command_world, human_actor):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app, base_url="https://api.example.test") as client:
        client.cookies.set("crate_session", human_token(human_actor))
        client.headers["Origin"] = ORIGIN
        response = client.get("/api/admin/agent-plans?view=everything")
        assert response.status_code == 422


def test_plan_document_names_connection_and_requester(command_world, human_actor):
    # identity=True simulates the Admin detail route (GET /api/admin/agent-plans/{plan_id}),
    # the only caller allowed to see who requested a plan.
    plan = pending_plan(command_world)
    document = plans.get_plan(plan["plan_id"], identity=True)
    assert document["integration_name"] == "Command agent"
    assert document["integration_kind"] == "service"
    assert document["requester_name"] is None

    change("UPDATE users SET name='Operator' WHERE id=:id", {"id": human_actor["id"]})
    change(
        """UPDATE agent_repair_plans
               SET authorization_context = jsonb_build_object('human_actor_id', CAST(:uid AS int))
             WHERE id=:id""",
        {"uid": human_actor["id"], "id": plan["plan_id"]},
    )

    updated = plans.get_plan(plan["plan_id"], identity=True)
    assert updated["requester_name"] == "Operator"


def test_identity_fields_do_not_change_review_hashes(command_world):
    now = datetime.now(UTC)
    plan_id = insert_plan(
        command_world, created_at=now, expires_at=now + timedelta(minutes=30)
    )

    got = plans.get_plan(plan_id, identity=True)
    assert got["integration_name"] == "Command agent"
    assert got["integration_kind"] == "service"
    assert got["requester_name"] is None
    assert got["content_hash"] == _hash(
        {
            **plan_document(),
            "authorization_context": {},
            "policy_revision": 1,
            "approval_required": True,
            "expires_at": got["expires_at"],
        }
    )


def test_agent_facing_plan_reads_do_not_expose_identity_fields(human_actor):
    # A human-owned plan (the show-editor principal pattern used by
    # app/crate/api/show_imports.py) is the realistic case where authorization_context
    # names a human requester: agent_requests._authorize requires human_actor_id to
    # belong to a genuine kind='human' principal (authorize_show_editor), so a plain
    # service principal (e.g. command_world["principal"]) can never carry one. This
    # exercises the same get_owned_plan() path used by every agent-facing MCP reader.
    from crate.db.repositories.show_editor_access import get_show_editor_principal

    change("UPDATE users SET name='Operator' WHERE id=:id", {"id": human_actor["id"]})
    principal = get_show_editor_principal(human_actor["id"])

    now = datetime.now(UTC)
    plan_id = insert_plan(
        {"principal": principal}, created_at=now, expires_at=now + timedelta(minutes=30)
    )
    change(
        "UPDATE agent_repair_plans SET required_grants = ARRAY['curation.shows.write']::text[] WHERE id=:id",
        {"id": plan_id},
    )
    change(
        "UPDATE agent_repair_plans SET authorization_context = CAST(:context AS jsonb) WHERE id=:id",
        {"context": json.dumps(authorization_context(principal)), "id": plan_id},
    )

    owned = plans.get_owned_plan(principal, plan_id)
    assert "integration_name" not in owned
    assert "integration_kind" not in owned
    assert "requester_name" not in owned
    assert "Operator" not in json.dumps(owned, default=str)
