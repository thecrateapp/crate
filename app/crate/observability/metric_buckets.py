"""Atomic v2 Redis buckets. No legacy bucket is read or modified here."""

from __future__ import annotations

import hashlib
import json
import math
import uuid
from typing import Any

from redis.exceptions import NoScriptError

from crate.observability.metric_catalog import (
    MetricSeries,
    canonical_metric,
    get_metric_definition,
)

PREFIX = "crate:metrics:v2"
NAMES_KEY = f"{PREFIX}:names"
DIRTY_KEY = f"{PREFIX}:dirty"
ALL_BUCKETS_KEY = f"{PREFIX}:buffer"
QUARANTINE_KEY = f"{PREFIX}:quarantine"
QUARANTINE_CURSOR_KEY = f"{PREFIX}:quarantine-cursor"
SOURCE_KEY = f"{PREFIX}:source"
LOSS_KEY = f"{PREFIX}:loss"
ROUTE_BUFFER_KEY = f"{PREFIX}:route-buffer"
TRIM_KEY = f"{PREFIX}:trimmed-before"
ROUTE_TRIM_KEY = f"{PREFIX}:route-trimmed-before"
MAX_BUFFER_BUCKETS = 24_000
MAX_ROUTE_BUFFER_BUCKETS = 2_000
MAX_READ_BUCKETS = 50_000


class MetricBufferFullError(ValueError):
    pass


class MetricReadIncompleteError(ValueError):
    pass


_READ_INDEXES = """
local total = 0
for i, key in ipairs(KEYS) do
    total = total + redis.call('zcount', key, ARGV[2*i], ARGV[2*i+1])
    if total > tonumber(ARGV[1]) then return {0} end
end
local result = {1}
for i, key in ipairs(KEYS) do
    table.insert(result, redis.call('zrangebyscore', key, ARGV[2*i], ARGV[2*i+1]))
end
return result
"""


class MetricReadBudgetError(ValueError):
    pass


_ROUTE_INDEXES = """
local total = 0
for _, key in ipairs(KEYS) do
    total = total + redis.call('scard', key)
    if total > tonumber(ARGV[1]) then return {0} end
end
local result = {1}
for _, key in ipairs(KEYS) do
    table.insert(result, redis.call('smembers', key))
end
return result
"""

_ROUTE_HEADERS = """
local result = {}
for _, key in ipairs(KEYS) do
    local row = redis.call('hmget', key, unpack(ARGV))
    table.insert(row, redis.call('llen', key .. ':samples'))
    table.insert(result, row)
end
return result
"""

_ROUTE_SAMPLES = """
local result = {}
for i, key in ipairs(KEYS) do
    local count = tonumber(ARGV[i])
    if count > 0 then
        table.insert(result, redis.call('lrange', key .. ':samples', 0, count - 1))
    else
        table.insert(result, {})
    end
end
return result
"""

