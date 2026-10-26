#!/usr/bin/env python3
"""Run ONLY inside a disposable --network none pinned Hermes container.

Exercises real gateway/native handlers/fixed signed deliver_only with loopback Bot API.
No provider credential, inference, production host, or real Telegram is used.
"""

import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path

REPO = Path("/workspace")
sys.path.insert(0, str(REPO))
from deploy.operator.delivery import HermesTransport
from deploy.operator.infra_executor import Executor
from deploy.operator.infra_plans import Bridge
from deploy.operator.infra_policy import Policy
from deploy.operator.infra_relay import Handler, Server
from deploy.operator.infra_server import UnixServer, handler
from deploy.operator.state import State

LAB_HOME = Path("/tmp/operator-gateway-smoke")
LAB_HOME.mkdir()
ASSETS = Path("/opt/crate-hermes")
shutil.copytree(REPO / "deploy/hermes", ASSETS)
config = json.loads((ASSETS / "config.operator.json").read_text())
config["platforms"]["telegram"]["extra"].update(
    base_url="http://127.0.0.1:8999/bot", base_file_url="http://127.0.0.1:8999/file/bot"
)
# Keep the actual bounded adapters; their code is mounted from this candidate.
for key in ("crate_infra", "crate_supervisor"):
    config["mcp_servers"][key]["env"]["PYTHONPATH"] = "/workspace"
config["plugins"]["enabled"].append("crate-acceptance-probe")
(ASSETS / "config.operator.json").write_text(json.dumps(config))
(LAB_HOME / "plugins").mkdir()
shutil.copytree(
    ASSETS / "plugins/crate_confirmation", LAB_HOME / "plugins/crate-confirmation"
)
probe_plugin = LAB_HOME / "plugins/crate-acceptance-probe"
probe_plugin.mkdir()
shutil.copyfile(
    REPO / "scripts/operator_gateway_probe.py", probe_plugin / "__init__.py"
)
(probe_plugin / "plugin.yaml").write_text(
    "name: crate-acceptance-probe\nversion: 1.0.0\ndescription: Disposable registry acceptance\nprovides_tools: []\nprovides_hooks: []\n"
)
secrets = Path("/run/crate-hermes-secrets")
secrets.mkdir()
for name, value in {
    "mcp-token": "crate_mcp_" + "a" * 43,
    "telegram-token": "123456:" + "a" * 35,
    "allowed-users": "123",
}.items():
    (secrets / name).write_text(value)
delivery = Path("/run/crate-hermes-delivery")
delivery.mkdir()
(delivery / "secret").write_text("delivery-" + "a" * 40)
(delivery / "destination").write_text("123")
native = Path("/run/crate-hermes-infra-native")
native.mkdir()
(native / "callback-key").write_text("3" * 32)
(native / "identity.json").write_text(
    json.dumps({"instance_id": "lab", "allowed_users": [123]})
)
policy = json.loads((REPO / "deploy/operator/infra.example.json").read_text())
policy.update(
    instance="lab",
    enabled=True,
    services=["crate-api"],
    humans={"123": ["restart"]},
    postgres_image="pgvector/pgvector:pg15@sha256:" + "a" * 64,
    server_path=str(LAB_HOME / "host"),
    approved_releases=str(LAB_HOME / "releases"),
    state_directory=str(LAB_HOME / "infra-state"),
    backup_directory=str(LAB_HOME / "backups"),
    cooldown_seconds=10,
)
for field in ("server_path", "approved_releases", "backup_directory"):
    Path(policy[field]).mkdir()
client = Path("/run/crate-infra-client")
client.mkdir()
keys = {}
for index, role in enumerate(("read", "prepare", "apply")):
    keys[role] = str(index).encode() * 32
    path = client / (role + "-token")
    path.write_bytes(keys[role])
    policy["tokens"][role] = str(path)
policy["native_key_file"] = str(native / "callback-key")
Path("/run/crate-infra").mkdir(exist_ok=True)
policy["socket"] = "/run/crate-infra/bridge.sock"
path = LAB_HOME / "policy.json"
path.write_text(json.dumps(policy))


