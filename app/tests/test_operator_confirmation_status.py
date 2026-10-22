"""Actual presenter retries, durable enrollment receipts and originating read status."""

import asyncio
import threading
import time
import urllib.request
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_telegram as store
from pydantic import TypeAdapter, ValidationError

from tests import test_operator_domain_integration as domain
from tests.agent_command_fixtures import change, scalar
from tests.test_agent_telegram import button, event, show_all
from tests.test_hermes_confirmation import plugin, sdk
from tests.test_mcp_actions import _client
from tests.test_operator_provenance import drift

operation_world = domain.operation_world
operator_world = domain.operator_world
pytest_plugins = domain.pytest_plugins


def _native_post(value):
    return event(value["kind"], **{k: v for k, v in value.items() if k != "kind"})


@pytest.mark.parametrize("failure", ["network", "capacity"])
@pytest.mark.parametrize("recover", [True, False])
def test_actual_presenter_retries_restart_and_exhaustion_are_durable_and_visible(
    operator_world, tmp_path, monkeypatch, failure, recover
):
    from deploy.operator.server import make_http_server
    from deploy.operator.state import State
    from deploy.operator.supervisor import Rule, Supervisor

    sdk(monkeypatch)
    module = plugin()
    token = tmp_path / "read-token"
    token.write_text("separate-read-watch-token")
    monkeypatch.setattr(module, "WATCH_TOKEN_FILE", token)
    state = State(tmp_path / "supervisor")
    supervisor = Supervisor(
        state,
        "test-instance",
        [Rule("api", "api", "get_instance_inventory", ("data",))],
    )
    if failure == "capacity":
        for index in range(30):
            supervisor.watch_job("existing-" + str(index), time.time())
    server = make_http_server(supervisor, "separate-read-watch-token")
    threading.Thread(target=server.serve_forever, daemon=True).start()

    class Disconnect(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            self.close_connection = (
                True  # actual TCP connection closes without a response
            )

    broken = ThreadingHTTPServer(("127.0.0.1", 0), Disconnect)
    threading.Thread(target=broken.serve_forever, daemon=True).start()
    port = broken.server_port if failure == "network" else server.server_port
    monkeypatch.setattr(module, "WATCH_URL", f"http://127.0.0.1:{port}/v1/watch-job")
    confirmation, message_id = show_all(operator_world)
    cid = confirmation["confirmation_id"]
    sent = []
    events = []

    def provider():
        native = object.__new__(module.DomainProvider)
        native.allowed = {123}
        native.opener = urllib.request.build_opener(
            module.NoRedirect(), urllib.request.ProxyHandler({})
        )

        def post(value):
            events.append(value["kind"])
            return _native_post(value)

        native._post = post
        return native

    async def generation(approve=False):
        # A fresh presenter/provider reproduces gateway reconnect/restart while
        # all admitted result/retry state remains in real PostgreSQL.
        native = provider()
        ctx = SimpleNamespace(spawn_task=lambda coro, **kw: asyncio.create_task(coro))
        presenter = module.NativePresenter(ctx, [native])
        if approve:
            message = SimpleNamespace(
                chat=SimpleNamespace(id=123, type="private"),
                message_id=message_id,
                reply_text=AsyncMock(),
            )
            query = SimpleNamespace(
                message=message,
                from_user=SimpleNamespace(id=123, is_bot=False),
                data="ct:d:" + cid + ":approve",
                id=uuid4().hex,
                answer=AsyncMock(),
            )
            await presenter.callback(
                native, SimpleNamespace(callback_query=query, update_id=99999)
            )
            message.reply_text.assert_not_awaited()

        async def send(**kwargs):
            sent.append(kwargs["text"])
            return SimpleNamespace(message_id=500 + len(sent))

        app = SimpleNamespace(
            bot=SimpleNamespace(send_message=send), add_handler=lambda handler: None
        )
        original = asyncio.sleep

        async def one_poll(_):
            presenter.application = None
            await original(0)

        with monkeypatch.context() as patched:
            patched.setattr(module.asyncio, "sleep", one_poll)
            presenter.factory(app, object())
            await presenter.tasks[0]
            presenter.close()

    try:
        asyncio.run(generation(approve=True))
        status = store.get_confirmation_status(operator_world["principal"], cid)
        job_id = status["result"]["job"]["job_id"]
        assert status["monitoring"]["state"] == "unavailable"
        assert status["delivery"] == {
            "state": "pending",
            "attempts": 1,
            "max_attempts": 20,
            "retry_exhausted": False,
        }
        assert not sent and job_id not in state.snapshot()["watches"]
        assert scalar("SELECT count(*) FROM agent_jobs") == 2
        # Missing domain provenance cannot prevent reading current coverage.
        drift(operator_world["evidence"], "missing")
        assert store.get_confirmation_status(operator_world["principal"], cid) == status
        if recover:
            if failure == "capacity":
                with state.transaction() as data:
                    data["watches"].clear()
            monkeypatch.setattr(
                module,
                "WATCH_URL",
                f"http://127.0.0.1:{server.server_port}/v1/watch-job",
            )
            attempts = 1
        else:
            attempts = 19
        for _ in range(attempts):
            change("UPDATE agent_telegram_confirmations SET next_delivery_at=NOW()")
            asyncio.run(generation())
        status = store.get_confirmation_status(operator_world["principal"], cid)
        assert status["delivery"]["state"] == "delivered"
        assert status["delivery"]["attempts"] == (2 if recover else 20)
        assert status["delivery"]["retry_exhausted"] is not recover
        assert len(sent) == 1 and job_id in sent[0]
        assert (job_id in state.snapshot()["watches"]) is recover
        assert status["monitoring"]["state"] == (
            "confirmed" if recover else "unavailable"
        )
        assert ("Monitoring unavailable" in sent[0]) is not recover
        assert events.count("callback") == 1
        assert scalar("SELECT count(*) FROM agent_jobs") == 2
        assert scalar("SELECT count(*) FROM agent_plan_approvals") == 1
        before = len(events)
        change("UPDATE agent_telegram_confirmations SET next_delivery_at=NOW()")
        asyncio.run(generation())
        assert events[before:] == ["pending"] and len(sent) == 1
        # Independent state survives restart, including successful enrollment.
        server.shutdown()
        server.server_close()
        state.close()
        state = State(tmp_path / "supervisor")
        assert (job_id in state.snapshot()["watches"]) is recover
    finally:
        server.shutdown()
        server.server_close()
        broken.shutdown()
        broken.server_close()
        state.close()


@pytest.mark.parametrize(
    "changed",
    ["principal", "credential", "binding", "instance", "grants", "revoked", "origin"],
)
def test_confirmation_read_is_exact_origin_current_binding_and_current_authority(
    operator_world, monkeypatch, changed
):
    confirmation, _ = show_all(operator_world)
    principal = operator_world["principal"]
    if changed == "principal":
        principal = replace(principal, id=str(uuid4()))
    elif changed == "credential":
        principal = replace(principal, credential_id=str(uuid4()))
    elif changed == "binding":
        change("UPDATE agent_telegram_bindings SET revoked_at=NOW()")
    elif changed == "instance":
        monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "another-instance")
    elif changed == "grants":
        change("UPDATE agent_principals SET grants=ARRAY['ops.status.read']::text[]")
    elif changed == "revoked":
        change("UPDATE agent_credentials SET revoked_at=NOW()")
    else:
        change(
            "UPDATE agent_telegram_confirmations SET origin=jsonb_set(origin, '{authorization_context}', '{\"scope\":\"forged\"}')"
        )
    with pytest.raises(DiagnosticError):
        store.get_confirmation_status(principal, confirmation["confirmation_id"])


