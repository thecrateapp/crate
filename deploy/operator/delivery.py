"""Destination-fixed, crash-safe at-least-once delivery with bounded retries."""

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from .state import event

MAX_ATTEMPTS = 8
MAX_REQUEUES = 3


class TransportError(RuntimeError):
    """Intentionally contains no URL, response body, credential or exception text."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.query
    ):
        raise ValueError(
            "Expected fixed HTTP(S) endpoint without credentials/query/fragment"
        )
    return url


def request_json(url, *, payload=None, headers=None, timeout=5):
    """Bounded standard-library HTTP; no proxies, redirects, or raw transport errors."""
    validate_url(url)
    if not 0 < timeout <= 10:
        raise ValueError("HTTP timeout outside bound")
    request = urllib.request.Request(
        url,
        data=payload,
        headers=headers or {},
        method="POST" if payload is not None else "GET",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        try:
            response = opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if 300 <= response.code < 400:
                raise TransportError("redirect_rejected")
            raw = response.read(65537)
            if len(raw) > 65536:
                raise TransportError("response_too_large")
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise TransportError("invalid_response")
            return response.code, parsed
    except TransportError:
        raise
    except Exception:  # noqa: BLE001 — isolate failures without leaking private transport details.
        raise TransportError("transport_or_response_failure") from None


class HermesTransport:
    def __init__(self, url, secret, route):
        self.url = validate_url(url)
        if not secret or not route or len(route) > 80:
            raise ValueError("Dedicated webhook secret and route required")
        self.secret = secret
        self.route = route

    def send(self, item, attempt_id, now):
        # The route config, not this payload, owns the destination and deliver_only.
        body = json.dumps(
            {"logical_id": item["id"], "message": item["message"]},
            separators=(",", ":"),
        ).encode()
        timestamp = str(int(now))
        signature = hmac.new(
            self.secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256
        ).hexdigest()
        code, response = request_json(
            self.url,
            payload=body,
            headers={
                "Content-Type": "application/json",
                "X-Request-ID": attempt_id,
                "X-Webhook-Timestamp": timestamp,
                "X-Webhook-Signature-V2": signature,
            },
        )
        if response.get("delivery_id") != attempt_id:
            return "uncertain"
        status = response.get("status")
        if (
            code == 200
            and status == "delivered"
            and response.get("route") == self.route
        ):
            return "delivered"
        if code == 502 and status == "error":
            return "failed"
        if code == 200 and status == "duplicate":
            return "duplicate"
        if code == 202 and status in {"accepted", "coalesced"}:
            return "accepted"
        return "uncertain"


class Delivery:
    def __init__(self, state, transport):
        self.state = state
        self.transport = transport

    def recover(self, now):
        """A crash after dispatch can have delivered; never mark that attempt failed."""
        with self.state.transaction() as data:
            for item in data["outbox"].values():
                if item["state"] == "sending":
                    item["attempts"][-1].update(outcome="uncertain", finished_at=now)
                    item.update(
                        state="pending",
                        uncertain=True,
                        next_at=now + 30,
                        updated_at=now,
                    )
                    event(
                        data,
                        "delivery_uncertain",
                        {"id": item["id"], "reason": "restart_during_send"},
                        now,
                    )

    def tick(self, now=None):
        now = time.time() if now is None else now
        # Persist the transport attempt BEFORE network I/O. Every actual retry has
        # a new ID because Hermes remembers failed sends for one hour.
        with self.state.transaction() as data:
            eligible = [
                item
                for item in data["outbox"].values()
                if item["state"] == "pending" and item["next_at"] <= now
            ]
            eligible = [item for item in eligible if not _silenced(data, item, now)]
            if not eligible:
                return False
            item = min(eligible, key=lambda value: value["created_at"])
            current = [
                attempt
                for attempt in item["attempts"]
                if attempt["generation"] == item["generation"]
            ]
            if len(current) >= MAX_ATTEMPTS:
                item.update(state="dead_letter", updated_at=now)
                event(
                    data,
                    "delivery_dead_letter",
                    {"id": item["id"], "uncertain": item["uncertain"]},
                    now,
                )
                return True
            attempt_id = uuid.uuid4().hex
            item["attempts"].append(
                {
                    "id": attempt_id,
                    "started_at": now,
                    "outcome": "sending",
                    "generation": item["generation"],
                }
            )
            item.update(state="sending", updated_at=now)
            sending = dict(item)
        try:
            outcome = self.transport.send(sending, attempt_id, now)
            if outcome not in {
                "delivered",
                "failed",
                "accepted",
                "duplicate",
                "uncertain",
            }:
                outcome = "uncertain"
        except Exception:  # noqa: BLE001 — isolate failures without leaking private transport details.
            outcome = "uncertain"
        with self.state.transaction() as data:
            item = data["outbox"][sending["id"]]
            item["attempts"][-1].update(outcome=outcome, finished_at=now)
            if outcome in {"accepted", "duplicate", "uncertain"}:
                item["uncertain"] = True
            count = sum(
                attempt["generation"] == item["generation"]
                for attempt in item["attempts"]
            )
            status = (
                "delivered"
                if outcome == "delivered"
                else "dead_letter"
                if count >= MAX_ATTEMPTS
                else "pending"
            )
            item.update(
                state=status,
                updated_at=now,
                next_at=now + min(3600, 30 * 2 ** (count - 1)),
            )
            event(
                data,
                "delivery_attempt",
                {
                    "id": item["id"],
                    "attempt_id": attempt_id,
                    "outcome": outcome,
                    "state": status,
                },
                now,
            )
        return True

    def inspect(self, offset=0, limit=20):
        """Bounded queue status, preserving outcomes without transport secrets."""
        if (
            type(offset) is not int
            or not 0 <= offset <= 1000
            or type(limit) is not int
            or not 1 <= limit <= 50
        ):
            raise ValueError("Invalid delivery page")
        items = sorted(
            self.state.snapshot()["outbox"].values(),
            key=lambda item: (item["created_at"], item["id"]),
        )
        selected = []
        for item in items[offset : offset + limit]:
            selected.append(
                {
                    **{
                        key: value
                        for key, value in item.items()
                        if key not in {"message", "attempts"}
                    },
                    "attempts": item["attempts"][-8:],
                    "total_attempts": len(item["attempts"]),
                    "attempt_history_truncated": len(item["attempts"]) > 8,
                }
            )
        while len(json.dumps(selected).encode()) > 50000 and len(selected) > 1:
            selected.pop()
        following = offset + len(selected)
        return {
            "items": selected,
            "next_offset": following if following < len(items) else None,
        }

    def requeue(self, logical_id, now):
        """Local maintenance only; never exported to the model or service bearer."""
        with self.state.transaction() as data:
            item = data["outbox"][logical_id]
            if item["state"] != "dead_letter" or item["generation"] >= MAX_REQUEUES:
                raise ValueError("Not requeueable or requeue limit reached")
            item.update(
                generation=item["generation"] + 1,
                state="pending",
                next_at=now,
                updated_at=now,
            )
            event(data, "delivery_requeued", {"id": logical_id}, now)


def _silenced(data, item, now):
    incident = data["incidents"].get(item.get("incident")) or {}
    return (incident.get("silence") or {}).get("expires_at", 0) > now
