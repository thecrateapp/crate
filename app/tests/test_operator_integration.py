"""Executable fixed transports, native incident authority and readiness contracts."""

from datetime import UTC
import hashlib
import hmac
import json
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "deploy/hermes"))

from deploy.operator import infra_relay  # noqa: E402
from deploy.operator.delivery import request_json  # noqa: E402
from deploy.operator.server import make_http_server  # noqa: E402
from deploy.operator.state import State  # noqa: E402
from deploy.operator.supervisor import Rule, Supervisor  # noqa: E402
from tests import test_infra_bridge as infra_fixtures  # noqa: E402

lab = infra_fixtures.lab


def test_relay_uses_only_fixed_socket_routes_and_preserves_native_protocol(
    lab, monkeypatch
):
    from deploy.operator.infra_server import UnixServer, handler

    unix = UnixServer(lab.config["socket"], handler(lab.bridge))
    monkeypatch.setattr(infra_relay, "SOCKET", lab.config["socket"])
    relay = infra_relay.Server(("127.0.0.1", 0), infra_relay.Handler)
    for server in (unix, relay):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{relay.server_port}"
    headers = {
        "Authorization": "Bearer " + lab.keys["read"].decode(),
        "Content-Type": "application/json",
    }
    try:
        code, body = request_json(
            base + "/v1/read", payload=b'{"service":"crate-api"}', headers=headers
        )
        assert code == 200 and body["service"] == "crate-api"
        for path in ("/v1/execute", "/v1/read/../apply"):
            assert request_json(base + path, payload=b"{}", headers=headers)[0] == 400
        assert (
            request_json(base + "/v1/native/events", payload=b"{}", headers=headers)[0]
            == 403
        )
    finally:
        for server in (unix, relay):
            server.shutdown()
            server.server_close()


def test_supervisor_native_route_requires_own_signed_current_human_receipt(tmp_path):
    key = b"separate-human-key-" + b"a" * 32
    state = State(tmp_path / "state")
    supervisor = Supervisor(
        state,
        "lab",
        [
            Rule(
                "down",
                "api",
                "get_observability_summary",
                ("data", "sources", "worker"),
                trigger_samples=1,
            )
        ],
        human_callback_secret=key,
        allowed_operators={"telegram:123"},
    )
    now = time.time()
    supervisor.observe({}, now)
    incident = next(iter(state.snapshot()["incidents"].values()))
    receipt = {
        "audience": "lab",
        "operator": "telegram:123",
        "incident": incident["key"],
        "revision": incident["revision"],
        "action": "silence",
        "reason": "Investigating API recovery",
        "ttl": 60,
        "issued_at": now,
        "nonce": "telegram_update_123456",
    }
    server = make_http_server(supervisor, "independent-read-bearer")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/v1/native/decision"

    def post(value, signing=key, bearer=False):
        raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        headers = {
            "X-Crate-Signature": hmac.new(signing, raw, hashlib.sha256).hexdigest()
        }
        if bearer:
            headers["Authorization"] = "Bearer independent-read-bearer"
        return request_json(url, payload=raw, headers=headers)

    try:
        assert post(receipt, bearer=True)[0] == 403
        assert post(receipt, signing=b"independent-read-bearer")[0] == 403
        for patch in (
            {"operator": "telegram:999"},
            {"revision": receipt["revision"] + 1},
            {"issued_at": now - 200},
            {"reason": ""},
            {"ttl": 86401},
        ):
            assert post({**receipt, **patch})[0] == 403
        assert post(receipt)[0] == 200
        assert post(receipt)[0] == 403
        assert state.snapshot()["incidents"][incident["key"]]["state"] != "resolved"
    finally:
        server.shutdown()
        server.server_close()
        state.close()


