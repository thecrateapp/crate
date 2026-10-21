"""Real transactions: exact native identity, page gates, replay and admission."""

import hashlib
import hmac
import json
from dataclasses import replace
from uuid import uuid4

import pytest
from crate.agent_diagnostics import DiagnosticError
from crate.agent_telegram import CALLBACK_PATH, plan_pages, verify_transport
from crate.db.repositories import agent_operation_jobs as jobs
from crate.db.repositories import agent_requests as requests
from crate.db.repositories import agent_telegram as store
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.repositories.tasks_updates import start_task
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.agent_command_fixtures import UID, change, scalar
from tests.test_agent_admin import ORIGIN, human_token

pytest_plugins = [
    "tests.agent_command_fixtures",
    "tests.test_agent_admin",
    "tests.test_mcp_actions",
]


def event(kind, **values):
    return store.native_event(
        {"kind": kind, "instance_id": "test-instance", **values}, uuid4().hex
    )


@pytest.fixture
def native_world(command_world, human_actor, monkeypatch):
    monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "test-instance")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    principal = command_world["principal"]
    change(
        "UPDATE agent_principals SET require_approval=TRUE WHERE id=:id",
        {"id": principal.id},
    )
    binding = store.bind_human(human_actor, principal.id, 123)
    prepared = jobs.prepare_operation(
        principal, "metadata_update", {}, "native-prepare"
    )
    start_task(prepared["job_id"])
    result = jobs.publish_plan(
        prepared["job_id"],
        {
            "document": {
                "operation": "metadata_update",
                "targets": [{"entity_uid": UID}],
                "changes": [{"field": "bio", "before": "old", "after": "new" * 4000}],
                "impact": {"cost": 0},
                "preconditions": {"revision": "a"},
            },
            "execution": {"target_keys": ["artist:" + UID]},
        },
    )
    return {
        **command_world,
        "human": human_actor,
        "plan": result["plan"],
        "binding": binding,
    }


def request(world, apply=True):
    plan = world["plan"]
    return store.request_confirmation(
        world["principal"],
        plan["plan_id"],
        plan["plan_version"],
        apply_after_approval=apply,
    )


def button(cid, message, action, **overrides):
    return event(
        "callback",
        confirmation_id=cid,
        action=action,
        **(
            {
                "chat_id": 123,
                "chat_type": "private",
                "message_id": message,
                "user_id": 123,
                "update_id": message * 10 + (1 if action == "next" else 2),
                "query_id": uuid4().hex,
            }
            | overrides
        ),
    )


def show_all(world):
    confirmation = request(world)
    for i in range(confirmation["page_count"]):
        page = event("pending")
        assert page["page_index"] == i
        ack = event(
            "delivered",
            confirmation_id=confirmation["confirmation_id"],
            chat_id=123,
            message_id=i + 1,
            page_index=i,
        )
        assert ack["last_page"] == (i + 1 == confirmation["page_count"])
        if not ack["last_page"]:
            with pytest.raises(DiagnosticError, match="Every exact plan page"):
                button(confirmation["confirmation_id"], i + 1, "approve")
            button(confirmation["confirmation_id"], i + 1, "next")
    return confirmation, confirmation["page_count"]


def test_native_multi_page_approval_atomically_admits_exact_operation(native_world):
    confirmation, message = show_all(native_world)
    result = button(confirmation["confirmation_id"], message, "approve")
    assert result["state"] == "approved"
    assert result["job"]["status"] == "pending"
    assert scalar("SELECT count(*) FROM agent_plan_approvals") == 1
    assert (
        scalar(
            "SELECT credential_id::text FROM agent_jobs WHERE task_id=:id",
            {"id": result["job"]["job_id"]},
        )
        == native_world["principal"].credential_id
    )
    assert (
        scalar(
            "SELECT idempotency_key FROM agent_requests WHERE task_id=:id",
            {"id": result["job"]["job_id"]},
        )
        == "telegram:" + confirmation["confirmation_id"]
    )
    with pytest.raises(DiagnosticError):
        button(confirmation["confirmation_id"], message, "approve", update_id=999)
    assert scalar("SELECT count(*) FROM agent_jobs") == 2
    start_task(result["job"]["job_id"])
    jobs.load_operation_job(result["job"]["job_id"])
    change("UPDATE agent_telegram_bindings SET revoked_at=NOW()")
    with pytest.raises(DiagnosticError, match="linked native human"):
        jobs.start_operation_effect(result["job"]["job_id"])


