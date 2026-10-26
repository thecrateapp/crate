"""Pinned Hermes public factory contract, isolated native transport and opt-in policy."""

import asyncio
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from tests.test_hermes_runtime import _runtime

ROOT = Path(__file__).resolve().parents[2]


def plugin():
    spec = importlib.util.spec_from_file_location(
        "native_confirmation",
        ROOT / "deploy/hermes/plugins/crate_confirmation/__init__.py",
    )
    result = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = result
    spec.loader.exec_module(result)
    return result


def sdk(monkeypatch):
    telegram, ext = ModuleType("telegram"), ModuleType("telegram.ext")
    telegram.InlineKeyboardButton = lambda label, callback_data: {
        "label": label,
        "data": callback_data,
    }
    telegram.InlineKeyboardMarkup = lambda rows: rows
    ext.CallbackQueryHandler = lambda callback, *, pattern: SimpleNamespace(
        callback=callback, pattern=pattern
    )
    monkeypatch.setitem(sys.modules, "telegram", telegram)
    monkeypatch.setitem(sys.modules, "telegram.ext", ext)


def test_register_uses_public_factory_and_unload_and_never_adds_tools(monkeypatch):
    module = plugin()
    provider = SimpleNamespace(pattern=module.PATTERN)
    monkeypatch.setattr(module, "DomainProvider", lambda: provider)
    registered = {}
    ctx = SimpleNamespace(
        register_telegram_handler=lambda factory: registered.update(factory=factory),
        on_unload=lambda cb: registered.update(unload=cb),
    )
    module.register(ctx)
    assert callable(registered["factory"])
    assert callable(registered["unload"])
    registered["unload"]()
    assert not re.match(module.PATTERN, "approve")
    assert not re.match(module.PATTERN, "yes")
    assert not re.match(module.PATTERN, "core:approval")
    assert re.fullmatch(module.PATTERN, "ct:d:" + "a" * 32 + ":approve")


def test_factory_reconnect_cancels_abandoned_presenters(monkeypatch):
    sdk(monkeypatch)
    module = plugin()

    async def run():
        ctx = SimpleNamespace(
            spawn_task=lambda coro, *, name: asyncio.create_task(coro, name=name)
        )
        presenter = module.NativePresenter(
            ctx, [SimpleNamespace(pattern=module.PATTERN)]
        )
        first, second = (
            SimpleNamespace(add_handler=lambda handler: None),
            SimpleNamespace(add_handler=lambda handler: None),
        )
        presenter.factory(first, object())
        previous = presenter.tasks[0]
        presenter.factory(second, object())
        assert previous.cancelling()
        presenter.close()
        await asyncio.gather(previous, return_exceptions=True)
        assert presenter.application is None

    asyncio.run(run())


def test_native_callback_passes_sdk_identity_and_rejects_wrong_sender(monkeypatch):
    sdk(monkeypatch)
    module = plugin()

    async def run():
        provider = SimpleNamespace(
            pattern=module.PATTERN,
            allowed={123},
            event=AsyncMock(return_value={"state": "next_page"}),
        )
        message = SimpleNamespace(
            chat=SimpleNamespace(id=123, type="private"),
            message_id=44,
            reply_text=AsyncMock(),
        )
        query = SimpleNamespace(
            message=message,
            from_user=SimpleNamespace(id=123, is_bot=False),
            data="ct:d:" + "a" * 32 + ":next",
            id="sdk-query",
            answer=AsyncMock(),
        )
        update = SimpleNamespace(callback_query=query, update_id=456)
        presenter = module.NativePresenter(None, [provider])
        await presenter.callback(provider, update)
        args = provider.event.await_args.args[0]
        assert (
            args["user_id"],
            args["chat_id"],
            args["message_id"],
            args["update_id"],
            args["query_id"],
        ) == (123, 123, 44, 456, "sdk-query")
        query.from_user.id = 124
        await presenter.callback(provider, update)
        assert provider.event.await_count == 1

    asyncio.run(run())


