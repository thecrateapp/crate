"""Executable single-writer service: fixed MCP reads, read API and bounded watches.

Run `python -m deploy.operator.server --config /etc/crate-operator/config.json`.
Only read/status/events/incidents and watch registration are routed. Human
signatures and delivery maintenance have no model/service-bearer HTTP route.
"""

import argparse
import hmac
import json
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .delivery import (
    Delivery,
    HermesTransport,
    TransportError,
    request_json,
    validate_url,
)
from .state import CapacityError, State, StateUnavailable
from .supervisor import IDENTIFIER, TOOLS, Rule, Supervisor


class MCPReader:
    def __init__(self, url, token):
        self.url = validate_url(url)
        if not token:
            raise ValueError("Dedicated read-only MCP token required")
        self.token = token

    def call(self, name, arguments):
        if name not in TOOLS | {"get_job"}:
            raise ValueError("Only bounded observation and sanitized job reads allowed")
        body = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            }
        ).encode()
        code, value = request_json(
            self.url,
            payload=body,
            timeout=2,
            headers={
                "Authorization": "Bearer " + self.token,
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "MCP-Protocol-Version": "2025-03-26",
            },
        )
        result = value.get("result", {})
        if (
            code != 200
            or value.get("id") != 1
            or not isinstance(result, dict)
            or result.get("isError")
        ):
            raise TransportError("observation_unavailable")
        evidence = result.get("structuredContent")
        if not isinstance(evidence, dict) or evidence.get("schema_version") != "1":
            raise TransportError("observation_schema_mismatch")
        return evidence


def load_config(path):
    path = Path(path)
    if path.stat().st_size > 65536:
        raise ValueError("Configuration too large")
    config = json.loads(path.read_text())
    required = {
        "instance",
        "state_directory",
        "listen_host",
        "listen_port",
        "poll_seconds",
        "mcp_url",
        "mcp_token_file",
        "api_token_file",
        "webhook_url",
        "webhook_secret_file",
        "webhook_route",
        "rules",
    }
    if (
        set(config) != required
        or type(config["poll_seconds"]) is not int
        or not 30 <= config["poll_seconds"] <= 60
    ):
        raise ValueError("Closed configuration and 30–60s poll interval required")
    if (
        config["listen_host"] not in {"127.0.0.1", "0.0.0.0"}
        or type(config["listen_port"]) is not int
        or not 1 <= config["listen_port"] <= 65535
    ):
        raise ValueError("Invalid listener")
    for field in ("mcp_url", "webhook_url"):
        validate_url(config[field])
    for field in (
        "state_directory",
        "mcp_token_file",
        "api_token_file",
        "webhook_secret_file",
    ):
        if not Path(config[field]).is_absolute():
            raise ValueError("Absolute dedicated paths required")
    config["parsed_rules"] = [Rule(**rule) for rule in config["rules"]]
    rules = config["parsed_rules"]
    if (
        not isinstance(config["instance"], str)
        or not IDENTIFIER.fullmatch(config["instance"])
        or not 1 <= len(rules) <= 50
        or len({(rule.subsystem, rule.id) for rule in rules}) != len(rules)
        or len({rule.request_key for rule in rules}) > 8
    ):
        raise ValueError("Invalid instance, rule identities or bounded request count")
    return config


def read_secret(path):
    value = Path(path).read_bytes()
    if (
        not 16 <= len(value.strip()) <= 4096
        or b"\n" in value.strip()
        or b"\r" in value.strip()
    ):
        raise ValueError("Invalid dedicated secret")
    return value.decode().strip()


class Poller:
    def __init__(self, supervisor, reader, delivery):
        self.supervisor, self.reader, self.delivery = supervisor, reader, delivery
        self.watch_offset = 0

    def tick(self, now=None):
        self.supervisor.state.ensure_available()
        responses = {}
        for rule in self.supervisor.rules:
            if rule.request_key not in responses:
                try:
                    responses[rule.request_key] = self.reader.call(
                        rule.tool, rule.arguments or {}
                    )
                except Exception:  # noqa: BLE001 — isolate failures without leaking private transport details.
                    responses[rule.request_key] = {}
        current = time.time() if now is None else now
        self.supervisor.observe(responses, current)
        watches = sorted(self.supervisor.state.snapshot()["watches"])
        if watches:
            self.watch_offset %= len(watches)
            selected = (watches + watches)[
                self.watch_offset : self.watch_offset + min(5, len(watches))
            ]
            for job_id in selected:
                try:
                    response = self.reader.call("get_job", {"job_id": job_id})
                except Exception:  # noqa: BLE001 — isolate failures without leaking private transport details.
                    response = {}
                self.supervisor.observe_job(job_id, response, current)
            self.watch_offset = (self.watch_offset + 5) % len(watches)
        self.delivery.tick(current)