class Commands:
    started = "before"
    effects = 0

    def run(self, args, **kwargs):
        if args[1] == "restart":
            self.started = "after"
            self.effects += 1
            return b""
        if args[1] == "inspect":
            return json.dumps(
                [
                    {
                        "Id": "disposable-synthetic-api",
                        "Image": "sha256:synthetic",
                        "Config": {
                            "Labels": {
                                "com.docker.compose.project": "crate",
                                "com.docker.compose.service": "crate-api",
                            },
                            "Healthcheck": {"Test": ["CMD", "synthetic-ready"]},
                        },
                        "State": {
                            "StartedAt": self.started,
                            "Running": True,
                            "Health": {"Status": "healthy"},
                        },
                    }
                ]
            ).encode()
        raise AssertionError("Unexpected command")


commands = Commands()
state = State(policy["state_directory"])
bridge = Bridge(
    Policy(path, provisioned=False),
    state,
    Executor(Policy(path, provisioned=False), runner=commands),
)
unix = UnixServer(policy["socket"], handler(bridge))
relay = Server(("0.0.0.0", 8788), Handler)
messages, updates, callbacks = [], [], []


class Bot(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if "json" in self.headers.get("Content-Type", ""):
            value = json.loads(raw or b"{}")
        else:
            value = {
                key: values[-1]
                for key, values in urllib.parse.parse_qs(raw.decode()).items()
            }
        method = self.path.rsplit("/", 1)[-1].lower()
        result = True
        if method == "getme":
            result = {
                "id": 123456,
                "is_bot": True,
                "first_name": "Disposable Crate",
                "username": "crate_disposable_bot",
            }
        elif method == "getupdates":
            time.sleep(0.5)
            result = [
                item
                for ready, item in list(updates)
                if ready <= time.time()
                and item["update_id"] >= int(value.get("offset", 0))
            ]
        elif method == "getwebhookinfo":
            result = {"url": "", "pending_update_count": 0}
        elif method == "sendmessage":
            mid = len(messages) + 1
            messages.append(value)
            result = {
                "message_id": mid,
                "date": int(time.time()),
                "chat": {"id": 123, "type": "private"},
                "text": value["text"],
            }
            markup = value.get("reply_markup")
            if isinstance(markup, str):
                markup = json.loads(markup)
            if markup:
                data = markup["inline_keyboard"][0][0]["callback_data"]
                callbacks.append(data)
                updates.append(
                    (
                        time.time() + 1,
                        {
                            "update_id": 10000 + len(updates),
                            "callback_query": {
                                "id": "query-" + str(mid),
                                "from": {
                                    "id": 123,
                                    "is_bot": False,
                                    "first_name": "Human",
                                },
                                "chat_instance": "lab",
                                "message": result,
                                "data": data,
                            },
                        },
                    )
                )
        raw = json.dumps({"ok": True, "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except BrokenPipeError:
            pass  # The disposable gateway cancels long polling during shutdown.


bot = http.server.ThreadingHTTPServer(("127.0.0.1", 8999), Bot)
for server in (unix, relay, bot):
    threading.Thread(target=server.serve_forever, daemon=True).start()
stop = threading.Event()


def worker():
    while not stop.wait(0.2):
        bridge.tick()


threading.Thread(target=worker, daemon=True).start()
env = {
    **os.environ,
    "HERMES_HOME": str(LAB_HOME),
    "XDG_STATE_HOME": str(LAB_HOME / "xdg-state"),
    "CRATE_AGENT_PROFILE": "operator",
    "CRATE_MCP_URL": "http://127.0.0.1:8585/mcp",
    "CRATE_MCP_HOST": "localhost",
    "PYTHONPATH": "/workspace",
}
log = (LAB_HOME / "gateway.log").open("w")
os.chown(LAB_HOME, 10000, 10000)
for child in LAB_HOME.rglob("*"):
    os.chown(child, 10000, 10000)
gateway = subprocess.Popen(
    [sys.executable, str(ASSETS / "runtime.py")],
    env=env,
    stdout=log,
    stderr=subprocess.STDOUT,
    cwd=LAB_HOME,
    user=10000,
    group=10000,
)
api = None
policy_allowed = True
api_calls = []


def probe(phase):
    # This is consumed by the real native PTB plugin in the gateway process;
    # it invokes only existing registered tools, never another adapter/client.
    uid = 10000 + len(updates)
    text = "/crate_probe " + phase
    updates.append(
        (
            time.time(),
            {
                "update_id": uid,
                "message": {
                    "message_id": uid,
                    "date": int(time.time()),
                    "chat": {"id": 123, "type": "private"},
                    "from": {"id": 123, "is_bot": False, "first_name": "Human"},
                    "text": text,
                    "entities": [{"type": "bot_command", "offset": 0, "length": 12}],
                },
            },
        )
    )
    deadline = time.time() + 60
    while time.time() < deadline:
        for item in messages:
            if item["text"].startswith("CRATE_PROBE "):
                result = json.loads(item["text"].removeprefix("CRATE_PROBE "))
                if result["phase"] == phase:
                    assert all(result["registered"].values()), result
                    assert result["registered_domain_tools"] > 50, result
                    assert result["pid"] == gateway.pid, result
                    assert result["home"] == result["cwd"] == str(LAB_HOME), result
                    assert result["uid"] == 10000, result
                    assert result["xdg_state_home"] == str(LAB_HOME / "xdg-state"), (
                        result
                    )
                    return result
        time.sleep(0.2)
    raise AssertionError(
        "Gateway probe missing: " + (LAB_HOME / "gateway.log").read_text()[-8000:]
    )


def owned_domain_adapter():
    found = []
    for process in Path("/proc").glob("[0-9]*"):
        try:
            command = (process / "cmdline").read_bytes().split(b"\0")
            parent = int((process / "stat").read_text().split()[3])
            if (
                str(ASSETS / "domain_mcp.py").encode() in command
                and parent == gateway.pid
            ):
                found.append(int(process.name))
        except (OSError, ValueError):
            pass
    assert len(found) == 1, found
    return found[0]


class API(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        method, params = request["method"], request.get("params", {})
        api_calls.append((method, params.get("name")))
        if method == "tools/list":
            result = {
                "tools": json.loads((ASSETS / "operator-catalog.json").read_text())
            }
        elif params.get("name") == "get_confirmation_policy":
            result = {
                "structuredContent": {
                    "data": {
                        "operator_provenance_required": policy_allowed,
                        "require_approval": True,
                        "actions_enabled": True,
                        "instance_id": "lab",
                        "credential_id": "synthetic",
                        "principal_id": "synthetic",
                        "policy_revision": 1,
                        "grants": ["library.metadata.write"],
                    }
                }
            }
        else:
            payload = {"data": {"recovered": True, "tool": params.get("name")}}
            result = {
                "structuredContent": payload,
                "content": [{"type": "text", "text": json.dumps(payload)}],
                "isError": False,
            }
        raw = json.dumps(
            {"jsonrpc": "2.0", "id": request["id"], "result": result}
        ).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(raw)


try:
    # No API server, no valid domain provenance/context: actual runtime still starts.
    deadline = time.time() + 100
    while time.time() < deadline:
        if gateway.poll() is not None:
            raise AssertionError(
                "Gateway exited: " + (LAB_HOME / "gateway.log").read_text()[-5000:]
            )
        try:
            current = json.loads((LAB_HOME / "gateway_state.json").read_text())
            if (
                current.get("platforms", {}).get("telegram", {}).get("state")
                == "connected"
            ):
                break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise AssertionError(
            "Gateway did not connect: " + (LAB_HOME / "gateway.log").read_text()[-5000:]
        )
    # Discovery has already run inside this gateway before Telegram connects.
    cold = probe("cold")
    assert all(
        "recovered" not in value and "unavailable" in value.lower()
        for value in cold["results"].values()
    ), cold
    cold_repeat = probe("cold-repeat")
    cold_third = probe("cold-third")
    assert cold_repeat["handlers"] == cold_third["handlers"] == cold["handlers"]
    assert all(
        "unavailable" in value.lower()
        for result in (cold_repeat, cold_third)
        for value in result["results"].values()
    )
    adapter_pid = owned_domain_adapter()
    # Direct signed delivery exercises the real pinned webhook implementation.
    transport = HermesTransport(
        "http://127.0.0.1:8644/webhooks/crate-operator",
        "delivery-" + "a" * 40,
        "crate-operator",
    )
    assert (
        transport.send(
            {"id": "smoke-incident", "message": "Deterministic incident smoke"},
            "smoke-attempt",
            time.time(),
        )
        == "delivered"
    )
    plan = bridge.prepare(
        keys["prepare"], operation="restart", target="crate-api", human_id=123
    )
    deadline = time.time() + 90
    while time.time() < deadline:
        outcome = bridge.read(keys["read"], plan_id=plan["id"])
        if outcome["state"] in {
            "completed",
            "succeeded",
            "failed",
            "indeterminate",
            "invalidated",
        }:
            break
        time.sleep(1)
    assert commands.effects == 1, outcome
    assert outcome["state"] == "succeeded", outcome
    assert any("Deterministic incident smoke" in item["text"] for item in messages)
    assert callbacks and callbacks[-1].endswith(":approve")
    # Use the actual gateway registry/dispatch and its already connected child.
    # This harness never invokes discovery or starts a standalone domain adapter.
    api = http.server.ThreadingHTTPServer(("127.0.0.1", 8585), API)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    recovered = probe("recovered")

    def recovered_payload(value):
        wrapper = json.loads(value)
        payload = wrapper.get("structuredContent") or json.loads(wrapper["result"])
        return payload["data"]["recovered"] is True

    assert all(recovered_payload(value) for value in recovered["results"].values()), (
        recovered
    )
    assert recovered["handlers"] == cold["handlers"], (cold, recovered)
    assert ("tools/call", "get_confirmation_policy") in api_calls
    assert ("tools/call", "preview_job_retry") in api_calls
    writes = api_calls.count(("tools/call", "preview_job_retry"))
    policy_allowed = False
    revoked = probe("revoked")
    assert recovered_payload(revoked["results"]["read"]), revoked
    assert "unavailable" in revoked["results"]["prepare"].lower(), revoked
    assert api_calls.count(("tools/call", "preview_job_retry")) == writes
    assert revoked["handlers"] == cold["handlers"]
    assert gateway.poll() is None and owned_domain_adapter() == adapter_pid
    # Native test commands are handled without a model turn. Only loopback exists.
    evidence = {
        "gateway": "pinned-v0.22.2",
        "api_at_cold_start": "unavailable",
        "domain_context": "missing",
        "native_callbacks": callbacks,
        "infra_effects": commands.effects,
        "infra_outcome": outcome["state"],
        "signed_delivery": True,
        "model_requests": 0,
        "gateway_owned_domain_reconnect": True,
        "gateway_pid": gateway.pid,
        "gateway_adapter_pid": adapter_pid,
        "gateway_registered_domain_tools": cold["registered_domain_tools"],
        "gateway_current_policy_revocation": True,
        "gateway_handler_identity_stable": True,
        "cold_unavailable_calls": 6,
        "automatic_recovery_without_circuit_reset": True,
        "uid": cold["uid"],
        "home": cold["home"],
        "cwd": cold["cwd"],
        "xdg_state_home": cold["xdg_state_home"],
        "telegram": "loopback-fake",
    }
    print(json.dumps(evidence))
except BaseException:
    print(json.dumps({"api_calls": api_calls}), file=sys.stderr)
    print((LAB_HOME / "gateway.log").read_text()[-20000:], file=sys.stderr)
    raise
finally:
    if api:
        api.shutdown()
        api.server_close()
    stop.set()
    gateway.terminate()
    try:
        gateway.wait(timeout=15)
    except subprocess.TimeoutExpired:
        gateway.kill()
        gateway.wait()
    log.close()
    for server in (unix, relay, bot):
        server.shutdown()
        server.server_close()
    state.close()
