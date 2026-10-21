"""Loopback webhook semantics, network faults, retries and durable restart."""

import hashlib
import hmac
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator.delivery import (
    MAX_ATTEMPTS,
    Delivery,
    HermesTransport,
    TransportError,
    request_json,
    validate_url,
)
from deploy.operator.state import State, enqueue


@pytest.fixture
def state(tmp_path):
    value = State(tmp_path)
    with value.transaction() as data:
        enqueue(data, "synthetic alert", 100)
    yield value
    value.close()


@pytest.fixture
def webhook():
    records = []
    options = {"status": "delivered", "code": 200}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            raw = self.rfile.read(int(self.headers["Content-Length"]))
            records.append(
                ({key.lower(): value for key, value in self.headers.items()}, raw)
            )
            if options.get("disconnect"):
                self.connection.close()
                return
            attempt = self.headers.get("X-Request-ID")
            body = json.dumps(
                {
                    "status": options["status"],
                    "delivery_id": attempt,
                    "route": "crate-operator",
                }
            ).encode()
            self.send_response(options["code"])
            if options["code"] == 302:
                self.send_header("Location", options["location"])
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield (
        f"http://127.0.0.1:{server.server_port}/webhooks/crate-operator",
        records,
        options,
    )
    server.shutdown()
    server.server_close()
    thread.join()


def test_v2_signature_fixed_body_and_confirmed_delivery(state, webhook):
    url, records, _ = webhook
    delivery = Delivery(
        state, HermesTransport(url, "synthetic-webhook-secret", "crate-operator")
    )
    assert delivery.tick(100)
    item = next(iter(state.snapshot()["outbox"].values()))
    assert item["state"] == "delivered"
    headers, raw = records[0]
    assert (
        headers["x-webhook-signature-v2"]
        == hmac.new(
            b"synthetic-webhook-secret", b"100." + raw, hashlib.sha256
        ).hexdigest()
    )
    assert headers["x-request-id"] == item["attempts"][0]["id"]
    assert json.loads(raw) == {"logical_id": item["id"], "message": item["message"]}
    assert item["id"] in item["message"]
    assert not delivery.tick(101)


@pytest.mark.parametrize(
    "status,code,outcome",
    [
        ("duplicate", 200, "duplicate"),
        ("accepted", 202, "accepted"),
        ("coalesced", 202, "accepted"),
        ("error", 502, "failed"),
        ("delivered", 202, "uncertain"),
        ("ok", 200, "uncertain"),
        ("ignored", 200, "uncertain"),
    ],
)
def test_only_documented_confirmation_counts_as_delivered(
    state, webhook, status, code, outcome
):
    url, records, options = webhook
    options.update(status=status, code=code)
    delivery = Delivery(state, HermesTransport(url, "synthetic", "crate-operator"))
    delivery.tick(100)
    item = next(iter(state.snapshot()["outbox"].values()))
    assert item["state"] == "pending"
    assert item["attempts"][0]["outcome"] == outcome
    assert item["uncertain"] is (outcome != "failed")
    assert not delivery.tick(129)
    options.update(status="delivered", code=200)
    delivery.tick(130)
    assert records[0][0]["x-request-id"] != records[1][0]["x-request-id"]
    assert (
        json.loads(records[0][1])["logical_id"]
        == json.loads(records[1][1])["logical_id"]
    )
    assert next(iter(state.snapshot()["outbox"].values()))["state"] == "delivered"


def test_redirect_rejected_without_forwarding_secrets_or_body(state, webhook):
    url, records, options = webhook
    # Same-origin redirect is also rejected; no request may follow it.
    options.update(code=302, location=url + "/credential-leak")
    delivery = Delivery(
        state, HermesTransport(url, "secret-in-header", "crate-operator")
    )
    delivery.tick(100)
    assert len(records) == 1
    assert (
        next(iter(state.snapshot()["outbox"].values()))["attempts"][0]["outcome"]
        == "uncertain"
    )
    with pytest.raises(TransportError, match="redirect_rejected"):
        request_json(url, payload=b"{}")
    assert len(records) == 2