def test_domain_adapter_discovers_offline_then_uses_live_policy_after_recovery(
    monkeypatch,
):
    import domain_mcp

    original = Path.read_text
    monkeypatch.setattr(
        domain_mcp.Path,
        "read_text",
        lambda self: "synthetic-domain" if self.name == "mcp-token" else original(self),
    )
    assert domain_mcp.dispatch({"method": "initialize"})["capabilities"] == {
        "tools": {}
    }
    catalog = domain_mcp.dispatch({"method": "tools/list"})["tools"]
    calls = []
    online = [False]

    def rpc(url, token, method, params, request_id):
        assert "_meta" not in params
        calls.append((method, params))
        if not online[0]:
            raise OSError("API down")
        if method == "tools/list":
            return {"tools": catalog}
        if params["name"] == "get_confirmation_policy":
            return {
                "structuredContent": {
                    "data": {
                        "actions_enabled": True,
                        "operator_provenance_required": True,
                        "require_approval": True,
                        "instance_id": "lab",
                        "credential_id": "credential",
                        "principal_id": "principal",
                        "policy_revision": 1,
                        "grants": ["library.metadata.write"],
                    }
                }
            }
        return {"structuredContent": {"data": {"state": "accepted"}}}

    monkeypatch.setattr(domain_mcp, "_mcp_request", rpc)
    write = {
        "method": "tools/call",
        "params": {
            "name": "request_plan_confirmation",
            "arguments": {},
            "_meta": {"progressToken": 7, "human_approval": True},
        },
    }
    with pytest.raises(OSError):
        domain_mcp.dispatch(write)
    online[0] = True
    assert (
        domain_mcp.dispatch(write)["structuredContent"]["data"]["state"] == "accepted"
    )
    assert calls[-3][0] == "tools/list"
    assert calls[-2][1]["name"] == "get_confirmation_policy"
    assert domain_mcp.dispatch(
        {
            "method": "tools/call",
            "params": {"name": "get_instance_inventory", "arguments": {}},
        }
    )
    online[0] = False
    with pytest.raises(OSError):
        domain_mcp.dispatch(write)


def test_overlay_health_and_authority_are_explicit_and_independent():
    overlay = yaml.safe_load(
        (ROOT / "deploy/operator/compose.operator.yaml").read_text()
    )["services"]
    for service in (
        "crate-operator",
        "crate-operator-supervisor",
        "crate-infra-relay",
    ):
        assert overlay[service]["profiles"] == ["crate-operator"]
        assert not overlay[service].get("depends_on")
        assert not overlay[service].get("ports")
        assert not overlay[service].get("privileged")
        assert "docker.sock" not in str(overlay[service])
    supervisor = str(overlay["crate-operator-supervisor"]["volumes"])
    assert "infra-native" not in supervisor and "domain-native" not in supervisor
    for service in ("crate-worker", "crate-maintenance-worker"):
        assert "CRATE_OPERATOR_PRINCIPAL_IDS" in overlay[service]["environment"]
        assert ":ro" in str(overlay[service]["volumes"])
    for service in (
        "crate-worker",
        "crate-maintenance-worker",
        "crate-analysis-worker",
        "crate-playback-worker",
        "crate-projector",
        "crate-media-worker",
        "crate-ui",
        "crate-listen",
    ):
        assert overlay[service]["healthcheck"]["test"]
    assert not {"crate-site", "crate-docs"} & set(overlay)
    project = yaml.safe_load((ROOT / "docker-compose.project.yaml").read_text())
    for service in ("crate-site", "crate-docs"):
        assert project["services"][service]["healthcheck"]["test"]
    assert (
        overlay["crate-fast-worker"]["environment"]["CRATE_READINESS_QUEUES"] == "fast"
    )