@pytest.mark.parametrize(
    "mutation", ["role", "binding", "plan", "execution", "policy", "expired", "grant"]
)
def test_changed_authority_or_exact_plan_cannot_approve(native_world, mutation):
    confirmation, message = show_all(native_world)
    if mutation == "role":
        set_user_roles(native_world["human"]["id"], ["librarian"])
    else:
        change(
            {
                "binding": "UPDATE agent_telegram_bindings SET revoked_at=NOW()",
                "plan": "UPDATE agent_repair_plans SET document=jsonb_set(document,'{changes}','[]')",
                "execution": "UPDATE agent_repair_plans SET execution_data='{}'::jsonb",
                "policy": "UPDATE agent_principals SET require_approval=FALSE,policy_revision=policy_revision+1",
                "expired": "UPDATE agent_telegram_confirmations SET expires_at=NOW()-INTERVAL '1 second'",
                "grant": "UPDATE agent_principals SET grants=ARRAY['ops.jobs.read']",
            }[mutation]
        )
    if mutation == "expired":
        assert (
            button(confirmation["confirmation_id"], message, "approve")["state"]
            == "expired"
        )
    else:
        with pytest.raises(DiagnosticError):
            button(confirmation["confirmation_id"], message, "approve")
    assert scalar("SELECT count(*) FROM agent_plan_approvals") == 0
    assert scalar("SELECT count(*) FROM agent_jobs") == 1


@pytest.mark.parametrize(
    "overrides",
    [{"user_id": 124}, {"chat_id": 124}, {"chat_type": "group"}, {"message_id": 999}],
)
def test_native_wrong_identity_or_message_rejected(native_world, overrides):
    confirmation, message = show_all(native_world)
    with pytest.raises(DiagnosticError):
        button(confirmation["confirmation_id"], message, "approve", **overrides)
    assert scalar("SELECT count(*) FROM agent_plan_approvals") == 0


def test_rejection_and_consumed_receipts_survive_new_transport_nonce(native_world):
    cid = request(native_world)["confirmation_id"]
    event("delivered", confirmation_id=cid, chat_id=123, message_id=1, page_index=0)
    args = {
        "kind": "callback",
        "instance_id": "test-instance",
        "confirmation_id": cid,
        "chat_id": 123,
        "chat_type": "private",
        "message_id": 1,
        "user_id": 123,
        "action": "reject",
        "query_id": "once",
        "update_id": 99,
    }
    assert store.native_event(args, uuid4().hex)["state"] == "rejected"
    with pytest.raises(DiagnosticError, match="already been consumed"):
        store.native_event(args, uuid4().hex)
    assert scalar("SELECT count(*) FROM agent_jobs") == 1


def test_revoked_origin_preserves_decision_without_admitting_job(native_world):
    cid, message = show_all(native_world)
    change("UPDATE agent_credentials SET revoked_at=NOW()")
    result = button(cid["confirmation_id"], message, "approve")
    assert result["state"] == "approved_apply_unavailable"
    assert result["reason"] == "FORBIDDEN"
    assert scalar("SELECT count(*) FROM agent_plan_approvals") == 1
    assert scalar("SELECT count(*) FROM agent_jobs") == 1


def test_confirmation_cannot_switch_origin_or_apply_choice(native_world):
    request(native_world)
    with pytest.raises(DiagnosticError):
        request(native_world, apply=False)
    principal = replace(native_world["principal"], id=str(uuid4()))
    with pytest.raises(DiagnosticError):
        store.request_confirmation(
            principal,
            native_world["plan"]["plan_id"],
            native_world["plan"]["plan_version"],
        )


