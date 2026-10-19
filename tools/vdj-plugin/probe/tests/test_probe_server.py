from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from probe_server import ProbeServer, parse_range

FILES = {"probe-short.wav": 1, "probe-long-throttled.wav": 1}


@pytest.fixture()
def server(tmp_path):
    instance = ProbeServer(
        0, tmp_path, ticket_ttl_seconds=5, throttle_kbps=0, media_files=FILES
    )
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield instance
    instance.shutdown()
    instance.server_close()


def _request(server, path, *, method="GET", headers=None):
    port = server.server_address[1]
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method, headers=headers or {}
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), b""


def _ticket(age_seconds: float = 0.0) -> str:
    return f"{time.time() - age_seconds:.0f}"


def test_server_binds_only_to_loopback(server):
    assert server.server_address[0] == "127.0.0.1"


def test_full_get_and_head_report_the_same_length(server):
    size = (server.media / "probe-short.wav").stat().st_size
    status, headers, body = _request(
        server, f"/media/probe-short.wav?ticket={_ticket()}"
    )
    head_status, head_headers, head_body = _request(
        server, f"/media/probe-short.wav?ticket={_ticket()}", method="HEAD"
    )

    assert status == 200 and len(body) == size
    assert head_status == 200 and head_body == b""
    assert head_headers["Content-Length"] == headers["Content-Length"] == str(size)
    assert headers["Accept-Ranges"] == "bytes"


def test_partial_and_suffix_ranges(server):
    size = (server.media / "probe-short.wav").stat().st_size
    path = f"/media/probe-short.wav?ticket={_ticket()}"

    status, headers, body = _request(server, path, headers={"Range": "bytes=10-19"})
    assert status == 206 and len(body) == 10
    assert headers["Content-Range"] == f"bytes 10-19/{size}"

    status, headers, body = _request(server, path, headers={"Range": "bytes=-16"})
    assert status == 206 and len(body) == 16
    assert headers["Content-Range"] == f"bytes {size - 16}-{size - 1}/{size}"


def test_unsatisfiable_range_returns_416(server):
    size = (server.media / "probe-short.wav").stat().st_size
    status, headers, _ = _request(
        server,
        f"/media/probe-short.wav?ticket={_ticket()}",
        headers={"Range": f"bytes={size + 10}-"},
    )

    assert status == 416
    assert headers["Content-Range"] == f"bytes */{size}"


def test_missing_and_expired_tickets_are_rejected(server):
    assert _request(server, "/media/probe-short.wav")[0] == 401
    assert _request(server, f"/media/probe-short.wav?ticket={_ticket(60)}")[0] == 401


def test_every_request_is_logged(server):
    _request(
        server,
        f"/media/probe-short.wav?ticket={_ticket()}",
        headers={"Range": "bytes=0-9"},
    )
    _request(server, f"/media/probe-short.wav?ticket={_ticket(60)}")

    events = [json.loads(line) for line in server.log_path.read_text().splitlines()]
    assert [event["status"] for event in events] == [206, 401]
    assert events[0]["range"] == "bytes=0-9"
    assert events[0]["bytes_sent"] == 10
    assert events[1]["ticket_age_s"] >= 59


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, None),
        ("bytes=0-", (0, 99)),
        ("bytes=90-200", (90, 99)),
        ("bytes=-10", (90, 99)),
        ("bytes=100-", "invalid"),
        ("bytes=5-1", "invalid"),
        ("bytes=0-1,4-5", "invalid"),
        ("items=0-1", "invalid"),
    ],
)
def test_parse_range(header, expected):
    assert parse_range(header, 100) == expected
