"""Shared Redis asyncio helpers for SSE pub/sub streams."""

from __future__ import annotations

import inspect
import logging
import os
import time
from importlib import import_module
from typing import Any

from crate.config import get_redis_url
from crate.metrics import record_later

log = logging.getLogger(__name__)

# A full pool makes every stream fail at once; one warning a minute per kind of
# failure is enough to see it without flooding the log.
FAILURE_LOG_INTERVAL_SECONDS = 60.0
_OPEN_PUBSUB_METRIC = "sse.pubsub.open"
_OPEN_FAILURE_METRIC = "sse.pubsub.open_failures"

_failure_log_state: dict[str, tuple[float, int]] = {}
# Strong references on purpose: a pubsub that is never closed stays counted, so
# the gauge keeps growing exactly as the pool does when something leaks.
_open_pubsubs: set[Any] = set()

_redis_client: Any | None = None
_redis_pool: Any | None = None
_redis_module_marker: int | None = None
_redis_url: str | None = None


def _get_redis_url() -> str:
    return get_redis_url()


def _max_connections() -> int:
    raw = os.environ.get("CRATE_SSE_REDIS_MAX_CONNECTIONS", "128")
    try:
        return max(8, min(512, int(raw)))
    except ValueError:
        return 128


def get_async_redis() -> Any:
    global _redis_client, _redis_pool, _redis_module_marker, _redis_url

    redis_url = _get_redis_url()
    aioredis = import_module("redis.asyncio")
    module_marker = id(aioredis)
    if (
        _redis_client is not None
        and _redis_pool is not None
        and _redis_module_marker == module_marker
        and _redis_url == redis_url
    ):
        return _redis_client

    connection_pool = getattr(aioredis, "ConnectionPool", None)
    redis_cls = getattr(aioredis, "Redis", None)
    if connection_pool is not None and redis_cls is not None:
        _redis_pool = connection_pool.from_url(
            redis_url,
            decode_responses=True,
            max_connections=_max_connections(),
            socket_connect_timeout=2,
            socket_timeout=5,
        )
        _redis_client = redis_cls(connection_pool=_redis_pool)
    else:
        _redis_pool = object()
        _redis_client = aioredis.from_url(redis_url, decode_responses=True)
    _redis_module_marker = module_marker
    _redis_url = redis_url
    return _redis_client


def log_redis_failure(key: str, message: str, *args: object) -> None:
    """Log an async Redis failure at warning, at most once a minute per ``key``.

    Call it from an ``except`` block: the traceback of the current exception is
    attached. Failures inside the interval are counted and reported with the
    next warning.
    """
    now = time.monotonic()
    last, suppressed = _failure_log_state.get(key, (None, 0))
    if last is not None and now - last < FAILURE_LOG_INTERVAL_SECONDS:
        _failure_log_state[key] = (last, suppressed + 1)
        return
    _failure_log_state[key] = (now, 0)
    if suppressed:
        message = f"{message} (%d similar failures since the last warning)"
        args = (*args, suppressed)
    log.warning(message, *args, exc_info=True)


def open_pubsub_count() -> int:
    """Pub/sub subscriptions this process opened and has not closed yet."""
    return len(_open_pubsubs)


def _reset_pubsub_tracking_for_tests() -> None:
    _failure_log_state.clear()
    _open_pubsubs.clear()


def _record_open_pubsubs() -> None:
    record_later(_OPEN_PUBSUB_METRIC, float(len(_open_pubsubs)))


def _open_failure_reason(exc: BaseException) -> str:
    if type(exc).__name__ == "MaxConnectionsError" or "Too many connections" in str(
        exc
    ):
        return "pool_exhausted"
    return "redis_error"


async def _release_pubsub(pubsub) -> None:
    close = getattr(pubsub, "aclose", None)
    if close is None:
        close = getattr(pubsub, "close", None)
    if close is None:
        return
    result = close()
    if inspect.isawaitable(result):
        await result


async def open_pubsub(channel: str):
    """Subscribe to ``channel`` on the shared async pool.

    The caller owns the returned pubsub and must hand it to ``close_pubsub`` on
    every path, including early returns and client disconnects; otherwise its
    connection never returns to the pool.
    """
    pubsub = None
    try:
        pubsub = get_async_redis().pubsub()
        await pubsub.subscribe(channel)
    except Exception as exc:
        record_later(_OPEN_FAILURE_METRIC, 1.0, {"reason": _open_failure_reason(exc)})
        log_redis_failure(
            "open_pubsub",
            "Could not subscribe to %s; streams fall back to polling",
            channel,
        )
        if pubsub is not None:
            try:
                await _release_pubsub(pubsub)
            except Exception:
                log.debug("Could not release a failed pubsub", exc_info=True)
        raise
    _open_pubsubs.add(pubsub)
    _record_open_pubsubs()
    return pubsub


async def close_pubsub(pubsub, channel: str) -> None:
    """Unsubscribe and return the connection to the pool; errors are logged, not raised."""
    try:
        await pubsub.unsubscribe(channel)
    except Exception:
        log.debug("Could not unsubscribe from %s", channel, exc_info=True)
    try:
        await _release_pubsub(pubsub)
    except Exception:
        log_redis_failure(
            "close_pubsub", "Could not release the pubsub connection for %s", channel
        )
    finally:
        if pubsub in _open_pubsubs:
            _open_pubsubs.discard(pubsub)
            _record_open_pubsubs()