def test_sdk_status_is_bounded_read_during_drift_and_cannot_forge_enrollment(
    operator_world, action_transport, monkeypatch
):
    confirmation, message = show_all(operator_world)
    result = button(confirmation["confirmation_id"], message, "approve")
    principal = operator_world["principal"]
    app, token, _, credentials, _admission = action_transport
    credentials[token] = principal
    drift(operator_world["evidence"], "rollback")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "false")

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            tools = {tool.name: tool for tool in (await client.list_tools()).tools}
            assert tools["get_confirmation_status"].annotations.read_only_hint is True
            assert (
                tools["get_confirmation_status"].input_schema["additionalProperties"]
                is False
            )
            value = await client.call_tool(
                "get_confirmation_status",
                {"confirmation_id": confirmation["confirmation_id"]},
            )
            assert not value.is_error
            status = value.structured_content["data"]
            assert status["result"] == result
            assert status["monitoring"]["state"] == "unverified"
            assert status["delivery"]["attempts"] == 0
            for args in [
                {"confirmation_id": "../private"},
                {
                    "confirmation_id": confirmation["confirmation_id"],
                    "monitoring": {"state": "confirmed"},
                },
            ]:
                assert (
                    await client.call_tool("get_confirmation_status", args)
                ).is_error
            assert "watch_enrolled" not in tools

    asyncio.run(run())
    assert scalar("SELECT delivery_attempts FROM agent_telegram_confirmations") == 0
    assert scalar("SELECT count(*) FROM agent_jobs") == 2
    from crate.api.schemas.agent_telegram import NativeEvent

    with pytest.raises(ValidationError):
        TypeAdapter(NativeEvent).validate_python(
            {
                "kind": "watch_enrolled",
                "instance_id": "test-instance",
                "confirmation_id": confirmation["confirmation_id"],
                "chat_id": 123,
                "job_id": result["job"]["job_id"],
                "watch_expires_at": float("inf"),
            }
        )
    with pytest.raises(DiagnosticError):
        event(
            "watch_enrolled",
            confirmation_id=confirmation["confirmation_id"],
            chat_id=123,
            job_id="wrong-job",
            watch_expires_at=time.time() + 100,
        )
    assert (
        store.get_confirmation_status(principal, confirmation["confirmation_id"])[
            "monitoring"
        ]["state"]
        == "unverified"
    )