def test_role_health_requires_fresh_own_consumer_progress_and_dependencies(
    tmp_path, monkeypatch
):
    import redis
    from crate import role_readiness
    from crate.db.queries import role_readiness as database

    monkeypatch.setattr(role_readiness, "ROOT", tmp_path)
    monkeypatch.setenv("CRATE_READINESS_ROLE", "worker")
    monkeypatch.setenv("CRATE_READINESS_QUEUES", "fast")
    monkeypatch.setattr(database, "database_ready", lambda: True)
    ready = [True]
    monkeypatch.setattr(
        redis.Redis,
        "from_url",
        lambda *args, **kw: SimpleNamespace(ping=lambda: ready[0], close=lambda: None),
    )
    assert not role_readiness.healthy()
    role_readiness.progress("queue_default")
    assert not role_readiness.healthy()
    role_readiness.progress("queue_fast")
    assert not role_readiness.healthy()
    role_readiness.progress("queue_fast_delay")
    assert role_readiness.healthy()
    ready[0] = False
    assert not role_readiness.healthy()
    ready[0] = True
    path = next(tmp_path.glob("queue_fast.*.json"))
    value = json.loads(path.read_text())
    value["observed_at"] -= 1000
    path.write_text(json.dumps(value))
    assert not role_readiness.healthy()
    role_readiness.progress("queue_fast")
    assert role_readiness.healthy()


def test_domain_native_outcome_automatically_registers_watch_before_receipt(
    monkeypatch, tmp_path
):
    from tests.test_hermes_confirmation import plugin

    module = plugin()
    original = module.Path.read_text
    monkeypatch.setattr(
        module.Path,
        "read_text",
        lambda self: (
            "separate-supervisor-read" if self.name == "read-token" else original(self)
        ),
    )
    calls = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self, _):
            return json.dumps(
                {"job_id": "job-native", "expires_at": time.time() + 86400}
            ).encode()

    def opened(request, timeout):
        calls.append((request, timeout))
        return Response()

    provider = object.__new__(module.DomainProvider)
    receipts = []
    provider._post = lambda value: (
        receipts.append(value)
        or {
            "monitoring": {
                "state": "confirmed",
                "expires_at": value["watch_expires_at"],
            }
        }
    )
    provider.opener = SimpleNamespace(open=opened)
    provider._watch_outcome(
        {
            "state": "outcome",
            "confirmation_id": "a" * 32,
            "chat_id": 123,
            "result": {"job": {"job_id": "job-native"}},
        }
    )
    assert calls[0][0].full_url == "http://crate-operator-supervisor:8791/v1/watch-job"
    assert json.loads(calls[0][0].data) == {"job_id": "job-native", "ttl": 86400}
    assert calls[0][0].headers["Authorization"] == "Bearer separate-supervisor-read"
    assert receipts[0]["kind"] == "watch_enrolled"
    state = State(tmp_path / "state")
    try:
        supervisor = Supervisor(
            state,
            "lab",
            [
                Rule(
                    "down",
                    "api",
                    "get_instance_inventory",
                    ("data", "sources", "release_manifest"),
                )
            ],
        )
        supervisor.watch_job(**json.loads(calls[0][0].data), now=time.time())
        # The durable watch survives restart. Poller retains execution/verification.
        state.close()
        state = State(tmp_path / "state")
        supervisor = Supervisor(
            state,
            "lab",
            [
                Rule(
                    "down",
                    "api",
                    "get_instance_inventory",
                    ("data", "sources", "release_manifest"),
                )
            ],
        )
        from datetime import datetime

        supervisor.observe_job(
            "job-native",
            {
                "availability": "available",
                "observed_at": datetime.now(UTC).isoformat(),
                "data": {
                    "id": "job-native",
                    "status": "completed",
                    "execution_status": "completed",
                    "verification_status": "passed",
                    "projection_status": "pending",
                },
            },
            time.time(),
        )
        item = next(iter(state.snapshot()["outbox"].values()))
        assert '"verification_status": "passed"' in item["message"]
        assert '"projection_status": "pending"' in item["message"]
    finally:
        state.close()


