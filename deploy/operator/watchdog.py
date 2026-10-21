"""Independent other-host watchdog and direct fixed-target Telegram fallback.

No Crate database, Redis, MCP, Hermes delivery or model is needed for fallback.
Run only after opt-in provisioning: python -m deploy.operator.watchdog --config ...
"""

import argparse
import json
import math
import re
import signal
import threading
import time
from pathlib import Path

from .delivery import Delivery, request_json, validate_url
from .server import read_secret
from .state import State, enqueue, event, prune


class TelegramTransport:
    def __init__(self, token, chat_id, allowlist):
        if (
            not re.fullmatch(r"[0-9]+:[a-zA-Z0-9_-]{20,100}", token)
            or not re.fullmatch(r"-?[0-9]{1,20}", chat_id)
            or chat_id not in allowlist
        ):
            raise ValueError(
                "Dedicated Telegram token and exact allowlisted chat required"
            )
        self._url = "https://api.telegram.org/bot" + token + "/sendMessage"
        self._chat_id = chat_id

    def send(self, item, attempt_id, now):
        body = json.dumps(
            {
                "chat_id": self._chat_id,
                "text": item["message"],
                "disable_web_page_preview": True,
            }
        ).encode()
        code, response = request_json(
            self._url, payload=body, headers={"Content-Type": "application/json"}
        )
        result = response.get("result")
        if (
            code == 200
            and response.get("ok") is True
            and isinstance(result, dict)
            and type(result.get("message_id")) is int
            and str((result.get("chat") or {}).get("id")) == self._chat_id
        ):
            return "delivered"
        return "failed" if response.get("ok") is False else "uncertain"


class Watchdog:
    def __init__(self, state, delivery, instance, status_url, gateway_url, api_token):
        self.state, self.delivery, self.instance = state, delivery, instance
        self.status_url, self.gateway_url = (
            validate_url(status_url),
            validate_url(gateway_url),
        )
        self.api_token = api_token

    def tick(self, now=None):
        now = time.time() if now is None else now
        problems = []
        try:
            code, status = request_json(
                self.status_url,
                headers={"Authorization": "Bearer " + self.api_token},
                timeout=2,
            )
            heartbeat = status.get("heartbeat_at")
            delivery = status.get("delivery", {})
            if (
                code != 200
                or status.get("instance") != self.instance
                or status.get("state") not in {"ok", "degraded"}
                or type(heartbeat) not in {int, float}
                or not 0 <= now - heartbeat <= 120
            ):
                problems.append("supervisor_heartbeat_unavailable")
            elif status["state"] != "ok":
                problems.append("supervisor_degraded")
            if not isinstance(delivery, dict) or any(
                type(delivery.get(field)) not in {int, float}
                or not math.isfinite(delivery[field])
                or delivery[field] < 0
                for field in (
                    "pending",
                    "dead_letter",
                    "failed_or_uncertain",
                    "oldest_pending_seconds",
                )
            ):
                problems.append("delivery_health_unavailable")
            elif (
                delivery["dead_letter"] > 0
                or delivery["failed_or_uncertain"] > 0
                or delivery["oldest_pending_seconds"] > 120
            ):
                problems.append("delivery_degraded")
        except Exception:  # noqa: BLE001 — isolate failures without leaking private transport details.
            problems.append("supervisor_unreachable")
        try:
            code, gateway = request_json(self.gateway_url, timeout=2)
            if (
                code != 200
                or gateway.get("status") != "ok"
                or gateway.get("platform") != "webhook"
            ):
                problems.append("gateway_unhealthy")
        except Exception:  # noqa: BLE001 — isolate failures without leaking private transport details.
            problems.append("gateway_unreachable")
        with self.state.transaction() as data:
            prune(data, now)
            health = data["health"]
            health["bad"] = health.get("bad", 0) + 1 if problems else 0
            health["good"] = health.get("good", 0) + 1 if not problems else 0
            active = health.get("alert_active", False)
            if (
                problems
                and health["bad"] >= 2
                and (not active or now - health.get("notified_at", 0) >= 3600)
            ):
                enqueue(
                    data,
                    f"External watchdog {self.instance}: {', '.join(problems)}. Inspect supervisor and delivery; no model required.",
                    now,
                )
                event(data, "watchdog_alert", {"problems": problems}, now)
                health.update(alert_active=True, notified_at=now)
            elif not problems and health["good"] >= 2 and active:
                enqueue(
                    data,
                    f"External watchdog {self.instance}: supervisor heartbeat, reported delivery queue and gateway health recovered. End-to-end audio/provider behavior remains unprobed.",
                    now,
                )
                event(data, "watchdog_recovered", {}, now)
                health.update(alert_active=False, notified_at=now)
            health.update(heartbeat_at=now, problems=problems)
        self.delivery.tick(now)
        return problems


def load_config(path):
    path = Path(path)
    if path.stat().st_size > 16384:
        raise ValueError("Watchdog configuration too large")
    config = json.loads(path.read_text())
    required = {
        "instance",
        "state_directory",
        "poll_seconds",
        "supervisor_status_url",
        "gateway_health_url",
        "api_token_file",
        "telegram_token_file",
        "chat_id",
        "allowlist_file",
    }
    if (
        set(config) != required
        or type(config["poll_seconds"]) is not int
        or not 30 <= config["poll_seconds"] <= 60
    ):
        raise ValueError("Closed watchdog configuration with 30–60s interval required")
    if not isinstance(config["instance"], str) or not re.fullmatch(
        r"[a-zA-Z0-9_.-]{1,80}", config["instance"]
    ):
        raise ValueError("Invalid watchdog instance")
    for field in ("supervisor_status_url", "gateway_health_url"):
        validate_url(config[field])
    for field in (
        "state_directory",
        "api_token_file",
        "telegram_token_file",
        "allowlist_file",
    ):
        if not Path(config[field]).is_absolute():
            raise ValueError("Absolute dedicated watchdog paths required")
    return config


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate local config/secrets without network",
    )
    args = parser.parse_args(argv)
    config = load_config(args.config)
    api_token = read_secret(config["api_token_file"])
    telegram_token = read_secret(config["telegram_token_file"])
    allowlist_path = Path(config["allowlist_file"])
    if allowlist_path.stat().st_size > 4096:
        raise ValueError("Watchdog allowlist exceeds bound")
    allowlist = allowlist_path.read_text().splitlines()
    if not 1 <= len(allowlist) <= 30 or any(
        not re.fullmatch(r"-?[0-9]{1,20}", value) for value in allowlist
    ):
        raise ValueError("Exact watchdog chat allowlist required")
    transport = TelegramTransport(telegram_token, config["chat_id"], allowlist)
    if api_token == telegram_token:
        raise ValueError(
            "Distinct watchdog transport and supervisor credentials required"
        )
    if args.check:
        return
    state = State(config["state_directory"])
    try:
        delivery = Delivery(state, transport)
        delivery.recover(time.time())
        watchdog = Watchdog(
            state,
            delivery,
            config["instance"],
            config["supervisor_status_url"],
            config["gateway_health_url"],
            api_token,
        )
        stop = threading.Event()
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda *_: stop.set())
        while not stop.is_set():
            started = time.monotonic()
            watchdog.tick()
            stop.wait(max(0, config["poll_seconds"] - (time.monotonic() - started)))
    finally:
        state.close()


if __name__ == "__main__":
    main()
