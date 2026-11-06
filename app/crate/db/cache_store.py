"""Generic cache storage helpers backed by L1, Redis, and PostgreSQL."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from collections.abc import Mapping, Sequence
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
_SMART_MIX_PLAN_L1_TTL_SECONDS = 5 * 60
# Smart Mix refinements (SM3-D5): read in the same mget as the plans. Finished
# entries (ready, rejected, failed) live a day in Redis, with the table behind
# them; markers (pending, unavailable) are short and never kept in memory, so a
# finished refinement shows on the next poll.
SMART_MIX_REFINED_PLAN_CACHE_PREFIX = "smart-mix:refined-plan:v1:"
SMART_MIX_REFINED_PLAN_CACHE_TTL_SECONDS = 24 * 60 * 60
SMART_MIX_REFINEMENT_PENDING_TTL_SECONDS = 150
SMART_MIX_REFINEMENT_FINISHED = frozenset({"ready", "rejected", "failed"})
SMART_MIX_REFINEMENT_GATE_KEY = "smart-mix:refinement-gate:v1"
SMART_MIX_REFINEMENT_GATE_TTL_SECONDS = 30
_SMART_MIX_REFINEMENT_GATE_L1_TTL_SECONDS = 10
_SMART_MIX_REFINEMENT_BUDGET_PREFIX = "cache:smart-mix:refinement-budget:v1:"
_SMART_MIX_REFINEMENT_READS_KEY = "cache:smart-mix:refined-plan:reads"
_SMART_MIX_REFINEMENT_READS_TTL_SECONDS = 3 * 24 * 60 * 60
_SMART_MIX_REFINEMENT_QUOTA_PREFIX = "crate:smart-mix-refinement:user:"


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


def get_caches(
    keys: Sequence[str], max_age_seconds: int | None = None
) -> dict[str, Any]:
    """Read many cache entries with one Redis or PostgreSQL round trip."""
    requested = list(dict.fromkeys(key for key in keys if key))
    found: dict[str, Any] = {}
    missing: list[str] = []

    for key in requested:
        value = _mem_get(key, max_age_seconds=max_age_seconds)
        if value is None:
            missing.append(key)
        else:
            found[key] = value

    if not missing:
        return found

    redis_client = get_redis()
    if redis_client:
        try:
            pipeline = redis_client.pipeline(transaction=False)
            for key in missing:
                redis_key = f"cache:{key}"
                pipeline.get(redis_key)
                pipeline.pttl(redis_key)
            values = pipeline.execute()
            redis_missing: list[str] = []
            pairs = zip(values[::2], values[1::2], strict=True)
            for key, (raw, remaining_ttl_ms) in zip(missing, pairs, strict=True):
                if raw is None:
                    redis_missing.append(key)
                    continue
                try:
                    value = json.loads(raw)
                except (TypeError, ValueError):
                    redis_missing.append(key)
                    continue
                found[key] = value
                l1_ttl = _remaining_l1_ttl(
                    remaining_ttl_ms, max_age_seconds=max_age_seconds
                )
                if l1_ttl > 0:
                    _mem_set(key, value, l1_ttl)
            missing = redis_missing
        except Exception:
            pass

    if not missing:
        return found

    try:
        with read_scope() as session:
            rows = (
                session.execute(
                    text(
                        "SELECT key, value_json, updated_at FROM cache "
                        "WHERE key = ANY(:keys)"
                    ),
                    {"keys": missing},
                )
                .mappings()
                .all()
            )
        now = datetime.now(timezone.utc)
        for row in rows:
            key = str(row["key"])
            updated = row["updated_at"]
            if max_age_seconds is not None:
                try:
                    if isinstance(updated, str):
                        updated = datetime.fromisoformat(updated)
                    if updated.tzinfo is None:
                        updated = updated.replace(tzinfo=timezone.utc)
                    if (now - updated).total_seconds() > max_age_seconds:
                        continue
                except (AttributeError, TypeError, ValueError):
                    continue
            value = row["value_json"]
            found[key] = value
            _mem_set(key, value)
    except Exception:
        pass
    return found


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


def get_volatile_cache(key: str, max_age_seconds: int) -> Any | None:
    value = _mem_get(key, max_age_seconds=max_age_seconds)
    if value is not None:
        return value
    redis_client = get_redis()
    if not redis_client:
        return None
    try:
        raw = redis_client.get(f"cache:{key}")
    except Exception:
        return None
    if raw is None:
        return None
    value = json.loads(raw)
    _mem_set(key, value, min(max_age_seconds, 300))
    return value


def set_volatile_cache(key: str, value: Any, ttl: int) -> None:
    _mem_set(key, value, min(ttl, 300))
    redis_client = get_redis()
    if not redis_client:
        return
    try:
        redis_client.setex(f"cache:{key}", ttl, json.dumps(value, default=str))
    except Exception:
        pass


def get_smart_mix_plan_caches(plan_keys: Sequence[str]) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    for plan_key in plan_keys:
        value = _mem_get(
            f"{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}",
            max_age_seconds=SMART_MIX_PLAN_CACHE_TTL_SECONDS,
        )
        if isinstance(value, dict):
            found[plan_key] = value
        else:
            missing.append(plan_key)
    redis_client = get_redis()
    if not redis_client or not missing:
        return found
    try:
        raw_values = redis_client.mget(
            [f"cache:{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}" for plan_key in missing]
        )
        for plan_key, raw in zip(missing, raw_values, strict=True):
            value = json.loads(raw) if raw is not None else None
            if isinstance(value, dict):
                found[plan_key] = value
                _mem_set(
                    f"{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}",
                    value,
                    _SMART_MIX_PLAN_L1_TTL_SECONDS,
                )
    except Exception:
        pass
    return found


def set_smart_mix_plan_caches(plans: Mapping[str, dict[str, Any]]) -> None:
    for plan_key, value in plans.items():
        _mem_set(
            f"{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}",
            value,
            _SMART_MIX_PLAN_L1_TTL_SECONDS,
        )
    redis_client = get_redis()
    if not redis_client or not plans:
        return
    try:
        pipeline = redis_client.pipeline(transaction=False)
        for plan_key, value in plans.items():
            pipeline.setex(
                f"cache:{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}",
                SMART_MIX_PLAN_CACHE_TTL_SECONDS,
                json.dumps(value, default=str),
            )
        pipeline.execute()
    except Exception:
        pass


def _finished_refinement(value: Any) -> bool:
    return (
        isinstance(value, dict) and value.get("status") in SMART_MIX_REFINEMENT_FINISHED
    )


def get_smart_mix_plan_and_refinement_caches(
    plan_keys: Sequence[str], refinement_keys: Sequence[str]
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Plans and refinements of a batch in one Redis round trip, never PostgreSQL."""
    plans: dict[str, dict[str, Any]] = {}
    refinements: dict[str, dict[str, Any]] = {}
    missing_plans: list[str] = []
    for plan_key in plan_keys:
        value = _mem_get(
            f"{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}",
            max_age_seconds=SMART_MIX_PLAN_CACHE_TTL_SECONDS,
        )
        if isinstance(value, dict):
            plans[plan_key] = value
        else:
            missing_plans.append(plan_key)
    missing_refinements: list[str] = []
    for refinement_key in dict.fromkeys(refinement_keys):
        value = _mem_get(f"{SMART_MIX_REFINED_PLAN_CACHE_PREFIX}{refinement_key}")
        if _finished_refinement(value):
            refinements[refinement_key] = value
        else:
            missing_refinements.append(refinement_key)
    redis_client = get_redis()
    if not redis_client or not (missing_plans or missing_refinements):
        return plans, refinements
    try:
        raw_values = redis_client.mget(
            [f"cache:{SMART_MIX_PLAN_CACHE_PREFIX}{key}" for key in missing_plans]
            + [
                f"cache:{SMART_MIX_REFINED_PLAN_CACHE_PREFIX}{key}"
                for key in missing_refinements
            ]
        )
        for plan_key, raw in zip(missing_plans, raw_values, strict=False):
            value = json.loads(raw) if raw is not None else None
            if isinstance(value, dict):
                plans[plan_key] = value
                _mem_set(
                    f"{SMART_MIX_PLAN_CACHE_PREFIX}{plan_key}",
                    value,
                    _SMART_MIX_PLAN_L1_TTL_SECONDS,
                )
        for refinement_key, raw in zip(
            missing_refinements, raw_values[len(missing_plans) :], strict=True
        ):
            value = json.loads(raw) if raw is not None else None
            if not isinstance(value, dict):
                continue
            refinements[refinement_key] = value
            if _finished_refinement(value):
                _mem_set(
                    f"{SMART_MIX_REFINED_PLAN_CACHE_PREFIX}{refinement_key}",
                    value,
                    _SMART_MIX_PLAN_L1_TTL_SECONDS,
                )
    except Exception:
        pass
    return plans, refinements