_RECORD = """
local bucket, series, buckets, dirty, names, all, quarantine, loss, trimmed = unpack(KEYS)
local value, minute, observed = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local ttl, max_series = tonumber(ARGV[4]), tonumber(ARGV[5])
local cutoff = minute - ttl
redis.call('zremrangebyscore', all, '-inf', cutoff)
local expired = redis.call('zremrangebyscore', dirty, '-inf', cutoff)
expired = expired + redis.call('zremrangebyscore', quarantine, '-inf', cutoff)
if expired > 0 then
    redis.call('hincrby', loss, 'expired', expired)
    redis.call('hset', loss, 'last_at', observed)
end
if redis.call('exists', bucket) == 0 then
    if redis.call('zcard', all) >= tonumber(ARGV[10]) then
        for _, candidate in ipairs(redis.call('zrange', all, 0, 63)) do
            local persisted = redis.call('hget', candidate, 'persisted_revision')
            local revision = redis.call('hget', candidate, 'revision')
            if persisted and persisted == revision and not redis.call('zscore', dirty, candidate)
               and not redis.call('zscore', quarantine, candidate) then
                local old_minute = tonumber(redis.call('zscore', all, candidate))
                local old_name = redis.call('hget', candidate, 'name')
                if old_name then redis.call('zrem', ARGV[11] .. ':buckets:' .. old_name, candidate) end
                redis.call('del', candidate)
                redis.call('zrem', all, candidate)
                local previous = tonumber(redis.call('get', trimmed)) or 0
                redis.call('set', trimmed, math.max(previous, old_minute + 60), 'EX', ttl)
                break
            end
        end
        if redis.call('zcard', all) >= tonumber(ARGV[10]) then
            redis.call('hincrby', loss, 'capacity', 1)
            redis.call('hset', loss, 'last_at', observed)
            return -1
        end
    end
end
redis.call('zremrangebyscore', series, '-inf', cutoff)
redis.call('zremrangebyscore', buckets, '-inf', cutoff)
if not redis.call('zscore', series, ARGV[6]) and redis.call('zcard', series) >= max_series then
    redis.call('hincrby', loss, 'cardinality', 1)
    redis.call('hset', loss, 'last_at', observed)
    return 0
end
redis.call('hsetnx', bucket, 'source_id', ARGV[9])
redis.call('hset', bucket, 'name', ARGV[7], 'tags', ARGV[8], 'minute', minute)
redis.call('hincrby', bucket, 'count', 1)
redis.call('hincrby', bucket, 'revision', 1)
redis.call('hincrbyfloat', bucket, 'sum', value)
local minimum, maximum = tonumber(redis.call('hget', bucket, 'min')), tonumber(redis.call('hget', bucket, 'max'))
if not minimum or value < minimum then redis.call('hset', bucket, 'min', ARGV[1]) end
if not maximum or value > maximum then redis.call('hset', bucket, 'max', ARGV[1]) end
local last_at = tonumber(redis.call('hget', bucket, 'last_at'))
if not last_at or observed >= last_at then
    redis.call('hset', bucket, 'last', ARGV[1], 'last_at', ARGV[3])
end
redis.call('zadd', series, minute, ARGV[6])
redis.call('zadd', buckets, minute, bucket)
redis.call('zadd', dirty, minute, bucket)
redis.call('zadd', all, minute, bucket)
redis.call('sadd', names, ARGV[7])
redis.call('expire', bucket, ttl)
redis.call('expire', series, ttl)
redis.call('expire', buckets, ttl)
redis.call('expire', names, ttl)
redis.call('expire', all, ttl)
redis.call('expire', dirty, ttl)
redis.call('expire', quarantine, ttl)
return 1
"""

_RECORD_ROUTE = """
local bucket, index, all, loss, trimmed = unpack(KEYS)
local value, minute, observed, ttl = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
redis.call('zremrangebyscore', all, '-inf', minute - ttl)
if redis.call('exists', bucket) == 0 and redis.call('zcard', all) >= tonumber(ARGV[5]) then
    local oldest = redis.call('zrange', all, 0, 0, 'WITHSCORES')
    if oldest[1] and tonumber(oldest[2]) < minute then
        local route_id = redis.call('hget', oldest[1], 'route_id')
        if route_id then redis.call('srem', ARGV[13] .. ':routes:' .. oldest[2], route_id) end
        redis.call('del', oldest[1], oldest[1] .. ':samples')
        redis.call('zrem', all, oldest[1])
        local previous = tonumber(redis.call('get', trimmed)) or 0
        redis.call('set', trimmed, math.max(previous, tonumber(oldest[2]) + 60), 'EX', ttl)
    else
        redis.call('hincrby', loss, 'route_capacity', 1)
        redis.call('hset', loss, 'last_at', observed)
        return 0
    end
end
redis.call('zadd', all, minute, bucket)
redis.call('expire', all, ttl)
redis.call('sadd', index, ARGV[6])
redis.call('expire', index, ttl)
redis.call('hset', bucket, 'route_id', ARGV[6], 'target', ARGV[7], 'method', ARGV[8], 'path', ARGV[9])
redis.call('hincrby', bucket, 'count', 1)
redis.call('hincrbyfloat', bucket, 'sum', value)
redis.call('hincrby', bucket, 'status_' .. ARGV[10], 1)
local minimum, maximum = tonumber(redis.call('hget', bucket, 'min')), tonumber(redis.call('hget', bucket, 'max'))
if not minimum or value < minimum then redis.call('hset', bucket, 'min', ARGV[1]) end
if not maximum or value > maximum then redis.call('hset', bucket, 'max', ARGV[1]) end
local last = tonumber(redis.call('hget', bucket, 'last_at'))
if not last or observed > last then redis.call('hset', bucket, 'last_at', ARGV[3]) end
redis.call('rpush', bucket .. ':samples', ARGV[11])
redis.call('ltrim', bucket .. ':samples', -tonumber(ARGV[12]), -1)
redis.call('expire', bucket, ttl)
redis.call('expire', bucket .. ':samples', ttl)
return 1
"""

