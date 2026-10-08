"""Generic cache storage helpers backed by L1, Redis, and PostgreSQL."""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from crate.db.cache_runtime import (
    get_redis,
    _mem_cache,
    _MEM_TTL,
    _mem_delete,
    _mem_delete_prefix,
    _mem_get,
    _mem_lock,
    _mem_set,
)
from crate.db.tx import read_scope, transaction_scope


SMART_MIX_PLAN_CACHE_PREFIX = "smart-mix:transition-plan:v1:"
SMART_MIX_PLAN_CACHE_TTL_SECONDS = 6 * 60 * 60
_SMART_MIX_PLAN_PRUNE_INTERVAL_SECONDS = 5 * 60
_SMART_MIX_PLAN_PRUNE_BATCH_SIZE = 500
_smart_mix_plan_prune_lock = threading.Lock()
_smart_mix_plan_last_prune_at = 0.0


def get_cache(key: str, max_age_seconds: int | None = None) -> Any | None:
    val = _mem_get(key, max_age_seconds=max_age_seconds)
    if val is not None:
        return val

    redis_client = get_redis()
    if redis_client:
        try:
            redis_key = f"cache:{key}"
            pipeline = redis_client.pipeline(transaction=False)
            pipeline.get(redis_key)
            pipeline.pttl(redis_key)
            raw, remaining_ttl_ms = pipeline.execute()
            if raw is not None:
                val = json.loads(raw)
                l1_ttl = _remaining_l1_ttl(
                    remaining_ttl_ms,
                    max_age_seconds=max_age_seconds,
                )
                if l1_ttl > 0:
                    _mem_set(key, val, l1_ttl)
                return val
        except Exception:
            pass

    try:
        with read_scope() as session:
            row = (
                session.execute(
                    text("SELECT value_json, updated_at FROM cache WHERE key = :key"),
                    {"key": key},
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            if max_age_seconds is not None:
                try:
                    updated = row["updated_at"]
                    if isinstance(updated, str):
                        updated = datetime.fromisoformat(updated)
                    if updated.tzinfo is None:
                        updated = updated.replace(tzinfo=timezone.utc)
                    age = (datetime.now(timezone.utc) - updated).total_seconds()
                    if age > max_age_seconds:
                        return None
                except (ValueError, TypeError):
                    return None
            val = row["value_json"]
            if redis_client and val is not None:
                try:
                    redis_ttl = max_age_seconds or 86400
                    redis_client.setex(f"cache:{key}", redis_ttl, json.dumps(val))
                except Exception:
                    pass
            _mem_set(key, val)
            return val
    except Exception:
        return None


def set_cache(key: str, value: Any, ttl: int | None = None) -> None:
    _mem_set(key, value, min(ttl or 86400, 300))

    redis_client = get_redis()
    if redis_client:
        try:
            redis_ttl = ttl or 86400
            redis_client.setex(
                f"cache:{key}", redis_ttl, json.dumps(value, default=str)
            )
            return
        except Exception:
            pass

    try:
        now = datetime.now(timezone.utc).isoformat()
        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO cache (key, value_json, updated_at) VALUES (:key, :value_json, :updated_at) "
                    "ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at"
                ),
                {
                    "key": key,
                    "value_json": json.dumps(value, default=str),
                    "updated_at": now,
                },
            )
    except Exception:
        pass


def get_smart_mix_plan_cache(plan_key: str) -> dict[str, Any] | None:
    value = get_cache(
        f"{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}",
        max_age_seconds=SMART_MIX_PLAN_CACHE_TTL_SECONDS,
    )
    return value if isinstance(value, dict) else None


def set_smart_mix_plan_cache(plan_key: str, value: dict[str, Any]) -> None:
    set_cache(
        f"{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}",
        value,
        ttl=SMART_MIX_PLAN_CACHE_TTL_SECONDS,
    )
    _maybe_prune_smart_mix_plan_cache()


def _maybe_prune_smart_mix_plan_cache() -> None:
    global _smart_mix_plan_last_prune_at

    now = time.monotonic()
    with _smart_mix_plan_prune_lock:
        if now - _smart_mix_plan_last_prune_at < _SMART_MIX_PLAN_PRUNE_INTERVAL_SECONDS:
            return
        _smart_mix_plan_last_prune_at = now

    cutoff = datetime.now(timezone.utc) - timedelta(
        seconds=SMART_MIX_PLAN_CACHE_TTL_SECONDS
    )
    try:
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    DELETE FROM cache
                    WHERE ctid IN (
                        SELECT ctid
                        FROM cache
                        WHERE key LIKE :prefix
                          AND updated_at < :cutoff
                        ORDER BY updated_at
                        LIMIT :batch_size
                    )
                    """
                ),
                {
                    "prefix": f"{SMART_MIX_PLAN_CACHE_PREFIX}%",
                    "cutoff": cutoff,
                    "batch_size": _SMART_MIX_PLAN_PRUNE_BATCH_SIZE,
                },
            )
    except Exception:
        pass


def delete_cache(key: str) -> None:
    _mem_delete(key)

    redis_client = get_redis()
    if redis_client:
        try:
            redis_client.delete(f"cache:{key}")
        except Exception:
            pass

    try:
        with transaction_scope() as session:
            session.execute(text("DELETE FROM cache WHERE key = :key"), {"key": key})
    except Exception:
        pass


def delete_cache_prefix(prefix: str) -> None:
    _mem_delete_prefix(prefix)

    redis_client = get_redis()
    if redis_client:
        try:
            cursor = 0
            while True:
                cursor, keys = redis_client.scan(
                    cursor, match=f"cache:{prefix}*", count=100
                )
                if keys:
                    redis_client.delete(*keys)
                if cursor == 0:
                    break
        except Exception:
            pass

    try:
        with transaction_scope() as session:
            session.execute(
                text("DELETE FROM cache WHERE key LIKE :prefix"),
                {"prefix": prefix + "%"},
            )
    except Exception:
        pass


def get_cache_stats() -> dict:
    with _mem_lock:
        stats = {"l1_size": len(_mem_cache)}
    redis_client = get_redis()
    if redis_client:
        try:
            info = redis_client.info("memory")
            stats["redis_used_memory"] = info.get("used_memory_human", "?")
            stats["redis_keys"] = redis_client.dbsize()
            stats["redis_connected"] = True
        except Exception:
            stats["redis_connected"] = False
    else:
        stats["redis_connected"] = False
    return stats


def clear_all_cache_tables() -> None:
    with transaction_scope() as session:
        session.execute(text("DELETE FROM cache"))
        session.execute(text("DELETE FROM mb_cache"))


def _remaining_l1_ttl(
    remaining_ttl_ms: int | str | None,
    *,
    max_age_seconds: int | None,
) -> float:
    try:
        ttl_ms = int(remaining_ttl_ms) if remaining_ttl_ms is not None else -1
    except (TypeError, ValueError):
        ttl_ms = -1

    if ttl_ms == -2 or ttl_ms == 0:
        return 0
    if ttl_ms > 0:
        source_ttl = ttl_ms / 1000
        return min(source_ttl, max_age_seconds) if max_age_seconds else source_ttl
    return float(max_age_seconds or _MEM_TTL)


__all__ = [
    "SMART_MIX_PLAN_CACHE_TTL_SECONDS",
    "clear_all_cache_tables",
    "delete_cache",
    "delete_cache_prefix",
    "get_cache",
    "get_cache_stats",
    "get_smart_mix_plan_cache",
    "set_cache",
    "set_smart_mix_plan_cache",
]
