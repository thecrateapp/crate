"""Plan listing orders newest first and names the connection, risk and expiry."""

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from crate.db.repositories import agent_plans as plans

from tests.agent_command_fixtures import change
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