_QUARANTINE = """
local generation = string.match(redis.call('info', 'server'), 'run_id:(%S+)')
if generation ~= ARGV[3] then return 0 end
if (redis.call('hget', KEYS[1], 'source_id') or '') ~= ARGV[1]
   or (redis.call('hget', KEYS[1], 'revision') or '') ~= ARGV[2] then return 0 end
redis.call('zrem', KEYS[2], KEYS[1])
redis.call('zadd', KEYS[3], ARGV[4], KEYS[1])
redis.call('hset', KEYS[1], 'quarantine_recoverable', ARGV[6])
redis.call('expire', KEYS[1], ARGV[5])
redis.call('expire', KEYS[3], ARGV[5])
return 1
"""

_ACK = """
if ARGV[3] ~= '' then
    local generation = string.match(redis.call('info', 'server'), 'run_id:(%S+)')
    if generation ~= ARGV[3] then return 0 end
end
local source = redis.call('hget', KEYS[1], 'source_id')
local revision = redis.call('hget', KEYS[1], 'revision')
if not source or (source == ARGV[1] and revision == ARGV[2]) then
    if source then redis.call('hset', KEYS[1], 'persisted_revision', revision) end
    local removed = redis.call('zrem', KEYS[2], KEYS[1])
    redis.call('zrem', KEYS[3], KEYS[1])
    return removed
end
return 0
"""


def _eval(redis, script: str, keys: list[str], args: list):
    digest = hashlib.sha1(script.encode()).hexdigest()
    try:
        return redis.evalsha(digest, len(keys), *keys, *args)
    except NoScriptError:
        return redis.eval(script, len(keys), *keys, *args)


def _decode(value) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


def decode_bucket(raw: dict) -> dict[str, str]:
    return {_decode(key): _decode(value) for key, value in raw.items()}


def bucket_key(series: MetricSeries, minute: int) -> str:
    return f"{PREFIX}:bucket:{series.series_id}:{minute}"


def _family_key(name: str, suffix: str) -> str:
    return f"{PREFIX}:{suffix}:{name}"


def record_sample(
    redis, series: MetricSeries, value: float, minute: int, observed: float, ttl: int
) -> bool:
    """Write the entire observation and its indexes in one Redis operation."""
    name = series.definition.name
    result = _eval(
        redis,
        _RECORD,
        [
            bucket_key(series, minute),
            _family_key(name, "series"),
            _family_key(name, "buckets"),
            DIRTY_KEY,
            NAMES_KEY,
            ALL_BUCKETS_KEY,
            QUARANTINE_KEY,
            LOSS_KEY,
            TRIM_KEY,
        ],
        [
            repr(value),
            minute,
            observed,
            ttl,
            series.definition.max_series,
            series.series_id,
            name,
            series.tags_json,
            uuid.uuid4().hex,
            MAX_BUFFER_BUCKETS,
            PREFIX,
        ],
    )
    if result == -1:
        raise MetricBufferFullError("Metric live-buffer budget exceeded")
    return bool(result)


def read_buckets(
    redis, specs: dict[str, tuple[str, int]], now: int, *, tags: dict | None = None
) -> dict[str, list[dict]]:
    """Read actual indexed buckets, sharing index and data round trips."""
    keys, bounds = [], [MAX_READ_BUCKETS]
    for name, minutes in specs.values():
        definition = get_metric_definition(name)
        keys.append(_family_key(definition.name, "buckets"))
        bounds.extend([now - (minutes - 1) * 60, now])
    indexed = _eval(redis, _READ_INDEXES, keys, bounds)
    if not indexed[0]:
        raise MetricReadBudgetError("Metric read exceeds bucket budget")
    indexed = indexed[1:]
    lookup = [(key, raw_key) for key, keys in zip(specs, indexed) for raw_key in keys]
    unique_keys = list(dict.fromkeys(raw_key for _key, raw_key in lookup))
    fields = ("count", "sum", "min", "max", "last_at", "minute", "tags")
    rows = {}
    for offset in range(0, len(unique_keys), 500):
        chunk = unique_keys[offset : offset + 500]
        pipe = redis.pipeline(transaction=False)
        for raw_key in chunk:
            pipe.hmget(raw_key, fields)
        for raw_key, values in zip(chunk, pipe.execute()):
            if values[0] is None:
                raise MetricReadIncompleteError("An indexed metric bucket is missing")
            rows[raw_key] = dict(zip(fields, values))
    result: dict[str, list[dict]] = {key: [] for key in specs}
    for key, raw_key in lookup:
        row = rows.get(raw_key)
        if row is not None and (
            tags is None or tags.items() <= json.loads(row["tags"]).items()
        ):
            result[key].append(row)
    return result


