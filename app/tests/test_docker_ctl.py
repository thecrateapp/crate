from __future__ import annotations

import socketserver
import tempfile
import threading
from pathlib import Path

import pytest

from crate import docker_ctl


class _Recorder(socketserver.StreamRequestHandler):
    requests: list[bytes] = []
    responses: list[bytes] = []

    def handle(self):
        request_line = self.rfile.readline()
        if not request_line:
            return
        self.requests.append(request_line)
        while self.rfile.readline() not in (b"\r\n", b""):
            pass
        self.wfile.write(self.responses.pop(0))


def _http(status: str, body: bytes = b"", content_type: str = "application/json"):
    return (
        f"HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\n"
        f"Content-Length: {len(body)}\r\n\r\n"
    ).encode() + body


@pytest.fixture
def tcp_docker(monkeypatch):
    _Recorder.requests = []
    _Recorder.responses = []
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _Recorder)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(docker_ctl, "DOCKER_SOCKET", "/tmp/crate-no-docker-here.sock")
    monkeypatch.setenv("DOCKER_HOST", f"tcp://127.0.0.1:{server.server_address[1]}")
    yield _Recorder
    server.shutdown()
    server.server_close()


def test_call_uses_the_tcp_endpoint_from_docker_host(tcp_docker):
    tcp_docker.responses.extend(
        [_http("200 OK", b'{"Name":"crate-prod"}'), _http("204 No Content")]
    )

    assert docker_ctl.daemon_name() == "crate-prod"
    assert docker_ctl.container_action("slskd", "restart") == "done"
    assert tcp_docker.requests == [
        b"GET /info HTTP/1.1\r\n",
        b"POST /containers/slskd/restart?t=10 HTTP/1.1\r\n",
    ]


def test_is_available_checks_the_tcp_endpoint(tcp_docker, monkeypatch):
    assert docker_ctl.is_available() is True

    monkeypatch.setenv("DOCKER_HOST", "tcp://127.0.0.1:1")
    assert docker_ctl.is_available() is False


def test_logs_are_read_through_the_tcp_endpoint(tcp_docker):
    frame = b"\x01\x00\x00\x00\x00\x00\x00\x06ready\n"
    tcp_docker.responses.append(
        _http("200 OK", frame, "application/vnd.docker.multiplexed-stream")
    )

    assert docker_ctl.get_container_logs("crate-worker", tail=5) == "ready"
    assert tcp_docker.requests == [
        b"GET /containers/crate-worker/logs?stdout=true&stderr=true&tail=5 HTTP/1.1\r\n"
    ]


def test_unreachable_tcp_endpoint_raises_docker_unavailable(monkeypatch):
    monkeypatch.setenv("DOCKER_HOST", "tcp://127.0.0.1:1")

    with pytest.raises(docker_ctl.DockerUnavailableError):
        docker_ctl._call("GET", "/containers/json")


@pytest.mark.parametrize(
    "endpoint", ["ssh://docker@host", "tcp://", "tcp://host:notaport", "npipe:////./x"]
)
def test_invalid_docker_host_fails_closed(monkeypatch, endpoint):
    monkeypatch.setenv("DOCKER_HOST", endpoint)

    with pytest.raises(docker_ctl.DockerUnavailableError):
        docker_ctl._call("GET", "/info")
    assert docker_ctl.is_available() is False


def test_unix_scheme_and_default_socket_are_both_supported(monkeypatch):
    directory = tempfile.mkdtemp(dir="/tmp")
    path = str(Path(directory) / "d.sock")
    _Recorder.requests = []
    _Recorder.responses = [_http("200 OK", b"[]"), _http("200 OK", b"[]")]
    server = socketserver.UnixStreamServer(path, _Recorder)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setenv("DOCKER_HOST", f"unix://{path}")
        assert docker_ctl._call("GET", "/containers/json") == (200, [])

        monkeypatch.delenv("DOCKER_HOST")
        monkeypatch.setattr(docker_ctl, "DOCKER_SOCKET", path)
        assert docker_ctl._call("GET", "/containers/json") == (200, [])
    finally:
        server.shutdown()
        server.server_close()


def test_call_decodes_chunked_bodies_with_lowercase_proxy_headers(tcp_docker):
    tcp_docker.responses.append(
        b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n"
        b"transfer-encoding: chunked\r\n\r\n"
        b'5\r\n{"Nam\r\nd\r\ne":"crate-a"}\r\n0\r\n\r\n'
    )

    assert docker_ctl._call("GET", "/info") == (200, {"Name": "crate-a"})