@pytest.mark.parametrize(
    "ack_error",
    [
        TimeoutError("timeout"),
        ValueError(
            "Query is too old and response timeout expired or query ID is invalid"
        ),
    ],
)
def test_ack_failure_still_submits_once_and_delivers_durable_outcome(
    monkeypatch, ack_error
):
    sdk(monkeypatch)
    module = plugin()

    async def run():
        cid = "a" * 32
        terminal = {"state": "approved", "job": {"job_id": "job-ack-failed"}}
        presenter = module.NativePresenter(None, [])
        durable = {}

        async def event(data):
            if data["kind"] == "callback":
                durable["result"] = terminal
                return terminal
            if data["kind"] == "pending":
                return {
                    "state": "outcome",
                    "confirmation_id": cid,
                    "chat_id": 123,
                    "result": durable["result"],
                }
            assert data["kind"] == "outcome_delivered"
            durable.clear()
            presenter.application = None
            return {"state": "delivered"}

        provider = SimpleNamespace(
            pattern=module.PATTERN,
            prefix="ct:d:",
            allowed={123},
            event=AsyncMock(side_effect=event),
        )
        message = SimpleNamespace(
            chat=SimpleNamespace(id=123, type="private"),
            message_id=44,
            reply_text=AsyncMock(),
        )
        query = SimpleNamespace(
            message=message,
            from_user=SimpleNamespace(id=123, is_bot=False),
            data="ct:d:" + cid + ":approve",
            id="sdk-query",
            answer=AsyncMock(side_effect=ack_error),
        )
        await presenter.callback(
            provider, SimpleNamespace(callback_query=query, update_id=456)
        )
        provider.event.assert_awaited_once()
        assert provider.event.await_args.args[0]["kind"] == "callback"
        assert durable["result"] == terminal
        message.reply_text.assert_not_awaited()
        bot = SimpleNamespace(
            send_message=AsyncMock(return_value=SimpleNamespace(message_id=45))
        )
        app = SimpleNamespace(bot=bot)
        presenter.application = app
        original_sleep = asyncio.sleep

        async def no_wait(_):
            await original_sleep(0)

        monkeypatch.setattr(module.asyncio, "sleep", no_wait)
        await presenter.present(app, provider)
        assert "job-ack-failed" in bot.send_message.await_args.kwargs["text"]
        assert [call.args[0]["kind"] for call in provider.event.await_args_list] == [
            "callback",
            "pending",
            "outcome_delivered",
        ]
        assert durable == {}

    asyncio.run(run())


def test_presenter_delivers_full_page_then_receipt_and_outcome(monkeypatch):
    sdk(monkeypatch)
    module = plugin()

    async def run():
        cid = "a" * 32
        responses = [
            {
                "state": "page",
                "confirmation_id": cid,
                "chat_id": 123,
                "page_index": 0,
                "page_count": 2,
                "text": "literal <b>é</b>",
            },
            {
                "state": "outcome",
                "confirmation_id": cid,
                "chat_id": 123,
                "result": {"state": "approved", "job": {"job_id": "job-1"}},
            },
        ]
        sent = []
        presenter = module.NativePresenter(None, [])

        async def send(**kwargs):
            sent.append(kwargs)
            return SimpleNamespace(message_id=len(sent))

        app = SimpleNamespace(bot=SimpleNamespace(send_message=send))
        presenter.application = app

        async def event(data):
            if data["kind"] == "pending":
                return responses.pop(0)
            if data["kind"] == "outcome_delivered":
                presenter.application = None
            return {"state": "presented"}

        provider = SimpleNamespace(
            prefix="ct:d:", allowed={123}, event=AsyncMock(side_effect=event)
        )
        original_sleep = asyncio.sleep

        async def no_wait(_):
            await original_sleep(0)

        monkeypatch.setattr(module.asyncio, "sleep", no_wait)
        await presenter.present(app, provider)
        assert sent[0]["text"] == "literal <b>é</b>" and sent[0]["parse_mode"] is None
        assert sent[0]["reply_markup"][0][0]["label"] == "Next"
        assert "job-1" in sent[1]["text"]
        assert provider.event.await_args_list[1].args[0]["kind"] == "delivered"

    asyncio.run(run())