def test_consumer_progress_only_after_successful_actual_consumer_iteration(monkeypatch):
    from crate import broker as broker_module
    from crate import role_readiness

    monkeypatch.setenv("CRATE_READINESS_ROLE", "worker")
    progress = []
    monkeypatch.setattr(role_readiness, "progress", progress.append)

    class Consumer:
        def __next__(self):
            if progress:
                raise OSError("broker unavailable")

    consumer = Consumer()
    monkeypatch.setattr(
        broker_module.RedisBroker, "consume", lambda *args, **kwargs: consumer
    )
    wrapped = broker_module.get_broker().consume("fast.DQ")
    assert next(wrapped) is None
    assert progress == ["queue_fast_delay"]
    with pytest.raises(OSError):
        next(wrapped)
    assert progress == ["queue_fast_delay"]


def test_native_incident_commands_and_read_watch_adapter_use_separate_http_authority(
    tmp_path, monkeypatch
):
    import asyncio
    import importlib

    from deploy.operator import supervisor_mcp
    from tests.test_hermes_confirmation import plugin

    plugin()
    native = importlib.import_module("native_confirmation.supervisor")
    (tmp_path / "callback-key").write_bytes(b"independent-human-" + b"h" * 32)
    (tmp_path / "identity.json").write_text(
        json.dumps({"instance_id": "lab", "allowed_users": [123]})
    )
    (tmp_path / "read-token").write_text("separate-read-watch-token")
    monkeypatch.setattr(native, "ROOT", tmp_path)
    monkeypatch.setattr(supervisor_mcp, "ROOT", tmp_path)
    command = native.SupervisorCommands()
    from types import ModuleType

    ext = ModuleType("telegram.ext")
    ext.CommandHandler = lambda name, callback: (name, callback)
    monkeypatch.setitem(sys.modules, "telegram.ext", ext)
    handlers = []
    command.factory(SimpleNamespace(add_handler=handlers.append), None)
    assert [name for name, _ in handlers] == ["crate_ack", "crate_silence"]
    state = State(tmp_path / "state")
    supervisor = Supervisor(
        state,
        "lab",
        [
            Rule(
                "down",
                "api",
                "get_instance_inventory",
                ("data", "sources", "release_manifest"),
                trigger_samples=1,
            )
        ],
        human_callback_secret=command.key,
        allowed_operators={"telegram:123"},
    )
    supervisor.observe({}, time.time())
    incident = next(iter(state.snapshot()["incidents"].values()))
    server = make_http_server(supervisor, "separate-read-watch-token")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    monkeypatch.setattr(native, "URL", base + "/v1/native/decision")
    monkeypatch.setattr(supervisor_mcp, "BASE", base)
    replies = []

    async def reply(text, **kw):
        replies.append(text)

    update = SimpleNamespace(
        effective_user=SimpleNamespace(id=123, is_bot=False),
        effective_chat=SimpleNamespace(id=123, type="private"),
        effective_message=SimpleNamespace(reply_text=reply),
        update_id=150,
    )
    context = SimpleNamespace(
        args=[
            incident["key"],
            str(incident["revision"]),
            "60",
            "Investigating",
            "recovery",
        ]
    )
    try:
        tools = supervisor_mcp.dispatch({"method": "tools/list"})["tools"]
        assert len(tools) == 5 and all(t["annotations"]["readOnlyHint"] for t in tools)
        assert supervisor_mcp.dispatch({"method": "initialize"})["capabilities"] == {
            "tools": {}
        }
        assert supervisor_mcp.dispatch({"method": "ping"}) == {}
        assert not supervisor_mcp.dispatch(
            {
                "method": "tools/call",
                "params": {"name": "supervisor_status", "arguments": {}},
            }
        )["isError"]
        watch = supervisor_mcp.dispatch(
            {
                "method": "tools/call",
                "params": {
                    "name": "supervisor_watch_job",
                    "arguments": {"job_id": "job-native", "ttl": 60},
                },
            }
        )
        assert not watch["isError"] and "job-native" in state.snapshot()["watches"]
        with pytest.raises(ValueError):
            supervisor_mcp.dispatch(
                {
                    "method": "tools/call",
                    "params": {"name": "supervisor_ack", "arguments": {}},
                }
            )
        asyncio.run(command.ack(update, context))
        assert replies[-1].startswith("Incident decision recorded")
        asyncio.run(command.ack(update, context))
        assert replies[-1].startswith("Decision unavailable")
        update.update_id += 1
        context.args[1] = str(
            state.snapshot()["incidents"][incident["key"]]["revision"]
        )
        asyncio.run(command.silence(update, context))
        assert replies[-1].startswith("Incident decision recorded")
        supervisor._allowed_operators = frozenset()
        update.update_id += 1
        context.args[1] = str(
            state.snapshot()["incidents"][incident["key"]]["revision"]
        )
        asyncio.run(command.silence(update, context))
        assert replies[-1].startswith("Decision unavailable")
        update.effective_user.id = 999
        count = len(replies)
        asyncio.run(command.ack(update, context))
        assert len(replies) == count
    finally:
        server.shutdown()
        server.server_close()
        state.close()