def pending_snapshots(redis, limit: int = 500) -> list[tuple[str, dict[str, str]]]:
    """Bound work per flush; pending entries survive failures and process exits."""
    keys = redis.zrange(DIRTY_KEY, 0, limit - 1)
    offset = int(redis.get(QUARANTINE_CURSOR_KEY) or 0)
    size = redis.zcard(QUARANTINE_KEY)
    offset = offset % max(1, size)
    quarantined = redis.zrange(QUARANTINE_KEY, offset, offset + limit - 1)
    redis.set(
        QUARANTINE_CURSOR_KEY, (offset + len(quarantined)) % max(1, size), ex=7200
    )
    if quarantined:
        pipe = redis.pipeline(transaction=False)
        for key in quarantined:
            pipe.hmget(key, "name", "quarantine_recoverable", "tags")
        for key, (name, recoverable, tags) in zip(quarantined, pipe.execute()):
            if name is None:
                redis.zrem(QUARANTINE_KEY, key)
                continue
            if recoverable is not None and _decode(recoverable) == "0":
                continue
            try:
                series = canonical_metric(_decode(name), json.loads(tags or "{}"))
                if series.normalized_labels:
                    continue
            except (ValueError, TypeError, AttributeError):
                continue
            if key not in keys:
                keys.append(key)
    keys = keys[:limit]
    if not keys:
        return []
    pipe = redis.pipeline(transaction=False)
    for key in keys:
        pipe.hgetall(key)
    return [
        (_decode(key), decode_bucket(data)) for key, data in zip(keys, pipe.execute())
    ]


def quarantine_snapshot(
    redis, key: str, row: dict, *, run_id: str, ttl: int, recoverable=True
) -> bool:
    """Isolate a future/invalid family without blocking supported observations."""
    try:
        indexed = redis.zscore(DIRTY_KEY, key)
        minute = float(indexed if indexed is not None else row.get("minute", 0))
    except (TypeError, ValueError):
        minute = 0
    if not math.isfinite(minute) or minute <= 0:
        minute = int(redis.time()[0]) // 60 * 60
    return bool(
        _eval(
            redis,
            _QUARANTINE,
            [key, DIRTY_KEY, QUARANTINE_KEY],
            [
                row.get("source_id", ""),
                row.get("revision", ""),
                run_id,
                minute,
                ttl,
                int(recoverable),
            ],
        )
    )


def record_route_sample(
    redis,
    *,
    key: str,
    index: str,
    route_id: str,
    minute: int,
    value: float,
    tags: dict,
    observed_at: float,
    ttl: int,
    sample_limit: int,
) -> None:
    """Bound raw percentile storage independently of canonical counters."""
    result = _eval(
        redis,
        _RECORD_ROUTE,
        [key, index, ROUTE_BUFFER_KEY, LOSS_KEY, ROUTE_TRIM_KEY],
        [
            value,
            minute,
            observed_at,
            ttl,
            MAX_ROUTE_BUFFER_BUCKETS,
            route_id,
            tags["target"],
            tags["method"],
            tags["path"],
            tags["status"],
            str(round(value, 3)),
            sample_limit,
            PREFIX,
        ],
    )
    if not result:
        raise MetricBufferFullError("Route live-buffer budget exceeded")


def collection_state(redis, run_id: str) -> dict:
    """Bounded shared diagnostics and a reset sentinel, separate from bucket data."""
    redis.set(SOURCE_KEY, uuid.uuid4().hex, nx=True)
    pipe = redis.pipeline(transaction=False)
    pipe.get(SOURCE_KEY)
    pipe.hgetall(LOSS_KEY)
    pipe.zcard(DIRTY_KEY)
    pipe.zcard(QUARANTINE_KEY)
    pipe.zrange(DIRTY_KEY, 0, 0, withscores=True)
    pipe.zrange(QUARANTINE_KEY, 0, 0, withscores=True)
    source, losses, pending, quarantined, oldest, oldest_quarantined = pipe.execute()
    oldest = oldest + oldest_quarantined
    losses = decode_bucket(losses)
    return {
        "source_id": f"{run_id}:{_decode(source)}",
        "evicted_keys": int(redis.info("stats").get("evicted_keys", 0)),
        "dropped_samples": sum(
            int(value) for key, value in losses.items() if key != "last_at"
        ),
        "pending_buckets": pending + quarantined,
        "oldest_pending_at": min(item[1] for item in oldest) if oldest else None,
    }


