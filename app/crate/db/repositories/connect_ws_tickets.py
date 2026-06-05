"""Short-lived one-time tickets for Crate Connect WebSockets."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any
from urllib.parse import quote

from crate.auth import _get_jwt_secret
from crate.db.cache_runtime import get_redis

CONNECT_WS_TICKET_TTL_SECONDS = 60
_USED_TICKETS: dict[str, float] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


@lru_cache(maxsize=1)
def _ticket_secret() -> str:
    return os.environ.get("CRATE_CONNECT_WS_TICKET_SECRET") or _get_jwt_secret()


def clear_connect_ws_ticket_cache_for_tests() -> None:
    _ticket_secret.cache_clear()
    _USED_TICKETS.clear()


def _base64_url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _base64_url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _sign(payload_b64: str) -> str:
    digest = hmac.new(
        _ticket_secret().encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return _base64_url_encode(digest)


def _mark_ticket_used(jti: str, expires_at: datetime) -> bool:
    ttl = max(1, int((expires_at - _now()).total_seconds()))
    redis_client = get_redis()
    if redis_client is not None:
        try:
            return bool(
                redis_client.set(f"connect:ws:ticket:{jti}", "1", ex=ttl, nx=True)
            )
        except Exception:
            pass

    now_ts = time.time()
    for used_jti, used_exp in list(_USED_TICKETS.items()):
        if used_exp <= now_ts:
            del _USED_TICKETS[used_jti]
    if jti in _USED_TICKETS:
        return False
    _USED_TICKETS[jti] = now_ts + ttl
    return True


def create_ws_ticket(
    user_id: int,
    *,
    device_id: str,
    expires_in_seconds: int = CONNECT_WS_TICKET_TTL_SECONDS,
) -> dict[str, Any]:
    expires_at = _now() + timedelta(seconds=expires_in_seconds)
    payload = {
        "v": "v2",
        "user_id": user_id,
        "device_id": device_id,
        "jti": uuid.uuid4().hex,
        "exp": int(expires_at.timestamp()),
    }
    payload_b64 = _base64_url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    ticket = f"v2.{payload_b64}.{_sign(payload_b64)}"
    return {
        "ticket": ticket,
        "expires_at": expires_at,
        "ws_url": f"/api/me/connect/ws?ticket={quote(ticket, safe='')}",
    }


def validate_ws_ticket(ticket: str) -> dict[str, Any] | None:
    parts = str(ticket or "").split(".")
    if len(parts) != 3 or parts[0] != "v2":
        return None
    _prefix, payload_b64, signature = parts
    expected = _sign(payload_b64)
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(_base64_url_decode(payload_b64))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if payload.get("v") != "v2":
        return None
    try:
        user_id = int(payload["user_id"])
        device_id = str(payload["device_id"])
        jti = str(payload["jti"])
        expires_at = datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc)
    except (KeyError, TypeError, ValueError, OSError):
        return None
    if expires_at <= _now() or not device_id or not jti:
        return None
    if not _mark_ticket_used(jti, expires_at):
        return None
    return {"user_id": user_id, "device_id": device_id, "jti": jti}