def set_smart_mix_refined_plan_caches(
    entries: Mapping[str, dict[str, Any]],
    *,
    ttl_seconds: int = SMART_MIX_REFINED_PLAN_CACHE_TTL_SECONDS,
) -> None:
    for refinement_key, value in entries.items():
        if _finished_refinement(value):
            _mem_set(
                f"{SMART_MIX_REFINED_PLAN_CACHE_PREFIX}{refinement_key}",
                value,
                _SMART_MIX_PLAN_L1_TTL_SECONDS,
            )
    redis_client = get_redis()
    if not redis_client or not entries:
        return
    try:
        pipeline = redis_client.pipeline(transaction=False)
        for refinement_key, value in entries.items():
            pipeline.setex(
                f"cache:{SMART_MIX_REFINED_PLAN_CACHE_PREFIX}{refinement_key}",
                ttl_seconds,
                json.dumps(value, default=str),
            )
        pipeline.execute()
    except Exception:
        pass


def delete_smart_mix_refined_plan_caches(refinement_keys: Sequence[str]) -> None:
    for refinement_key in refinement_keys:
        _mem_delete(f"{SMART_MIX_REFINED_PLAN_CACHE_PREFIX}{refinement_key}")
    redis_client = get_redis()
    if not redis_client or not refinement_keys:
        return
    try:
        redis_client.delete(
            *(
                f"cache:{SMART_MIX_REFINED_PLAN_CACHE_PREFIX}{key}"
                for key in refinement_keys
            )
        )
    except Exception:
        pass