def test_legacy_policy_is_current_at_admission_and_worker_effect(command_world):
    principal = command_world["principal"]
    job = requests.accept_health_check(principal, UID, "legacy")
    change("UPDATE agent_principals SET require_approval=TRUE")
    for call in (
        lambda: requests.accept_health_check(principal, UID, "bypass"),
        lambda: requests.retry_job(principal, job["job_id"], "retry"),
        lambda: requests.cancel_job(principal, job["job_id"]),
    ):
        with pytest.raises(DiagnosticError) as caught:
            call()
        assert caught.value.code == "APPROVAL_REQUIRED"
    start_task(job["job_id"])
    with pytest.raises(DiagnosticError) as caught:
        requests.load_job_for_execution(job["job_id"])
    assert caught.value.code == "APPROVAL_REQUIRED"
    change("UPDATE agent_principals SET require_approval=FALSE")
    assert (
        requests.load_job_for_execution(job["job_id"])["operation"]
        == "run_health_check"
    )


def test_pages_are_lossless_bounded_plain_json():
    original = {"targets": ["é😀<&>\u202e" * 3000], "changes": ["last target"]}
    pages = plan_pages(original, apply_after_approval=True)
    assert len(pages) > 1
    assert all(len(page.encode()) <= 3200 for page in pages)
    assert "\u202e" not in "".join(pages)
    assert json.loads("".join(pages))["exact_plan"] == original


def signed(body, now=1800000000, key=b"synthetic-native-key-32-bytes-long"):
    headers = {"x-crate-timestamp": str(now), "x-crate-nonce": "a" * 32}
    headers["x-crate-signature"] = hmac.new(
        key,
        b"POST\n"
        + CALLBACK_PATH.encode()
        + b"\n"
        + str(now).encode()
        + b"\n"
        + b"a" * 32
        + b"\n"
        + body,
        hashlib.sha256,
    ).hexdigest()
    return headers


def test_hmac_binds_exact_body_timestamp_nonce_and_fixed_path():
    key, body = b"synthetic-native-key-32-bytes-long", b'{"kind":"pending"}'
    headers = signed(body)
    assert verify_transport(body, headers, key, now=1800000000) == "a" * 32
    for payload, hdrs, at in (
        (body + b" ", headers, 1800000000),
        (body, headers, 1800000061),
        (body, {**headers, "x-crate-nonce": "b" * 32}, 1800000000),
    ):
        with pytest.raises(DiagnosticError):
            verify_transport(payload, hdrs, key, now=at)


def test_http_rejects_bearer_forgery_plain_yes_and_allows_admin_binding(
    native_world, tmp_path, monkeypatch
):
    import time

    from crate.api.agent_telegram import router

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    assert (
        client.post(
            CALLBACK_PATH,
            json={"action": "yes"},
            headers={"Authorization": "Bearer synthetic"},
        ).status_code
        == 403
    )
    assert client.post(CALLBACK_PATH, json={"action": "approve"}).status_code == 403
    keyfile = tmp_path / "key"
    keyfile.write_bytes(b"synthetic-native-key-32-bytes-long")
    monkeypatch.setenv("CRATE_TELEGRAM_KEY_FILE", str(keyfile))
    body = json.dumps({"kind": "pending", "instance_id": "test-instance"}).encode()
    assert (
        client.post(
            CALLBACK_PATH, content=body, headers=signed(body, int(time.time()))
        ).status_code
        == 200
    )
    assert (
        client.post(
            CALLBACK_PATH, content=body, headers=signed(body, int(time.time()))
        ).status_code
        == 403
    )
    cookie = human_token(native_world["human"])
    response = client.post(
        "/api/admin/agent-telegram/bind",
        json={"principal_id": native_world["principal"].id, "telegram_user_id": 456},
        headers={"Origin": ORIGIN, "Cookie": "crate_session=" + cookie},
    )
    assert response.status_code == 200
    assert response.json()["telegram_user_id"] == 456


def test_terminal_outcome_has_durable_bounded_delivery(native_world):
    cid, message = show_all(native_world)
    button(cid["confirmation_id"], message, "reject")
    outcome = event("pending")
    assert outcome["state"] == "outcome"
    assert outcome["result"]["state"] == "rejected"
    assert event("pending")["state"] == "idle"  # retry backoff
    change("UPDATE agent_telegram_confirmations SET next_delivery_at=NOW()")
    assert event("pending")["confirmation_id"] == cid["confirmation_id"]
    event(
        "outcome_delivered",
        confirmation_id=cid["confirmation_id"],
        chat_id=123,
        message_id=99,
    )
    assert event("pending")["state"] == "idle"