def live_coverage(redis) -> tuple[float, float, float]:
    """Read shared loss and intentional persisted-history trimming watermarks."""
    pipe = redis.pipeline(transaction=False)
    pipe.hget(LOSS_KEY, "last_at")
    pipe.get(TRIM_KEY)
    pipe.get(ROUTE_TRIM_KEY)
    loss, trimmed, routes_trimmed = pipe.execute()
    return float(loss or 0), float(trimmed or 0), float(routes_trimmed or 0)


def latest_observations(redis, names: list[str]) -> dict[str, dict]:
    """Bounded last-observation lookups for empty windows, including stale data."""
    names = list(dict.fromkeys(names))
    if not names:
        return {}
    pipe = redis.pipeline(transaction=False)
    for name in names:
        pipe.zrevrange(_family_key(get_metric_definition(name).name, "buckets"), 0, 0)
    latest = pipe.execute()
    lookup = [(name, keys[0]) for name, keys in zip(names, latest) if keys]
    if not lookup:
        return {}
    pipe = redis.pipeline(transaction=False)
    for _name, key in lookup:
        pipe.hgetall(key)
    return {
        name: decode_bucket(row)
        for (name, _key), row in zip(lookup, pipe.execute())
        if row
    }


def read_route_buckets(
    redis,
    minutes: list[int],
    *,
    max_buckets: int,
    max_samples: int,
    target: str | None = None,
) -> list[tuple[dict, list]]:
    """Bound indexes and sample transfer before reading actual route buckets."""
    indexed = _eval(
        redis,
        _ROUTE_INDEXES,
        [f"{PREFIX}:routes:{minute}" for minute in minutes],
        [max_buckets],
    )
    if not indexed[0]:
        raise MetricReadBudgetError("Route bucket read budget exceeded")
    keys = [
        f"{PREFIX}:route:{_decode(route)}:{minute}"
        for minute, routes in zip(minutes, indexed[1:])
        for route in routes
    ]
    fields = (
        "target",
        "method",
        "path",
        "count",
        "sum",
        "min",
        "max",
        "status_2xx",
        "status_3xx",
        "status_4xx",
        "status_5xx",
        "status_other",
        "last_at",
    )
    headers = []
    total_samples = 0
    for offset in range(0, len(keys), 250):
        chunk = keys[offset : offset + 250]
        raw = _eval(redis, _ROUTE_HEADERS, chunk, list(fields))
        for key, values in zip(chunk, raw):
            if values[3] is None:
                raise MetricReadIncompleteError("An indexed route bucket is missing")
            row: dict[str, Any] = dict(zip(fields, values[:-1]))
            for field in ("target", "method", "path"):
                row[field] = _decode(row[field]) if row[field] is not None else "other"
            row["route_id"] = key.rsplit(":", 2)[1]
            count = int(values[-1])
            if target and row["target"] != target:
                continue
            total_samples += count
            if total_samples > max_samples:
                raise MetricReadBudgetError("Route sample read budget exceeded")
            headers.append((key, row, count))
    result = []
    for offset in range(0, len(headers), 250):
        chunk = headers[offset : offset + 250]
        samples = _eval(
            redis,
            _ROUTE_SAMPLES,
            [key for key, _row, _count in chunk],
            [count for _key, _row, count in chunk],
        )
        result.extend(
            (row, values) for (_key, row, _count), values in zip(chunk, samples)
        )
    return result


def acknowledge_snapshots(
    redis,
    snapshots: list[tuple[str, dict[str, str]]],
    *,
    expected_run_id: str | None = None,
) -> None:
    """Leave a bucket dirty if an observation arrived during the DB transaction."""
    pipe = redis.pipeline(transaction=False)
    for key, snapshot in snapshots:
        pipe.eval(
            _ACK,
            3,
            key,
            DIRTY_KEY,
            QUARANTINE_KEY,
            snapshot.get("source_id", ""),
            snapshot.get("revision", ""),
            expected_run_id or "",
        )
    pipe.execute()


__all__ = [
    "MetricReadBudgetError",
    "read_route_buckets",
    "PREFIX",
    "NAMES_KEY",
    "record_sample",
    "read_buckets",
    "pending_snapshots",
    "acknowledge_snapshots",
]
