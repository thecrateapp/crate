"""Private fixed Unix-socket relay. No authority keys, destinations or host commands."""

import http.client
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOCKET = "/run/crate-infra/bridge.sock"
PATHS = {"/v1/read", "/v1/prepare", "/v1/apply", "/v1/reconcile", "/v1/native/events"}


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(SOCKET)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(8)

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


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        self.connection.settimeout(5)
        status, raw = 503, b'{"error":"bridge_unavailable"}'
        connection = None
        try:
            if (
                self.path not in PATHS
                or self.headers.get("Transfer-Encoding")
                or len(self.headers.get_all("Content-Length", [])) != 1
            ):
                raise ValueError("Closed route/length required")
            length = int(self.headers["Content-Length"])
            if not 0 < length <= 16384:
                raise ValueError("Bound exceeded")
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Incomplete body")
            headers = {
                key: self.headers[key]
                for key in (
                    "Authorization",
                    "Content-Type",
                    "X-Crate-Timestamp",
                    "X-Crate-Nonce",
                    "X-Crate-Signature",
                )
                if key in self.headers
            }
            connection = UnixConnection("localhost", timeout=60)
            connection.request("POST", self.path, body, headers)
            response = connection.getresponse()
            status, raw = response.status, response.read(200001)
            if len(raw) > 200000 or status not in {200, 400, 401, 403, 404, 409, 503}:
                raise ValueError("Invalid upstream result")
        except ValueError:
            status, raw = 400, b'{"error":"invalid_relay_request"}'
        except (OSError, http.client.HTTPException):
            pass
        finally:
            if connection:
                connection.close()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


if __name__ == "__main__":
    Server(("0.0.0.0", 8788), Handler).serve_forever()