def get_smart_mix_refinement_gate() -> dict[str, Any] | None:
    """The cached server switches of AI refinement (never PostgreSQL)."""
    value = _mem_get(
        SMART_MIX_REFINEMENT_GATE_KEY,
        max_age_seconds=_SMART_MIX_REFINEMENT_GATE_L1_TTL_SECONDS,
    )
    if isinstance(value, dict):
        return value
    redis_client = get_redis()
    if not redis_client:
        return None
    try:
        raw = redis_client.get(f"cache:{SMART_MIX_REFINEMENT_GATE_KEY}")
        value = json.loads(raw) if raw is not None else None
    except Exception:
        return None
    if not isinstance(value, dict):
        return None
    _mem_set(
        SMART_MIX_REFINEMENT_GATE_KEY, value, _SMART_MIX_REFINEMENT_GATE_L1_TTL_SECONDS
    )
    return value


def set_smart_mix_refinement_gate(gate: Mapping[str, Any]) -> None:
    _mem_set(
        SMART_MIX_REFINEMENT_GATE_KEY,
        dict(gate),
        _SMART_MIX_REFINEMENT_GATE_L1_TTL_SECONDS,
    )
    redis_client = get_redis()
    if not redis_client:
        return
    try:
        redis_client.setex(
            f"cache:{SMART_MIX_REFINEMENT_GATE_KEY}",
            SMART_MIX_REFINEMENT_GATE_TTL_SECONDS,
            json.dumps(dict(gate), default=str),
        )
    except Exception:
        pass


