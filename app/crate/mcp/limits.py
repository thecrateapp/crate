"""Shared admission limits across API processes and integrations."""

import logging
from contextlib import contextmanager
from functools import lru_cache
from threading import Event, Thread
from uuid import uuid4

from redis import Redis

from crate.agent_diagnostics import DiagnosticError
from crate.config import get_durable_redis_url

_ACQUIRE = """
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 60)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= 60 then return 60 end
if redis.call('ZCARD', KEYS[2]) >= 2 or redis.call('ZCARD', KEYS[3]) >= 8 then return 1 end
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('ZADD', KEYS[2], now + 60, ARGV[1])
redis.call('ZADD', KEYS[3], now + 60, ARGV[1])
for i=1,3 do redis.call('EXPIRE', KEYS[i], 65) end
return 0
"""

_RENEW = """
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
for i=1,2 do
    local expiry = redis.call('ZSCORE', KEYS[i], ARGV[1])
    if not expiry or tonumber(expiry) <= now then return 0 end
end
for i=1,2 do
    redis.call('ZADD', KEYS[i], now + 60, ARGV[1])
    redis.call('EXPIRE', KEYS[i], 65)
end
return 1
"""
_RENEW_INTERVAL = 15


@lru_cache(maxsize=1)
def _redis():
    return Redis.from_url(
        get_durable_redis_url(), socket_timeout=2, socket_connect_timeout=2
    )


@contextmanager
def admission(principal_id):
    token = uuid4().hex
    keys = [
        f"crate:{{mcp}}:rate:{principal_id}",
        f"crate:{{mcp}}:active:{principal_id}",
        "crate:{mcp}:active",
    ]
    try:
        retry = int(_redis().eval(_ACQUIRE, 3, *keys, token))
    except Exception:  # noqa: BLE001 — admission must fail closed.
        raise DiagnosticError(
            "SERVICE_UNAVAILABLE", "Admission control unavailable", 5
        ) from None
    if retry:
        raise DiagnosticError(
            "RATE_LIMITED", "Diagnostic capacity limit reached", retry
        )
    stopped = Event()
    lost = Event()

    def renew():
        while not stopped.wait(_RENEW_INTERVAL):
            try:
                if not _redis().eval(_RENEW, 2, *keys[1:], token):
                    lost.set()
                    return
            except Exception:  # noqa: BLE001 — never report success after losing admission.
                lost.set()
                return

    renewal = Thread(target=renew, name="mcp-admission-lease", daemon=True)
    renewal.start()
    try:
        yield
    finally:
        stopped.set()
        renewal.join(timeout=3)
        try:
            _redis().eval(
                "redis.call('ZREM', KEYS[1], ARGV[1]); return redis.call('ZREM', KEYS[2], ARGV[1])",
                2,
                *keys[1:],
                token,
            )
        except Exception:  # noqa: BLE001 — expiry recovers a lease after backend failure.
            # Leases expire after a process crash or Redis interruption.
            logging.getLogger(__name__).warning(
                "MCP admission lease release failed; awaiting expiry"
            )
    if lost.is_set():
        raise DiagnosticError("SERVICE_UNAVAILABLE", "Admission lease lost", 5)