def test_crash_after_send_is_uncertain_with_new_persisted_attempt_on_restart(tmp_path):
    state = State(tmp_path)
    with state.transaction() as data:
        logical_id = enqueue(data, "synthetic", 100)
    sent = []

    class Crash:
        def send(self, item, attempt, now):
            # Process crash simulation bypasses ordinary network exception handling.
            sent.append(attempt)
            disk = json.loads((tmp_path / "state.json").read_text())
            assert disk["outbox"][logical_id]["state"] == "sending"
            raise SystemExit("after upstream accepted")

    with pytest.raises(SystemExit):
        Delivery(state, Crash()).tick(100)
    state.close()
    state = State(tmp_path)

    class Success:
        def send(self, item, attempt, now):
            sent.append(attempt)
            return "delivered"

    delivery = Delivery(state, Success())
    delivery.recover(110)
    assert (
        state.snapshot()["outbox"][logical_id]["attempts"][0]["outcome"] == "uncertain"
    )
    assert not delivery.tick(139)
    delivery.tick(140)
    assert sent[0] != sent[1]
    assert state.snapshot()["outbox"][logical_id]["uncertain"]
    assert state.snapshot()["outbox"][logical_id]["state"] == "delivered"
    state.close()


def test_dead_letter_requeue_and_bounded_retry_history(state):
    class Failed:
        def send(self, *_):
            raise RuntimeError("https://private/token=secret")

    delivery = Delivery(state, Failed())
    logical_id = next(iter(state.snapshot()["outbox"]))
    for generation in range(4):
        for _ in range(MAX_ATTEMPTS):
            now = state.snapshot()["outbox"][logical_id]["next_at"]
            delivery.tick(now)
        item = state.snapshot()["outbox"][logical_id]
        assert item["state"] == "dead_letter"
        assert len(item["attempts"]) == MAX_ATTEMPTS * (generation + 1)
        assert "private" not in json.dumps(state.snapshot())
        if generation < 3:
            delivery.requeue(logical_id, now + 1)
    with pytest.raises(ValueError):
        delivery.requeue(logical_id, now + 1)


def test_active_silence_defers_existing_outbox_without_erasing_it(state):
    calls = []

    class Sent:
        def send(self, *args):
            calls.append(args)
            return "delivered"

    with state.transaction() as data:
        item = next(iter(data["outbox"].values()))
        item["incident"] = "lab/worker/down"
        data["incidents"][item["incident"]] = {
            "state": "open",
            "silence": {"expires_at": 200},
        }
    delivery = Delivery(state, Sent())
    assert not delivery.tick(150)
    assert not calls
    assert delivery.tick(200)
    assert len(calls) == 1


def test_failed_attempt_cache_cannot_swallow_all_retries(state):
    seen = set()

    class HermesCacheBeforeDelivery:
        def send(self, item, attempt, now):
            if attempt in seen:
                return "duplicate"
            seen.add(attempt)
            return "failed" if len(seen) == 1 else "delivered"

    delivery = Delivery(state, HermesCacheBeforeDelivery())
    delivery.tick(100)
    delivery.tick(130)
    item = next(iter(state.snapshot()["outbox"].values()))
    assert item["state"] == "delivered" and len(seen) == 2


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "https://user:password@host/",
        "https://host/?token=secret",
        "https://host/#fragment",
        "not-a-url",
    ],
)
def test_only_fixed_http_endpoints(url):
    with pytest.raises(ValueError):
        validate_url(url)


def test_transport_errors_redact_token_bearing_url(monkeypatch):
    import urllib.request

    monkeypatch.setattr(
        urllib.request.OpenerDirector,
        "open",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            OSError("https://api.telegram.org/bot123:SECRET/sendMessage")
        ),
    )
    with pytest.raises(TransportError) as error:
        request_json("https://api.telegram.org/bot123:SECRET/sendMessage")
    assert str(error.value) == "transport_or_response_failure"


def test_delivery_inspection_is_bounded_and_hides_message(state):
    class Sender:
        def send(self, *_):
            return "failed"

    delivery = Delivery(state, Sender())
    delivery.tick(100)
    result = delivery.inspect()
    assert len(result["items"]) == 1
    assert result["items"][0]["attempts"][0]["outcome"] == "failed"
    assert "message" not in result["items"][0]
    with pytest.raises(ValueError):
        delivery.inspect(limit=51)


def test_loopback_connection_drop_is_uncertain_then_retries(state, webhook):
    url, records, options = webhook
    options["disconnect"] = True
    delivery = Delivery(state, HermesTransport(url, "synthetic", "crate-operator"))
    delivery.tick(100)
    item = next(iter(state.snapshot()["outbox"].values()))
    assert item["uncertain"] and item["state"] == "pending"
    options["disconnect"] = False
    delivery.tick(130)
    assert next(iter(state.snapshot()["outbox"].values()))["state"] == "delivered"
    assert records[0][0]["x-request-id"] != records[1][0]["x-request-id"]