def test_native_transport_reads_only_dedicated_files_rejects_redirects_and_proxies(
    tmp_path, monkeypatch
):
    module = plugin()
    keyfile, identity = tmp_path / "key", tmp_path / "identity.json"
    keyfile.write_bytes(b"synthetic-native-secret-32-bytes-long")
    identity.write_text(
        json.dumps({"instance_id": "test-instance", "allowed_users": [123]})
    )
    monkeypatch.setattr(module, "KEY_FILE", keyfile)
    monkeypatch.setattr(module, "IDENTITY_FILE", identity)
    provider = module.DomainProvider()
    assert provider.allowed == {123}
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, n):
            return b'{"state":"idle"}'

    def open_request(request, timeout):
        captured.update(
            url=request.full_url,
            headers=dict(request.header_items()),
            body=request.data,
            timeout=timeout,
        )
        return Response()

    provider.opener = SimpleNamespace(open=open_request)
    assert provider._post({"kind": "pending"}) == {"state": "idle"}
    assert captured["url"] == module.URL
    assert "X-crate-signature" in captured["headers"]
    assert keyfile.read_text() not in json.dumps(captured, default=str)
    with pytest.raises(ValueError, match="redirect"):
        module.NoRedirect().redirect_request(
            None, None, 302, "", {}, "http://evil.test"
        )


def test_write_profile_is_explicit_and_native_approval_is_not_a_model_tool():
    pilot = json.loads((ROOT / "deploy/hermes/config.json").read_text())
    operator = json.loads((ROOT / "deploy/hermes/config.operator.json").read_text())
    assert len(pilot["mcp_servers"]["crate"]["tools"]["include"]) == 12
    assert "trust" not in pilot["mcp_servers"]["crate"]
    include = operator["mcp_servers"]["crate"]["tools"]["include"]
    assert "request_plan_confirmation" in include
    assert not {"approve_plan", "decide_plan", "retry_job", "cancel_job"} & set(include)
    assert operator["mcp_servers"]["crate"]["trust"] == "full"
    assert operator["plugins"]["enabled"] == ["crate-confirmation"]
    assert (
        operator["platforms"]["telegram"]["extra"]["drop_pending_on_cold_boot"] is False
    )
    assert "callback-key" not in json.dumps(operator)


def test_profile_validates_current_approval_and_retains_bounded_reconnect_adapter(
    tmp_path, monkeypatch
):
    runtime = _runtime()
    config = json.loads((ROOT / "deploy/hermes/config.operator.json").read_text())
    tools = [
        {
            "name": name,
            "annotations": {"readOnlyHint": name != "request_plan_confirmation"},
        }
        for name in [
            "get_confirmation_policy",
            "request_plan_confirmation",
            "get_plan",
            "get_job",
        ]
    ]
    policy = {
        "operator_provenance_required": True,
        "require_approval": True,
        "actions_enabled": True,
        "instance_id": "test",
        "credential_id": "cred",
        "principal_id": "principal",
        "policy_revision": 1,
        "grants": ["library.metadata.write"],
    }
    runtime.validate_operator_profile(tools, policy, config)
    for field, value in [
        ("require_approval", False),
        ("actions_enabled", False),
        ("instance_id", None),
        ("grants", []),
    ]:
        with pytest.raises(ValueError):
            runtime.validate_operator_profile(tools, {**policy, field: value}, config)
    with pytest.raises(ValueError, match="separate"):
        runtime.operator_preflight("http://loopback", "same", "same", config)
    monkeypatch.setenv("HOME", "/root")
    monkeypatch.setenv("XDG_STATE_HOME", "/root/.local/state")
    monkeypatch.setenv("CRATE_MCP_URL", "http://crate-api:8585/mcp")
    monkeypatch.setenv("CRATE_MCP_HOST", "api.test.invalid")
    monkeypatch.setenv("HERMES_MANAGED_DIR", str(tmp_path / "managed"))
    runtime.configure_operator(tmp_path, ROOT / "deploy/hermes", domain_available=False)
    assert os.environ["HOME"] == str(tmp_path)
    assert os.environ["XDG_STATE_HOME"] == str(tmp_path / "xdg-state")
    assert json.loads((tmp_path / "config.yaml").read_text())["mcp_servers"]["crate"][
        "env"
    ] == {
        "CRATE_MCP_URL": "http://crate-api:8585/mcp",
        "CRATE_MCP_HOST": "api.test.invalid",
    }
    assert json.loads((tmp_path / "config.yaml").read_text())["mcp_servers"]["crate"][
        "args"
    ] == ["/opt/crate-hermes/domain_mcp.py"]
    assert "strictly read-only" not in (tmp_path / "SOUL.md").read_text()
    runtime.configure_operator(tmp_path, ROOT / "deploy/hermes", domain_available=True)
    assert "crate" in json.loads((tmp_path / "config.yaml").read_text())["mcp_servers"]


