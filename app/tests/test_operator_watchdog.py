"""External fallback survives the entire primary stack and gateway failing."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator.delivery import Delivery
from deploy.operator.state import State, enqueue
from deploy.operator.watchdog import TelegramTransport, Watchdog, load_config, main

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def harness(tmp_path):
    state = State(tmp_path)
    sent = []

    class Fallback:
        def send(self, item, attempt, now):
            sent.append(item)
            return "delivered"

    observer = Watchdog(
        state,
        Delivery(state, Fallback()),
        "lab",
        "http://127.0.0.1:1/v1/status",
        "http://127.0.0.1:2/health",
        "synthetic-read-bearer",
    )
    yield observer, state, sent
    state.close()


def test_primary_stack_down_external_fallback_and_recovery(harness, monkeypatch):
    observer, state, sent = harness
    from deploy.operator import watchdog

    monkeypatch.setattr(
        watchdog,
        "request_json",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            ConnectionError("private-secret")
        ),
    )
    observer.tick(100)
    assert not sent
    observer.tick(145)
    assert len(sent) == 1
    assert (
        "supervisor_unreachable" in sent[0]["message"]
        and "gateway_unreachable" in sent[0]["message"]
    )
    assert "private-secret" not in json.dumps(state.snapshot())
    observer.tick(190)
    assert len(sent) == 1

    def healthy(url, **_kwargs):
        if "health" in url:
            return 200, {"status": "ok", "platform": "webhook"}
        return 200, {
            "instance": "lab",
            "state": "ok",
            "heartbeat_at": 235,
            "delivery": {
                "pending": 0,
                "dead_letter": 0,
                "failed_or_uncertain": 0,
                "oldest_pending_seconds": 0,
            },
        }

    monkeypatch.setattr(watchdog, "request_json", healthy)
    observer.tick(235)
    observer.tick(280)
    assert len(sent) == 2 and "recovered" in sent[1]["message"]


@pytest.mark.parametrize(
    "fault", ["dead_letter", "failed_or_uncertain", "oldest_pending_seconds"]
)
def test_alive_supervisor_with_failed_delivery_is_degraded(harness, monkeypatch, fault):
    observer, _state, sent = harness
    from deploy.operator import watchdog

    def response(url, **_kwargs):
        if "health" in url:
            return 200, {"status": "ok", "platform": "webhook"}
        queue = {
            "pending": 1,
            "dead_letter": 0,
            "failed_or_uncertain": 0,
            "oldest_pending_seconds": 0,
        }
        queue[fault] = 200
        return 200, {
            "instance": "lab",
            "state": "ok",
            "heartbeat_at": 100,
            "delivery": queue,
        }

    monkeypatch.setattr(watchdog, "request_json", response)
    assert "delivery_degraded" in observer.tick(100)
    observer.tick(145)
    assert len(sent) == 1


@pytest.mark.parametrize(
    "status",
    [
        {},
        {"instance": "lab", "state": "ok", "heartbeat_at": 100},
        {"instance": "other", "state": "ok", "heartbeat_at": 100},
        {"instance": "lab", "state": "ok", "heartbeat_at": 1000},
    ],
)
def test_http_200_is_not_health(harness, monkeypatch, status):
    observer, _, _ = harness
    from deploy.operator import watchdog

    monkeypatch.setattr(
        watchdog, "request_json", lambda *_args, **_kwargs: (200, status)
    )
    problems = observer.tick(100)
    assert problems


def test_telegram_uses_only_configured_allowlisted_chat_and_verifies_receipt(
    tmp_path, monkeypatch
):
    from deploy.operator import watchdog

    calls = []

    def transport(url, **kwargs):
        calls.append((url, json.loads(kwargs["payload"])))
        return 200, {"ok": True, "result": {"message_id": 1, "chat": {"id": 12345678}}}

    monkeypatch.setattr(watchdog, "request_json", transport)
    sender = TelegramTransport("12345:" + "a" * 35, "12345678", ["12345678"])
    state = State(tmp_path)
    with state.transaction() as data:
        key = enqueue(data, "synthetic", 100)
    item = state.snapshot()["outbox"][key]
    assert sender.send(item, "attempt", 100) == "delivered"
    assert calls[0][1]["chat_id"] == "12345678" and key in calls[0][1]["text"]
    assert calls[0][0].startswith("https://api.telegram.org/bot")
    monkeypatch.setattr(
        watchdog,
        "request_json",
        lambda *_args, **_kwargs: (
            200,
            {"ok": True, "result": {"message_id": 1, "chat": {"id": 99}}},
        ),
    )
    assert sender.send(item, "attempt", 100) == "uncertain"
    monkeypatch.setattr(
        watchdog, "request_json", lambda *_args, **_kwargs: (429, {"ok": False})
    )
    assert sender.send(item, "attempt", 100) == "failed"
    with pytest.raises(ValueError):
        TelegramTransport("12345:" + "a" * 35, "99", ["12345678"])
    state.close()


def test_watchdog_config_and_check_are_offline(tmp_path, monkeypatch):
    from deploy.operator import watchdog

    config = json.loads((ROOT / "deploy/operator/watchdog.example.json").read_text())
    config["state_directory"] = str(tmp_path / "state")
    for key, value in (
        ("api_token_file", "synthetic-read-only-token"),
        ("telegram_token_file", "12345:" + "a" * 35),
        ("allowlist_file", "12345678"),
    ):
        target = tmp_path / key
        target.write_text(value)
        config[key] = str(target)
    path = tmp_path / "watchdog.json"
    path.write_text(json.dumps(config))
    assert load_config(path)["poll_seconds"] == 45
    monkeypatch.setattr(
        watchdog,
        "request_json",
        lambda *_args, **_kwargs: pytest.fail("offline check attempted network"),
    )
    main(["--config", str(path), "--check"])
    assert not (tmp_path / "state").exists()
    config["poll_seconds"] = 10
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError):
        load_config(path)