def make_http_server(supervisor, token, host="127.0.0.1", port=0, *, delivery=None):
    if len(token) < 16:
        raise ValueError("Dedicated supervisor read/watch bearer required")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # No private paths, request bodies, bearer or query values in logs.

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def _respond(self, status, value):
            raw = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _authorized(self):
            return hmac.compare_digest(
                self.headers.get("Authorization", ""), "Bearer " + token
            )

        def do_GET(self):
            if not self._authorized():
                self._respond(401, {"error": "unauthorized"})
                return
            parsed = urlsplit(self.path)
            args = parse_qs(parsed.query, keep_blank_values=True)
            try:
                if parsed.path == "/v1/status" and not args:
                    value = supervisor.status(time.time())
                elif parsed.path == "/v1/events" and set(args) <= {"cursor", "limit"}:
                    value = supervisor.state.events(
                        int(args.get("cursor", [0])[0]), int(args.get("limit", [50])[0])
                    )
                elif (
                    parsed.path == "/v1/delivery"
                    and delivery
                    and set(args) <= {"offset", "limit"}
                ):
                    value = delivery.inspect(
                        int(args.get("offset", [0])[0]), int(args.get("limit", [20])[0])
                    )
                elif parsed.path == "/v1/incidents" and set(args) <= {
                    "offset",
                    "limit",
                }:
                    value = supervisor.incidents(
                        int(args.get("offset", [0])[0]), int(args.get("limit", [50])[0])
                    )
                else:
                    self._respond(404, {"error": "unknown_read"})
                    return
                self._respond(200, value)
            except StateUnavailable:
                self._respond(
                    503, {"error": "state_unavailable", "state": "unavailable"}
                )
            except (ValueError, TypeError):
                self._respond(400, {"error": "invalid_bounds"})

        def do_POST(self):
            if not self._authorized():
                self._respond(401, {"error": "unauthorized"})
                return
            if self.path != "/v1/watch-job":
                self._respond(404, {"error": "unknown_action"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= 1024 or self.headers.get("Transfer-Encoding"):
                    raise ValueError("Invalid request size")
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict) or not {"job_id"} <= set(payload) <= {
                    "job_id",
                    "ttl",
                }:
                    raise ValueError("Closed watch fields required")
                value = supervisor.watch_job(
                    payload["job_id"], time.time(), payload.get("ttl", 86400)
                )
                self._respond(200, value)
            except (ValueError, TypeError):
                self._respond(400, {"error": "invalid_watch"})
            except CapacityError:
                self._respond(409, {"error": "watch_capacity"})
            except StateUnavailable:
                self._respond(
                    503, {"error": "state_unavailable", "state": "unavailable"}
                )

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--check",
        action="store_true",
        help="Validate local config/secrets without network",
    )
    mode.add_argument(
        "--requeue",
        metavar="LOGICAL_ID",
        help="Offline maintenance; requires exclusive state lock",
    )
    args = parser.parse_args(argv)
    config = load_config(args.config)
    mcp_token = read_secret(config["mcp_token_file"])
    api_token = read_secret(config["api_token_file"])
    webhook_secret = read_secret(config["webhook_secret_file"])
    if len({mcp_token, api_token, webhook_secret}) != 3:
        raise ValueError(
            "Observer, supervisor API and webhook secrets must be distinct"
        )
    if args.check:
        return
    state = State(config["state_directory"])
    server = None
    try:
        supervisor = Supervisor(state, config["instance"], config["parsed_rules"])
        delivery = Delivery(
            state,
            HermesTransport(
                config["webhook_url"], webhook_secret, config["webhook_route"]
            ),
        )
        if args.requeue:
            delivery.requeue(args.requeue, time.time())
            return
        delivery.recover(time.time())
        poller = Poller(supervisor, MCPReader(config["mcp_url"], mcp_token), delivery)
        server = make_http_server(
            supervisor,
            api_token,
            config["listen_host"],
            config["listen_port"],
            delivery=delivery,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        stop = threading.Event()
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda *_: stop.set())
        while not stop.is_set():
            started = time.monotonic()
            poller.tick()
            deadline = started + config["poll_seconds"]
            while not stop.is_set():
                # HTTP handlers share the fatal latch. Notice their disk failures
                # during idle time as well as at the next polling transaction.
                state.ensure_available()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                stop.wait(min(1, remaining))
    finally:
        if server:
            server.shutdown()
            server.server_close()
        state.close()


if __name__ == "__main__":
    main()