def test_policy_discovery_is_current_and_read_only(native_world):
    policy = store.approval_policy(native_world["principal"])
    assert policy["require_approval"] is True
    assert policy["credential_id"] == native_world["principal"].credential_id
    change("UPDATE agent_principals SET require_approval=FALSE")
    assert store.approval_policy(native_world["principal"])["require_approval"] is False
    with pytest.raises(DiagnosticError):
        request(native_world)
    assert scalar("SELECT count(*) FROM agent_telegram_confirmations") == 0


def test_mcp_confirmation_is_not_exposed_to_pilot_and_has_no_decision_schema(
    native_world, monkeypatch
):
    from crate.agent_access import AgentPrincipal
    from crate.agent_telegram import request_plan_confirmation
    from crate.mcp.tools import ACTION_CATALOG, _allowed

    pilot = AgentPrincipal(
        "id",
        "cred",
        "pilot",
        frozenset(
            {
                "library.health.read",
                "ops.status.read",
                "ops.jobs.read",
                "ops.logs.read",
                "ops.audit.read",
                "ops.schedules.read",
                "ops.runtime.read",
            }
        ),
    )
    assert not _allowed(pilot, "request_plan_confirmation")
    assert not _allowed(pilot, "get_confirmation_policy")
    schema = ACTION_CATALOG["request_plan_confirmation"][0].model_json_schema()
    assert set(schema["properties"]) == {
        "plan_id",
        "plan_version",
        "apply_after_approval",
    }
    assert schema["additionalProperties"] is False
    plan = native_world["plan"]
    result = request_plan_confirmation(
        native_world["principal"], plan["plan_id"], plan["plan_version"]
    )
    assert result["data"]["state"] == "pending"


def test_native_migration_is_linear_and_openapi_uses_separate_security():
    import importlib.util
    from pathlib import Path

    from crate.api.agent_telegram import router

    path = (
        Path(__file__).parents[1] / "crate/db/migrations/versions/133_agent_telegram.py"
    )
    spec = importlib.util.spec_from_file_location("migration133", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert (migration.revision, migration.down_revision) == ("133", "132")
    app = FastAPI()
    app.include_router(router)
    schema = app.openapi()
    assert schema["paths"][CALLBACK_PATH]["post"]["security"] == [
        {"nativeTelegramHmac": []}
    ]
    assert schema["paths"]["/api/admin/agent-telegram/bind"]["post"]["security"] == [
        {"cookieAuth": []}
    ]


def test_concurrent_native_decisions_only_admit_one_job(native_world):
    from concurrent.futures import ThreadPoolExecutor

    cid, message = show_all(native_world)

    def attempt(update):
        try:
            return button(cid["confirmation_id"], message, "approve", update_id=update)[
                "state"
            ]
        except DiagnosticError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(attempt, [10001, 10002]))
    assert sorted(outcomes) == ["STATE_CONFLICT", "approved"]
    assert scalar("SELECT count(*) FROM agent_plan_approvals") == 1
    assert scalar("SELECT count(*) FROM agent_jobs") == 2


def test_worker_native_approval_is_invalid_after_instance_change(
    native_world, monkeypatch
):
    cid, message = show_all(native_world)
    result = button(cid["confirmation_id"], message, "approve")
    start_task(result["job"]["job_id"])
    monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "another-instance")
    with pytest.raises(DiagnosticError, match="linked native human"):
        jobs.start_operation_effect(result["job"]["job_id"])


def test_sdk_policy_and_presentation_request_use_valid_output_and_real_store(
    native_world, action_transport
):
    import asyncio

    from tests.test_mcp_actions import _client

    app, token, _principal, credentials, _admission = action_transport
    credentials[token] = native_world["principal"]

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            policy = await client.call_tool("get_confirmation_policy", {})
            assert not policy.is_error
            assert policy.structured_content["data"]["require_approval"] is True
            confirmation = await client.call_tool(
                "request_plan_confirmation",
                {
                    "plan_id": native_world["plan"]["plan_id"],
                    "plan_version": native_world["plan"]["plan_version"],
                    "apply_after_approval": True,
                },
            )
            assert not confirmation.is_error
            assert confirmation.structured_content["data"]["state"] == "pending"

    asyncio.run(run())
    assert scalar("SELECT count(*) FROM agent_telegram_confirmations") == 1
    assert scalar("SELECT count(*) FROM agent_plan_approvals") == 0
