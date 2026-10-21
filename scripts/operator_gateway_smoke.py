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
(ASSETS / "config.operator.json").write_text(json.dumps(config))
(LAB_HOME / "plugins").mkdir()
shutil.copytree(
    ASSETS / "plugins/crate_confirmation", LAB_HOME / "plugins/crate-confirmation"
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
                            "update_id": 1000 + mid,
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
    "CRATE_HERMES_PROFILE": "operator",
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
gate = subprocess.Popen(
    [sys.executable, str(ASSETS / "domain_mcp.py")],
    env=env,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
    cwd=LAB_HOME,
    user=10000,
    group=10000,
)
api = None


def domain(method, params=None):
    gate.stdin.write(
        json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
        )
        + "\n"
    )
    gate.stdin.flush()
    return json.loads(gate.stdout.readline())


assert "result" in domain("initialize")
assert len(domain("tools/list")["result"]["tools"]) > 50
assert "error" in domain(
    "tools/call", {"name": "get_instance_inventory", "arguments": {}}
)


class API(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        method, params = request["method"], request.get("params", {})
        if method == "tools/list":
            result = {
                "tools": json.loads((ASSETS / "operator-catalog.json").read_text())
            }
        elif params.get("name") == "get_confirmation_policy":
            result = {
                "structuredContent": {
                    "data": {
                        "operator_provenance_required": True,
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
            result = {
                "structuredContent": {"data": {"recovered": True}},
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
    # Same gateway and already initialized adapter survive API recovery. Fresh
    # server policy is consulted on the write; backend PG tests cover its actual
    # provenance/approval/effect enforcement, rather than pretending this fake API
    # is a real domain mutation.
    gateway_pid, adapter_pid = gateway.pid, gate.pid
    api = http.server.ThreadingHTTPServer(("127.0.0.1", 8585), API)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    assert domain("tools/call", {"name": "get_instance_inventory", "arguments": {}})[
        "result"
    ]["structuredContent"]["data"]["recovered"]
    assert domain("tools/call", {"name": "request_plan_confirmation", "arguments": {}})[
        "result"
    ]["structuredContent"]["data"]["recovered"]
    assert (
        gateway.poll() is None
        and gateway.pid == gateway_pid
        and gate.pid == adapter_pid
    )
    # Never send text updates to the model. Network namespace has only loopback.
    evidence = {
        "gateway": "pinned-v0.22.2",
        "api_at_cold_start": "unavailable",
        "domain_context": "missing",
        "native_callbacks": callbacks,
        "infra_effects": commands.effects,
        "infra_outcome": outcome["state"],
        "signed_delivery": True,
        "model_requests": 0,
        "same_process_domain_reconnect": True,
        "uid": 10000,
        "cwd": str(LAB_HOME),
        "xdg_state_home": str(LAB_HOME / "xdg-state"),
        "telegram": "loopback-fake",
    }
    print(json.dumps(evidence))
finally:
    gate.terminate()
    gate.wait(timeout=5)
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