def test_operator_preflight_checks_independent_read_discovery_then_current_policy(
    monkeypatch,
):
    runtime = _runtime()
    config = json.loads((ROOT / "deploy/hermes/config.operator.json").read_text())
    tools = [
        {
            "name": name,
            "annotations": {"readOnlyHint": name != "request_plan_confirmation"},
        }
        for name in [
            "get_confirmation_policy",
            "request_plan_confirmation",
            "get_plan",
            "get_job",
        ]
    ]
    policy = {
        "operator_provenance_required": True,
        "require_approval": True,
        "actions_enabled": True,
        "instance_id": "test",
        "credential_id": "cred",
        "principal_id": "principal",
        "policy_revision": 1,
        "grants": ["library.metadata.write"],
    }
    calls = []

    def rpc(url, token, method, params, request_id):
        calls.append((token, method))
        if method == "tools/list":
            return {
                "tools": [{"name": "get_job", "annotations": {"readOnlyHint": True}}]
                if token == "supervisor"
                else tools
            }
        if method == "tools/call":
            return {"structuredContent": {"data": policy}}
        return {}

    monkeypatch.setattr(runtime, "_mcp_request", rpc)
    runtime.operator_preflight("http://loopback", "operator", "supervisor", config)
    assert calls[:2] == [("supervisor", "initialize"), ("supervisor", "tools/list")]
    policy["require_approval"] = False
    with pytest.raises(ValueError):
        runtime.operator_preflight("http://loopback", "operator", "supervisor", config)


@pytest.mark.parametrize(
    "prefix,state,monitoring,expected",
    [
        ("ct:i:", "succeeded", None, "infra_inspect"),
        ("ct:i:", "indeterminate", None, "infra_reconcile"),
        ("ct:d:", "approved", {"state": "confirmed"}, "supervisor watch enrolled"),
        ("ct:d:", "approved", {"state": "unavailable"}, "get_confirmation_status"),
    ],
)
def test_actual_native_presenter_gives_provider_valid_followup(
    monkeypatch, prefix, state, monitoring, expected
):
    sdk(monkeypatch)
    module = plugin()

    async def run():
        presenter = module.NativePresenter(None, [])
        sent = []

        async def send(**kwargs):
            sent.append(kwargs["text"])
            return SimpleNamespace(message_id=1)

        app = SimpleNamespace(bot=SimpleNamespace(send_message=send))
        presenter.application = app

        async def event(data):
            if data["kind"] == "outcome_delivered":
                presenter.application = None
                return {"state": "delivered"}
            if prefix == "ct:i:":
                from deploy.operator.infra_plans import Bridge

                plan = {
                    "id": "a" * 32,
                    "state": state,
                    "document": {"human_id": 123},
                    "outcome_delivered": False,
                    "attempts": 0,
                    "next_delivery": 0,
                }
                return Bridge._pending(None, {"infra_plans": {"a" * 32: plan}}, 1)
            return {
                "state": "outcome",
                "confirmation_id": "a" * 32,
                "chat_id": 123,
                "result": {
                    "state": state,
                    "job": {"job_id": "job-1"},
                    **({"monitoring": monitoring} if monitoring else {}),
                },
            }

        provider = SimpleNamespace(prefix=prefix, allowed={123}, event=event)
        original_sleep = asyncio.sleep
        monkeypatch.setattr(module.asyncio, "sleep", lambda _: original_sleep(0))
        await presenter.present(app, provider)
        assert expected in sent[0]
        if prefix == "ct:i:":
            assert (
                "get_confirmation_status" not in sent[0]
                and "Monitoring unavailable" not in sent[0]
            )

    asyncio.run(run())
