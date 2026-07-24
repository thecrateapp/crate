"""MusicBrainz cache helpers backed by L1, Redis, and PostgreSQL."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.cache_runtime import get_redis, _mem_get, _mem_set
from crate.db.tx import read_scope, transaction_scope

_MB_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60


def get_mb_cache(key: str) -> Any | None:
    cache_key = f"mb:{key}"
    val = _mem_get(cache_key)
    if val is not None:
        return val

    redis_client = get_redis()
    if redis_client:
        try:
            raw = redis_client.get(cache_key)
            if raw is not None:
                val = json.loads(raw)
                _mem_set(cache_key, val, ttl=3600)
                return val
        except Exception:
            pass

    try:
        with read_scope() as session:
            row = (
                session.execute(
                    text("SELECT value_json FROM mb_cache WHERE key = :key"),
                    {"key": key},
                )
                .mappings()
                .first()
            )
            if row:
                val = row["value_json"]
                if isinstance(val, str):
                    val = json.loads(val)
                if redis_client:
                    try:
                        redis_client.set(
                            cache_key,
                            json.dumps(val, default=str),
                            ex=_MB_CACHE_TTL_SECONDS,
                        )
                    except Exception:
                        pass
                _mem_set(cache_key, val, ttl=3600)
                return val
    except Exception:
        pass
    return None


def set_mb_cache(key: str, value: Any) -> None:
    cache_key = f"mb:{key}"
    _mem_set(cache_key, value, ttl=3600)

    redis_client = get_redis()
    if redis_client:
        try:
            redis_client.set(
                cache_key,
                json.dumps(value, default=str),
                ex=_MB_CACHE_TTL_SECONDS,
            )
            return
        except Exception:
            pass

    try:
        now = datetime.now(timezone.utc).isoformat()
        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO mb_cache (key, value_json, created_at) VALUES (:key, :value_json, :created_at) "
                    "ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json"
                ),
                {
                    "key": key,
                    "value_json": json.dumps(value, default=str),
                    "created_at": now,
                },
            )
    except Exception:
        pass


def repair_mb_cache_ttls(
    redis_client: Any | None = None,
    *,
    scan_count: int = 100,
    max_keys: int = 10_000,
) -> int:
    """Apply a bounded TTL to legacy MusicBrainz Redis entries."""
    client = redis_client or get_redis()
    if client is None or max_keys <= 0:
        return 0

    cursor = 0
    inspected = 0
    repaired = 0
    try:
        while inspected < max_keys:
            cursor, keys = client.scan(
                cursor,
                match="mb:*",
                count=max(1, min(scan_count, max_keys - inspected)),
            )
            for key in keys:
                if inspected >= max_keys:
                    break
                inspected += 1
                key_text = key.decode() if isinstance(key, bytes) else str(key)
                if not key_text.startswith("mb:"):
                    continue
                if client.ttl(key) == -1:
                    client.expire(key, _MB_CACHE_TTL_SECONDS)
                    repaired += 1
            if cursor == 0:
                break
    except Exception:
        return repaired
    return repaired


__all__ = ["get_mb_cache", "repair_mb_cache_ttls", "set_mb_cache"]
