"""Process-local and Redis-backed cache runtime primitives."""

from __future__ import annotations

import logging
import time
from threading import RLock
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from crate.config import get_cache_redis_url

log = logging.getLogger(__name__)

_mem_cache: dict[str, tuple[float, Any]] = {}
_mem_created_at: dict[str, float] = {}
_mem_lock = RLock()
_MEM_TTL = 300
_MEM_MAX_SIZE = 10000

_redis_client: Any | None = None


def _mask_url_secret(url: str) -> str:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return "<invalid-url>"
    if not parsed.password:
        return url
    username = parsed.username or ""
    auth = f"{username}:***@" if username else "***@"
    host = parsed.hostname or ""
    if parsed.port:
        host = f"{host}:{parsed.port}"
    return urlunsplit(
        (parsed.scheme, f"{auth}{host}", parsed.path, parsed.query, parsed.fragment)
    )


def _mem_get(key: str, max_age_seconds: int | None = None) -> Any | None:
    with _mem_lock:
        entry = _mem_cache.get(key)
        now = time.time()
        created_at = _mem_created_at.get(key)
        age_ok = max_age_seconds is None or (
            created_at is not None and now - created_at <= max(0, max_age_seconds)
        )
        if entry and entry[0] > now and age_ok:
            return entry[1]
        if entry:
            del _mem_cache[key]
            _mem_created_at.pop(key, None)
        return None


def _mem_set(key: str, value: Any, ttl: float = _MEM_TTL) -> None:
    if ttl <= 0:
        return
    with _mem_lock:
        now = time.time()
        if len(_mem_cache) >= _MEM_MAX_SIZE:
            sorted_keys = sorted(
                _mem_cache, key=lambda cache_key: _mem_cache[cache_key][0]
            )
            for cache_key in sorted_keys[: _MEM_MAX_SIZE // 5]:
                del _mem_cache[cache_key]
                _mem_created_at.pop(cache_key, None)
        _mem_cache[key] = (now + ttl, value)
        _mem_created_at[key] = now


def _mem_delete(key: str) -> None:
    with _mem_lock:
        _mem_cache.pop(key, None)
        _mem_created_at.pop(key, None)


def _mem_delete_prefix(prefix: str) -> None:
    with _mem_lock:
        for key in [
            cache_key for cache_key in _mem_cache if cache_key.startswith(prefix)
        ]:
            del _mem_cache[key]
            _mem_created_at.pop(key, None)


def _mem_clear() -> None:
    with _mem_lock:
        _mem_cache.clear()
        _mem_created_at.clear()


def get_redis() -> Any | None:
    global _redis_client
    if _redis_client is None:
        import redis as _redis

        url = get_cache_redis_url()
        try:
            _redis_client = _redis.from_url(
                url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2
            )
            _redis_client.ping()
            log.info("Redis connected: %s", _mask_url_secret(url))
        except Exception as exc:
            log.warning(
                "Redis not available (%s), falling back to PostgreSQL: %s",
                _mask_url_secret(url),
                exc,
            )
            _redis_client = None
    return _redis_client


__all__ = [
    "get_redis",
    "_MEM_MAX_SIZE",
    "_MEM_TTL",
    "_mem_cache",
    "_mem_clear",
    "_mem_delete",
    "_mem_delete_prefix",
    "_mem_get",
    "_mem_lock",
    "_mem_set",
]