def delete_smart_mix_refinement_gate() -> None:
    _mem_delete(SMART_MIX_REFINEMENT_GATE_KEY)
    redis_client = get_redis()
    if not redis_client:
        return
    try:
        redis_client.delete(f"cache:{SMART_MIX_REFINEMENT_GATE_KEY}")
    except Exception:
        pass


def set_smart_mix_refinement_budget_marker(fingerprint: str, ttl_seconds: int) -> None:
    """A provider refused the daily budget of this configuration until it resets."""
    redis_client = get_redis()
    if not redis_client:
        return
    try:
        redis_client.setex(
            f"{_SMART_MIX_REFINEMENT_BUDGET_PREFIX}{fingerprint}",
            max(1, int(ttl_seconds)),
            "1",
        )
    except Exception:
        pass


def smart_mix_refinement_budget_exhausted(fingerprint: str) -> bool:
    redis_client = get_redis()
    if not redis_client:
        return False
    try:
        return (
            redis_client.get(f"{_SMART_MIX_REFINEMENT_BUDGET_PREFIX}{fingerprint}")
            is not None
        )
    except Exception:
        return False


def record_smart_mix_refinement_reads(refinement_keys: Sequence[str]) -> None:
    """Remember served refinements; the daily cleanup touches them in one batch."""
    redis_client = get_redis()
    if not redis_client or not refinement_keys:
        return
    try:
        pipeline = redis_client.pipeline(transaction=False)
        pipeline.sadd(_SMART_MIX_REFINEMENT_READS_KEY, *refinement_keys)
        pipeline.expire(
            _SMART_MIX_REFINEMENT_READS_KEY, _SMART_MIX_REFINEMENT_READS_TTL_SECONDS
        )
        pipeline.execute()
    except Exception:
        pass


def pop_smart_mix_refinement_reads(count: int) -> list[str]:
    redis_client = get_redis()
    if not redis_client:
        return []
    try:
        popped = redis_client.spop(_SMART_MIX_REFINEMENT_READS_KEY, count) or []
    except Exception:
        return []
    return [item.decode() if isinstance(item, bytes) else str(item) for item in popped]


def consume_smart_mix_refinement_quota(
    user_id: int, count: int, *, limit: int, window_seconds: int
) -> int:
    """How many of ``count`` refinements a user may queue in the current window.

    Without Redis the quota cannot be counted and every request passes; the
    connection's daily call and token budgets still bound the spend.
    """
    if count <= 0:
        return 0
    redis_client = get_redis()
    if not redis_client:
        return count
    key = f"{_SMART_MIX_REFINEMENT_QUOTA_PREFIX}{user_id}"
    try:
        pipeline = redis_client.pipeline(transaction=False)
        pipeline.incrby(key, count)
        pipeline.expire(key, window_seconds, nx=True)
        total = int(pipeline.execute()[0] or 0)
    except Exception:
        return count
    return max(0, min(count, limit - (total - count)))


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
    "get_caches",
    "get_cache_stats",
    "consume_smart_mix_refinement_quota",
    "delete_smart_mix_refined_plan_caches",
    "delete_smart_mix_refinement_gate",
    "get_smart_mix_plan_and_refinement_caches",
    "get_smart_mix_plan_caches",
    "get_smart_mix_refinement_gate",
    "pop_smart_mix_refinement_reads",
    "record_smart_mix_refinement_reads",
    "set_smart_mix_refined_plan_caches",
    "set_smart_mix_refinement_budget_marker",
    "set_smart_mix_refinement_gate",
    "smart_mix_refinement_budget_exhausted",
    "get_volatile_cache",
    "set_cache",
    "set_smart_mix_plan_caches",
    "set_volatile_cache",
]