def test_domain_stdio_unavailability_is_bounded_transport_success_not_effect_success(
    monkeypatch, capsys
):
    import io

    import domain_mcp

    calls = []
    original = Path.read_text
    monkeypatch.setattr(
        domain_mcp.Path,
        "read_text",
        lambda self: "synthetic-domain" if self.name == "mcp-token" else original(self),
    )

    def rpc(url, token, method, params, request_id):
        calls.append(params)
        if len(calls) <= 4:
            raise OSError("private upstream body must not escape")
        return {"isError": False, "content": [{"type": "text", "text": "recovered"}]}

    monkeypatch.setattr(domain_mcp, "_mcp_request", rpc)
    requests = [
        {
            "jsonrpc": "2.0",
            "id": i,
            "method": "tools/call",
            "params": {
                "name": "get_instance_inventory",
                "arguments": {},
                "_meta": {"progressToken": i},
            },
        }
        for i in range(5)
    ]
    requests.append({"jsonrpc": "2.0", "id": 6, "method": "unknown"})
    monkeypatch.setattr(
        domain_mcp.sys,
        "stdin",
        SimpleNamespace(
            buffer=io.BytesIO("".join(json.dumps(r) + "\n" for r in requests).encode())
        ),
    )
    domain_mcp.main()
    replies = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    for value in replies[:4]:
        assert "error" not in value and not value["result"]["isError"]
        data = value["result"]["structuredContent"]
        assert data["availability"] == "unavailable" and data["outcome"] == "unverified"
        assert "private" not in json.dumps(value)
    assert replies[4]["result"]["content"][0]["text"] == "recovered"
    assert replies[5]["error"]["code"] == -32603
    assert all("_meta" not in call for call in calls)


def test_domain_stdio_local_validation_errors_are_distinct_from_outages(
    monkeypatch, capsys
):
    import io
    from types import SimpleNamespace

    import domain_mcp

    calls = []
    monkeypatch.setattr(domain_mcp, "_mcp_request", lambda *args: calls.append(args))
    invalid = [
        {},
        {"name": "unknown"},
        {"name": "get_instance_inventory", "extra": True},
        {"name": "get_instance_inventory", "_meta": []},
        {"name": "get_instance_inventory", "arguments": []},
    ]
    messages = [
        {"id": i + 1, "method": "tools/call", "params": params}
        for i, params in enumerate(invalid)
    ]
    monkeypatch.setattr(
        domain_mcp.sys,
        "stdin",
        SimpleNamespace(
            buffer=io.BytesIO("".join(json.dumps(m) + "\n" for m in messages).encode())
        ),
    )
    domain_mcp.main()
    replies = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert len(replies) == len(invalid)
    assert all(reply["error"]["code"] == -32602 for reply in replies)
    assert calls == []