def test_status_exhaustion_and_receipt_expiry_never_infer_live_coverage(
    operator_world, monkeypatch
):
    from datetime import UTC, datetime, timedelta

    confirmation, message = show_all(operator_world)
    result = button(confirmation["confirmation_id"], message, "approve")
    cid = confirmation["confirmation_id"]
    principal = operator_world["principal"]
    change("UPDATE agent_telegram_confirmations SET delivery_attempts=20")
    status = store.get_confirmation_status(principal, cid)
    assert status["delivery"]["state"] == "exhausted"
    assert status["monitoring"]["state"] == "unavailable"
    expires = time.time() + 60
    event(
        "watch_enrolled",
        confirmation_id=cid,
        chat_id=123,
        job_id=result["job"]["job_id"],
        watch_expires_at=expires,
    )
    status = store.get_confirmation_status(principal, cid)
    assert status["monitoring"]["state"] == "confirmed"
    assert status["delivery"]["state"] == "exhausted"
    # Read-time expiry is independent of delivery state and writes no DB state.
    later = datetime.now(UTC) + timedelta(seconds=120)
    monkeypatch.setattr(store, "datetime", SimpleNamespace(now=lambda _: later))
    expired = store.get_confirmation_status(principal, cid)
    assert expired["monitoring"]["state"] == "unavailable"
    assert expired["monitoring"]["reason"] == "Enrollment receipt expired or invalid"
    assert (
        scalar(
            "SELECT result->'monitoring'->>'state' FROM agent_telegram_confirmations"
        )
        == "confirmed"
    )
    assert scalar("SELECT count(*) FROM agent_jobs") == 2
    with pytest.raises(DiagnosticError):
        store.get_confirmation_status(principal, "../private")
