"""Private Unix HTTP listener. A separately wired fixed-destination relay may connect."""

import argparse
import json
import os
import socketserver
import threading
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from .infra_executor import Executor, HealthCoverageError
from .infra_plans import NATIVE_PATH, Bridge
from .infra_policy import Policy
from .state import State


class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    block_on_close = True

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


def handler(bridge):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(15)
            super().setup()

        def log_message(self, *args):
            pass

        def do_POST(self):
            self.connection.settimeout(15)
            status = 200
            try:
                if (
                    self.headers.get("Transfer-Encoding")
                    or len(self.headers.get_all("Content-Length", [])) != 1
                ):
                    raise ValueError("Length required")
                length = int(self.headers["Content-Length"])
                if not 0 < length <= 16384:
                    raise ValueError("Body bound")
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError("Truncated body")
                if self.path == NATIVE_PATH:
                    result = bridge.native(body, self.headers)
                else:
                    token = self.headers.get("Authorization", "")
                    if not token.startswith("Bearer "):
                        raise PermissionError("Authority required")
                    value = json.loads(body)
                    token = token[7:].encode()
                    routes = {
                        "/v1/read": bridge.read,
                        "/v1/prepare": bridge.prepare,
                        "/v1/apply": bridge.apply,
                        "/v1/reconcile": bridge.reconcile,
                    }
                    if self.path not in routes or not isinstance(value, dict):
                        raise ValueError("Unknown route")
                    result = routes[self.path](token, **value)
            except HealthCoverageError as exc:
                status, result = (
                    409,
                    {"error": "health_coverage_missing", "services": exc.services},
                )
            except PermissionError:
                status, result = 403, {"error": "authority_denied"}
            except (ValueError, KeyError, TypeError):
                status, result = 400, {"error": "invalid_request_or_state"}
            except Exception:  # noqa: BLE001 — fail closed without exposing host or credential details.
                status, result = 503, {"error": "bridge_unavailable"}
            raw = json.dumps(result, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

    return Handler


def serve(config, *, real=False):
    policy = Policy(config)
    state = State(policy.config["state_directory"])
    bridge = Bridge(policy, state, Executor(policy, real=real))
    path = Path(policy.config["socket"])
    if path.exists():
        # Lifetime writer lock has already excluded another server instance.
        if not path.is_socket():
            raise ValueError("Socket path occupied by non-socket")
        path.unlink()
    stopping = threading.Event()

    def worker():
        while not stopping.wait(1):
            try:
                bridge.tick()
            except Exception:  # noqa: BLE001 — fail closed without exposing host or credential details.
                # A durability failure stops mutation; reads fail closed in State.
                stopping.set()

    thread = threading.Thread(target=worker, daemon=True)
    try:
        with UnixServer(str(path), handler(bridge)) as server:
            os.chmod(path, 0o660)
            thread.start()
            server.serve_forever(poll_interval=0.5)
    finally:
        stopping.set()
        thread.join(timeout=1)
        state.close()
        path.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    serve(args.config, real=args.execute)
