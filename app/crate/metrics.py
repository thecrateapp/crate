"""Metrics collection and query.

Hot path: record() stores samples in Redis hash buckets (minute granularity,
two-hour TTL and global buffer limits).
Cold path: absolute, revisioned minute snapshots are persisted to PostgreSQL.
Query: read from Redis (recent) or PostgreSQL (historical).
"""

from __future__ import annotations

import json
import logging
import hashlib
import math
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from queue import Empty, Full, Queue
from threading import Lock, Thread

from crate.observability import metric_buckets
from crate.observability.metric_catalog import canonical_metric, get_metric_definition

log = logging.getLogger(__name__)

_REDIS_PREFIX = metric_buckets.PREFIX
_METRIC_KEYS_SET = metric_buckets.NAMES_KEY
_DEFAULT_BUCKET_TTL_SECONDS = 2 * 3600
_MIN_BUCKET_TTL_SECONDS = 3600
_MAX_BUCKET_TTL_SECONDS = 2 * 3600
_ASYNC_QUEUE_MAX = 10_000
_ROUTE_LATENCY_METRIC = "api.route.latency"
_MAX_ROUTE_BUCKETS = 5000
_MAX_ROUTE_SAMPLES = 50_000
FEDERATION_METRICS = frozenset(
    {
        "federation.pairing.attempt",
        "federation.pairing.latency",
        "federation.signed_request.latency",
        "federation.signed_request.result",
        "federation.sync.lag",
        "federation.sync.rows",
        "federation.sync.bytes",
        "federation.stream.active",
        "federation.stream.ttfb",
        "federation.stream.bytes",
        "federation.stream.disconnect",
        "federation.import.state",
        "federation.import.reserved_bytes",
        "federation.directory.freshness",
        "federation.auth.denial",
        "federation.risk.signal",
        "federation.risk.action",
        "federation.source.availability",
        "federation.source.fallback",
    }
)
FEDERATION_REASON_CODES = frozenset(
    {
        "ok",
        "signature_invalid",
        "nonce_replay",
        "pairing_rate_limit",
        "peer_not_approved",
        "peer_disabled",
        "subject_blocked",
        "no_matching_grant",
        "capability_denied",
        "invalid_constraints",
        "peer_stream_limit",
        "subject_stream_limit",
        "peer_byte_quota",
        "subject_byte_quota",
        "manifest_digest_mismatch",
        "track_digest_mismatch",
        "upstream_error",
        "other",
    }
)
_async_metric_queue: Queue[tuple[str, float, dict, float]] = Queue(
    maxsize=_ASYNC_QUEUE_MAX
)
_async_worker_lock = Lock()
_async_worker_started = False


_collection_lock = Lock()
_collection_counters = {
    "invalid_observation": 0,
    "labels_normalized": 0,
    "redis_unavailable": 0,
    "redis_error": 0,
    "buffer_full": 0,
    "cardinality_rejected": 0,
    "expired_before_flush": 0,
    "flush_error": 0,
    "source_changed": 0,
    "async_error": 0,
    "buffer_expired": 0,
    "buffer_limit": 0,
    "unsupported_snapshot": 0,
}
_collector_started_at = time.time()
_last_write_at: float | None = None
_last_error_at: float | None = None
_last_error_reason: str | None = None
_BUFFER_MAX_AGE_SECONDS = 300


def _collection_event(reason: str, count: int = 1):
    global _last_error_at, _last_error_reason
    with _collection_lock:
        if reason != "labels_normalized":
            _last_error_at, _last_error_reason = time.time(), reason
        _collection_counters[reason] = min(
            2**63 - 1, _collection_counters[reason] + count
        )


def get_collection_health() -> dict:
    """Process-local diagnostics; this read never accesses Redis or PostgreSQL."""
    now = time.time()
    with _collection_lock:
        last_write, last_error, reason = (
            _last_write_at,
            _last_error_at,
            _last_error_reason,
        )
        counters = dict(_collection_counters)
    if (
        last_error is not None
        and (last_write is None or last_error > last_write)
        and reason in {"redis_unavailable", "redis_error"}
    ):
        state = "unavailable"
    elif last_error is not None and now - last_error <= 300:
        state = "partial"
    elif last_write is None:
        state = "empty"
    elif now - last_write > 300:
        state = "stale"
    else:
        state = "available"

    def iso(value):
        return (
            datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
            if value is not None
            else None
        )

    return {
        "scope": "process",
        "coverage": "local_only",
        "availability": state,
        "observed_at": iso(now),
        "started_at": iso(_collector_started_at),
        "last_write_at": iso(last_write),
        "last_error_at": iso(last_error),
        "last_error_reason": reason,
        "counters": counters,
        "queue_depth": _async_metric_queue.qsize(),
        "queue_capacity": _async_metric_queue.maxsize,
        "buffer_max_age_seconds": _BUFFER_MAX_AGE_SECONDS,
    }


def _minute_bucket(ts: float | None = None) -> int:
    """Return the minute-aligned Unix timestamp."""
    t = int(time.time() if ts is None else ts)
    return t - (t % 60)


def _route_bucket_key(minute_ts: int) -> str:
    return f"{_REDIS_PREFIX}:routes:{minute_ts}"


def _route_metric_key(route_id: str, minute_ts: int) -> str:
    return f"{_REDIS_PREFIX}:route:{route_id}:{minute_ts}"


def _route_sample_limit() -> int:
    raw = os.environ.get("CRATE_ROUTE_METRIC_SAMPLE_LIMIT", "1000")
    try:
        return max(50, min(1000, int(raw)))
    except ValueError:
        return 1000


def _bucket_ttl_seconds() -> int:
    raw = os.environ.get("CRATE_METRICS_REDIS_TTL_SECONDS")
    if raw is None or raw == "":
        return _DEFAULT_BUCKET_TTL_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_BUCKET_TTL_SECONDS
    return max(_MIN_BUCKET_TTL_SECONDS, min(_MAX_BUCKET_TTL_SECONDS, value))


def _decode_mapping(data: dict) -> dict[str, str]:
    decoded: dict[str, str] = {}
    for key, value in data.items():
        k = key.decode() if isinstance(key, bytes) else str(key)
        v = value.decode() if isinstance(value, bytes) else str(value)
        decoded[k] = v
    return decoded


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * percentile) - 1))
    return round(ordered[index], 2)


def _route_id(target: str, method: str, path: str) -> str:
    payload = f"{target}\0{method}\0{path}".encode("utf-8", errors="replace")
    return hashlib.sha1(payload, usedforsecurity=False).hexdigest()[:16]


# ── Recording ────────────────────────────────────────────────────


def _record_sync(
    name: str,
    value: float,
    tags: dict | None = None,
    *,
    observed_at: float | None = None,
):
    """Record one observation atomically, storing catalogue units and dimensions."""
    global _last_write_at
    try:
        series = canonical_metric(name, tags)
        canonical_value = float(value) * series.definition.scale
        if not math.isfinite(canonical_value):
            raise ValueError("Metric values must be finite")
    except (ValueError, TypeError, AttributeError):
        _collection_event("invalid_observation")
        return False
    if series.normalized_labels:
        _collection_event("labels_normalized", series.normalized_labels)
    try:
        from crate.db.cache_runtime import get_redis

        redis = get_redis()
        if redis is None:
            _collection_event("redis_unavailable")
            return False
        observed = time.time() if observed_at is None else observed_at
        if metric_buckets.record_sample(
            redis,
            series,
            canonical_value,
            _minute_bucket(observed),
            observed,
            _bucket_ttl_seconds(),
        ):
            with _collection_lock:
                _last_write_at = time.time()
            return True
        else:
            _collection_event("cardinality_rejected")
    except metric_buckets.MetricBufferFullError:
        _collection_event("buffer_limit")
    except Exception:
        _collection_event("redis_error")
    return False


def _record_route_latency_sync(
    value: float, tags: dict | None = None, *, observed_at: float | None = None
):
    """Record per-route latency samples for recent p95/p99 reporting."""
    try:
        series = canonical_metric(_ROUTE_LATENCY_METRIC, tags)
        safe_tags = dict(series.tags)
        value = float(value)
        if not math.isfinite(value):
            return
    except (ValueError, TypeError):
        return
    method = safe_tags.get("method", "other")
    path = safe_tags.get("route", "other")
    target = safe_tags.get("target", "api")
    status = safe_tags.get("status_class", "other")
    observed = time.time() if observed_at is None else observed_at
    if not _record_sync(_ROUTE_LATENCY_METRIC, value, safe_tags, observed_at=observed):
        return

    try:
        from crate.db.cache_runtime import get_redis

        r = get_redis()
        if r is None:
            return

        bucket_ts = _minute_bucket(observed)
        ttl_seconds = _bucket_ttl_seconds()
        route_id = _route_id(target, method, path)
        bucket_key = _route_bucket_key(bucket_ts)
        key = _route_metric_key(route_id, bucket_ts)
        metric_buckets.record_route_sample(
            r,
            key=key,
            index=bucket_key,
            route_id=route_id,
            minute=bucket_ts,
            value=value,
            tags={
                "target": target,
                "method": method,
                "path": path,
                "status": status if status in {"2xx", "3xx", "4xx", "5xx"} else "other",
            },
            observed_at=observed,
            ttl=ttl_seconds,
            sample_limit=_route_sample_limit(),
        )
    except metric_buckets.MetricBufferFullError:
        _collection_event("buffer_limit")
    except Exception:
        _collection_event("redis_error")


def _async_record_loop():
    while True:
        try:
            name, value, tags, observed = _async_metric_queue.get(timeout=0.5)
        except Empty:
            continue
        try:
            if time.time() - observed > _BUFFER_MAX_AGE_SECONDS:
                _collection_event("buffer_expired")
            elif name == _ROUTE_LATENCY_METRIC:
                _record_route_latency_sync(value, tags, observed_at=observed)
            else:
                _record_sync(name, value, tags, observed_at=observed)
        except Exception:
            _collection_event("async_error")
        finally:
            _async_metric_queue.task_done()


def _ensure_async_worker():
    global _async_worker_started
    if _async_worker_started:
        return
    with _async_worker_lock:
        if _async_worker_started:
            return
        worker = Thread(
            target=_async_record_loop, name="crate-metrics-buffer", daemon=True
        )
        worker.start()
        _async_worker_started = True


def record(name: str, value: float, tags: dict | None = None):
    """Record a metric sample synchronously."""
    _record_sync(name, value, tags)


def record_counter(name: str, tags: dict | None = None):
    """Shorthand for counter-style metrics (value=1)."""
    record(name, 1.0, tags)


def record_later(name: str, value: float, tags: dict | None = None):
    """Queue a metric sample for asynchronous write.

    This is intended for the hottest API request-path middleware.
    If the buffer is full we drop the sample rather than blocking
    the response path.
    """
    try:
        series = canonical_metric(name, tags)
        value = float(value)
        if not math.isfinite(value * series.definition.scale):
            raise ValueError("Metric values must be finite")
    except (ValueError, TypeError, AttributeError):
        _collection_event("invalid_observation")
        return
    if series.normalized_labels:
        _collection_event("labels_normalized", series.normalized_labels)
    observed = time.time()
    try:
        _ensure_async_worker()
        _async_metric_queue.put_nowait(
            (series.definition.name, value, dict(series.tags), observed)
        )
    except Full:
        _collection_event("buffer_full")
    except Exception:
        _collection_event("async_error")


def record_counter_later(name: str, tags: dict | None = None):
    record_later(name, 1.0, tags)


def federation_metric_tags(
    *, peer_uid: str | None = None, reason_code: str = "ok"
) -> dict[str, str]:
    tags: dict[str, str] = {}
    if peer_uid is not None:
        try:
            tags["peer_uid"] = str(uuid.UUID(str(peer_uid)))
        except ValueError as exc:
            raise ValueError("peer_uid must be a UUID") from exc
    if reason_code not in FEDERATION_REASON_CODES:
        raise ValueError("Unknown federation metric reason code")
    tags["reason_code"] = reason_code
    return tags


def record_federation_metric(
    name: str,
    value: float = 1.0,
    *,
    peer_uid: str | None = None,
    reason_code: str = "ok",
) -> None:
    if name not in FEDERATION_METRICS:
        raise ValueError("Unknown federation metric name")
    record_later(
        name,
        value,
        federation_metric_tags(peer_uid=peer_uid, reason_code=reason_code),
    )


def record_route_latency_later(
    *,
    method: str,
    path: str,
    status: str | int,
    elapsed_ms: float,
    target: str = "api",
):
    record_later(
        _ROUTE_LATENCY_METRIC,
        elapsed_ms,
        {
            "method": method,
            "path": path,
            "status": str(status),
            "target": target,
        },
    )


# ── Querying ─────────────────────────────────────────────────────


def _recent_buckets(specs: dict[str, tuple[str, int]], *, tags: dict | None = None):
    from crate.db.cache_runtime import get_redis

    redis = get_redis()
    if redis is None:
        raise ConnectionError("Metric Redis is unavailable")
    return metric_buckets.read_buckets(
        redis, specs, _minute_bucket(), tags=tags, ttl=_bucket_ttl_seconds()
    )


def _latest_total(rows: list[dict], scale: float) -> float | None:
    latest: dict[str, tuple[float, float, float]] = {}
    for row in rows:
        if row.get("last") is None:
            continue
        position = (float(row["minute"]), float(row["last_at"]))
        current = latest.get(row["tags"])
        if current is None or position > current[:2]:
            latest[row["tags"]] = (*position, float(row["last"]))
    if not latest:
        return None
    return round(sum(value for _minute, _at, value in latest.values()) / scale, 2)


def _aggregate_rows(rows: list[dict], scale: float) -> dict:
    count = sum(int(row["count"]) for row in rows)
    total = sum(float(row["sum"]) for row in rows) / scale
    return {
        "count": count,
        "avg": round(total / count, 2) if count else 0,
        "min": round(min((float(row["min"]) / scale for row in rows), default=0), 2),
        "max": round(max((float(row["max"]) / scale for row in rows), default=0), 2),
        "sum": round(total, 2),
    }


def query_recent(
    name: str, minutes: int = 60, *, tags: dict | None = None
) -> list[dict]:
    """Aggregate v2 dimensions by minute, optionally filtering a label subset."""
    try:
        minutes = max(1, min(10080, int(minutes)))
        series = canonical_metric(name, tags)
        data = _recent_buckets(
            {name: (name, minutes)},
            tags=dict(series.tags) if tags is not None else None,
        )[name]
        by_minute: dict[int, list[dict]] = {}
        for row in data:
            by_minute.setdefault(int(row["minute"]), []).append(row)
        return [
            {
                "timestamp": datetime.fromtimestamp(
                    minute, tz=timezone.utc
                ).isoformat(),
                **_aggregate_rows(rows, series.definition.scale),
            }
            for minute, rows in sorted(by_minute.items())
        ]
    except Exception:
        log.debug("Failed to query recent metrics", exc_info=True)
        return []


def query_recent_rolled(
    name: str, minutes: int = 1440, bucket_minutes: int = 60
) -> list[dict]:
    """Read recent Redis buckets and roll them up in-process.

    This keeps near-realtime dashboard queries on Redis instead of
    depending on PostgreSQL rollups during interactive admin sessions.
    """
    if bucket_minutes <= 1:
        return query_recent(name, minutes)

    buckets = query_recent(name, minutes)
    if not buckets:
        return []

    rolled: dict[int, dict] = {}
    bucket_seconds = bucket_minutes * 60
    for bucket in buckets:
        ts = bucket.get("timestamp")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(str(ts))
        except ValueError:
            continue
        epoch = int(dt.timestamp())
        rolled_ts = epoch - (epoch % bucket_seconds)
        current = rolled.setdefault(
            rolled_ts,
            {
                "timestamp": datetime.fromtimestamp(
                    rolled_ts, tz=timezone.utc
                ).isoformat(),
                "count": 0,
                "sum": 0.0,
                "min": None,
                "max": None,
            },
        )
        count = int(bucket.get("count", 0) or 0)
        total = float(bucket.get("sum", 0) or 0)
        current["count"] += count
        current["sum"] += total

        if count > 0:
            min_value = float(bucket.get("min", 0) or 0)
            max_value = float(bucket.get("max", 0) or 0)
            current["min"] = (
                min_value if current["min"] is None else min(current["min"], min_value)
            )
            current["max"] = (
                max_value if current["max"] is None else max(current["max"], max_value)
            )

    results = []
    for _, bucket in sorted(rolled.items()):
        count = int(bucket["count"])
        total = float(bucket["sum"])
        results.append(
            {
                "timestamp": bucket["timestamp"],
                "count": count,
                "avg": round(total / count, 2) if count > 0 else 0,
                "min": round(float(bucket["min"] or 0), 2),
                "max": round(float(bucket["max"] or 0), 2),
                "sum": round(total, 2),
            }
        )
    return results


def query_summary(name: str, minutes: int = 5) -> dict:
    """Aggregate observed values with explicit availability and provenance."""
    return query_summaries({name: (name, minutes)})[name]


def _live_coverage_reason(coverage, minutes, *, include_trim=True):
    loss_at, generic_trimmed, routes_trimmed = coverage
    trimmed = generic_trimmed if include_trim else routes_trimmed
    start = _minute_bucket() - (minutes - 1) * 60
    if loss_at and loss_at >= start:
        return "collection_loss"
    if trimmed and start < trimmed:
        return "live_buffer_trimmed" if include_trim else "live_route_buffer_trimmed"
    if minutes * 60 > _bucket_ttl_seconds():
        return "outside_live_retention"
    return None


def _summary_provenance(rows, scale, minutes, now, *, filters=None, latest=None):
    parent_count = sum(int(row["count"]) for row in rows)
    selected, eligible = rows, rows
    if filters:
        eligible = [
            row
            for row in rows
            if all(
                json.loads(row["tags"]).get(key) not in {None, "other"}
                for key in filters
            )
        ]
        selected = [
            row
            for row in eligible
            if filters.items() <= json.loads(row["tags"]).items()
        ]
    eligible_count = sum(int(row["count"]) for row in eligible)
    observed = max((float(row["last_at"]) for row in rows), default=None)
    if observed is None and latest:
        observed = float(latest["last_at"])
    age = max(0, now - observed) if observed is not None else None
    if filters and parent_count > eligible_count:
        state, reason = "partial", "unclassified_observations"
    elif not rows:
        state = "stale" if observed is not None else "empty"
        reason = "outside_window" if observed is not None else "no_observations"
    elif age is not None and age > minutes * 60:
        state, reason = "stale", "observation_expired"
    else:
        state, reason = "available", None
    result = _aggregate_rows(selected, scale)
    return {
        **result,
        "latest": _latest_total(selected, scale),
        "availability": state,
        "reason": reason,
        "source": "redis_v2",
        "sample_kind": "observations",
        "sample_count": result["count"],
        "eligible_count": eligible_count,
        "observed_at": datetime.fromtimestamp(observed, tz=timezone.utc).isoformat()
        if observed is not None
        else None,
        "age_seconds": round(age, 3) if age is not None else None,
        "window_minutes": minutes,
    }


def query_summaries(specs: dict[str, tuple]) -> dict[str, dict]:
    """Read observed populations in batches; optional labels select a subset.

    A filtered zero is available only when the parent population contains known
    values for every filtering dimension. A sparse counter's absence is empty.
    """
    if not specs:
        return {}
    now = time.time()
    normalized = {
        key: (spec[0], max(1, min(10080, int(spec[1])))) for key, spec in specs.items()
    }
    try:
        from crate.db.cache_runtime import get_redis

        redis = get_redis()
        if redis is None:
            raise ConnectionError("Metric Redis is unavailable")
        rows = metric_buckets.read_buckets(
            redis, normalized, _minute_bucket(), ttl=_bucket_ttl_seconds()
        )
        missing = [
            name for key, (name, _minutes) in normalized.items() if not rows[key]
        ]
        latest = metric_buckets.latest_observations(redis, missing)
        coverage = metric_buckets.live_coverage(redis)
        result = {}
        for key, (name, minutes) in normalized.items():
            definition = get_metric_definition(name)
            raw_filter = specs[key][2] if len(specs[key]) == 3 else None
            filters = (
                dict(canonical_metric(name, raw_filter).tags) if raw_filter else None
            )
            result[key] = _summary_provenance(
                rows[key],
                definition.scale,
                minutes,
                now,
                filters=filters,
                latest=latest.get(name),
            )
            reason = _live_coverage_reason(coverage, minutes)
            if reason:
                result[key].update(availability="partial", reason=reason)
            elif key in rows.incomplete:
                result[key].update(availability="partial", reason="live_bucket_missing")
        return result
    except Exception:
        log.debug("Failed to query batched metric summaries", exc_info=True)
        return {
            key: {
                **_summary_provenance([], 1, minutes, now),
                "availability": "unavailable",
                "reason": "metric_source_unavailable",
            }
            for key, (_name, minutes) in normalized.items()
        }


def query_route_latency_snapshot(
    minutes: int = 15, limit: int = 20, target: str | None = None
) -> dict:
    """Aggregate recent per-route latency with p95/p99 from sampled Redis data."""
    minutes = max(1, min(240, int(minutes)))
    limit = max(1, min(100, int(limit)))
    status = {
        "availability": "available",
        "reason": None,
        "source": "redis_v2",
        "sample_kind": "bounded_samples",
        "window_minutes": minutes,
    }
    try:
        from crate.db.cache_runtime import get_redis

        r = get_redis()
        if r is None:
            raise ConnectionError("Metric Redis is unavailable")

        now_bucket = _minute_bucket()
        minutes_to_read = [now_bucket - offset * 60 for offset in range(minutes)]
        raw = metric_buckets.read_route_buckets(
            r,
            minutes_to_read,
            max_buckets=_MAX_ROUTE_BUCKETS,
            max_samples=_MAX_ROUTE_SAMPLES,
            target=target,
        )
        aggregates: dict[str, dict] = {}
        coverage_reason = _live_coverage_reason(
            metric_buckets.live_coverage(r), minutes, include_trim=False
        )
        for row, samples_raw in raw:
            route_id = row["route_id"]
            if target and row.get("target") != target:
                continue

            current = aggregates.setdefault(
                route_id,
                {
                    "route_id": route_id,
                    "target": row.get("target") or "api",
                    "method": row.get("method") or "GET",
                    "path": row.get("path") or "",
                    "count": 0,
                    "sum": 0.0,
                    "min": None,
                    "max": None,
                    "status_2xx": 0,
                    "status_3xx": 0,
                    "status_4xx": 0,
                    "status_5xx": 0,
                    "status_other": 0,
                    "samples": [],
                },
            )
            count = int(row.get("count") or 0)
            total = float(row.get("sum") or 0)
            current["count"] += count
            current["sum"] += total

            if count > 0:
                min_value = float(row.get("min") or 0)
                max_value = float(row.get("max") or 0)
                current["min"] = (
                    min_value
                    if current["min"] is None
                    else min(float(current["min"]), min_value)
                )
                current["max"] = (
                    max_value
                    if current["max"] is None
                    else max(float(current["max"]), max_value)
                )

            for family in (
                "status_2xx",
                "status_3xx",
                "status_4xx",
                "status_5xx",
                "status_other",
            ):
                current[family] += int(row.get(family) or 0)

            for raw_sample in samples_raw or []:
                try:
                    current["samples"].append(float(raw_sample))
                except (TypeError, ValueError):
                    continue

        results = []
        missing_samples = False
        for row in aggregates.values():
            count = int(row["count"])
            if count <= 0:
                continue
            samples = row.pop("samples")
            if not samples:
                missing_samples = True
                continue
            errors = int(row["status_5xx"])
            results.append(
                {
                    **row,
                    "avg": round(float(row["sum"]) / count, 2),
                    "min": round(float(row["min"] or 0), 2),
                    "max": round(float(row["max"] or 0), 2),
                    "sample_count": len(samples),
                    "sampled": len(samples) < count,
                    "p95": _percentile(samples, 0.95),
                    "p99": _percentile(samples, 0.99),
                    "error_rate": round(errors / count, 4),
                }
            )

        results.sort(
            key=lambda row: (float(row.get("p95") or 0), int(row.get("count") or 0)),
            reverse=True,
        )
        return {
            **status,
            "routes": results[:limit],
            "availability": "partial"
            if missing_samples or coverage_reason
            else "available"
            if results
            else "empty",
            "reason": coverage_reason
            or ("missing_percentile_samples" if missing_samples else None),
            "observed_count": sum(int(row["count"]) for row in aggregates.values()),
            "sample_count": sum(int(row["sample_count"]) for row in results),
            "truncated": len(results) > limit,
        }
    except metric_buckets.MetricReadBudgetError:
        return {
            **status,
            "routes": [],
            "availability": "unavailable",
            "reason": "read_budget",
            "observed_count": 0,
            "sample_count": 0,
            "truncated": False,
        }
    except Exception:
        log.debug("Failed to query route latency metrics", exc_info=True)
        return {
            **status,
            "routes": [],
            "availability": "unavailable",
            "reason": "metric_source_unavailable",
            "observed_count": 0,
            "sample_count": 0,
            "truncated": False,
        }


def query_route_latency(
    minutes: int = 15, limit: int = 20, target: str | None = None
) -> list[dict]:
    """Compatibility list reader; status is exposed by the snapshot API."""
    return query_route_latency_snapshot(minutes, limit, target)["routes"]


# ── Flush to PostgreSQL ──────────────────────────────────────────


def prune_history(limit: int = 1000) -> int:
    """Delete one bounded batch of fully expired v2 minutes, independent of Redis."""
    from crate.db.repositories.metric_minutes import (
        delete_metric_minute_snapshots_before,
    )

    cutoff = datetime.fromtimestamp(_minute_bucket(), tz=timezone.utc) - timedelta(
        days=8
    )
    return delete_metric_minute_snapshots_before(cutoff, limit=limit)


def flush_to_postgres(period: str = "hour"):
    """Persist absolute v2 minutes; retries and concurrent flushers are idempotent.

    ``period`` remains accepted for existing callers; storage is always per minute.
    """
    try:
        from crate.db.cache_runtime import get_redis
        from crate.db.repositories.metric_minutes import persist_metric_collection

        redis = get_redis()
        if redis is None:
            _collection_event("redis_unavailable")
            return
        ttl = _bucket_ttl_seconds()
        # A Redis restart can restore an earlier revision. Treat it as a source
        # change, preserving known DB counts and marking the overlapping minute.
        for _batch in range(10):
            run_id = redis.info("server")["run_id"]
            pending = metric_buckets.pending_snapshots(redis)
            if redis.info("server")["run_id"] != run_id:
                _collection_event("source_changed")
                continue
            state = metric_buckets.collection_state(redis, run_id)
            snapshots = []
            accepted = []
            lost = [key for key, row in pending if not row]
            if lost:
                metric_buckets.record_lost_buckets(
                    redis, lost, now=time.time(), ttl=ttl
                )
            for key, row in pending:
                if not row:
                    _collection_event("expired_before_flush")
                    accepted.append((key, row))
                    continue
                known_family = False
                try:
                    series = canonical_metric(row["name"], json.loads(row["tags"]))
                    if series.normalized_labels:
                        raise ValueError("Metric labels require a newer catalogue")
                    known_family = True
                    snapshot = {
                        "name": row["name"],
                        "tags": json.loads(row["tags"]),
                        "bucket_start": datetime.fromtimestamp(
                            int(row["minute"]), tz=timezone.utc
                        ),
                        "source_id": f"{run_id}:{row['source_id']}",
                        "revision": int(row["revision"]),
                        "count": int(row["count"]),
                        "sum_value": float(row["sum"]),
                        "min_value": float(row["min"]),
                        "max_value": float(row["max"]),
                        "last_value": float(row["last"]),
                        "last_observed_at": datetime.fromtimestamp(
                            float(row["last_at"]), tz=timezone.utc
                        ),
                    }
                    values = [
                        snapshot[field]
                        for field in (
                            "sum_value",
                            "min_value",
                            "max_value",
                            "last_value",
                        )
                    ]
                    if (
                        snapshot["revision"] < 1
                        or snapshot["count"] < 1
                        or snapshot["bucket_start"].second != 0
                        or len(snapshot["source_id"]) > 160
                        or not all(math.isfinite(value) for value in values)
                        or snapshot["min_value"] > snapshot["max_value"]
                    ):
                        raise ValueError("Invalid metric snapshot")
                    snapshots.append(snapshot)
                    accepted.append((key, row))
                except (KeyError, ValueError, TypeError, AttributeError, OverflowError):
                    if metric_buckets.quarantine_snapshot(
                        redis,
                        key,
                        row,
                        run_id=run_id,
                        ttl=_bucket_ttl_seconds(),
                        recoverable=not known_family,
                    ):
                        _collection_event("unsupported_snapshot")
            result = persist_metric_collection(
                snapshots,
                checked_at=datetime.fromtimestamp(time.time(), tz=timezone.utc),
                buffer_ttl_seconds=_bucket_ttl_seconds(),
                **state,
            )
            if result["gap_detected"]:
                _collection_event("source_changed")
                redis.hset(metric_buckets.LOSS_KEY, "last_at", time.time())
            if not pending:
                break
            if accepted:
                metric_buckets.acknowledge_snapshots(
                    redis, accepted, expected_run_id=run_id
                )
        now = time.time()
        metric_buckets.trim_indexes(redis, cutoff=int(now) - ttl - 60, observed=now)
        run_id = redis.info("server")["run_id"]
        state = metric_buckets.collection_state(redis, run_id)
        result = persist_metric_collection(
            [],
            checked_at=datetime.fromtimestamp(time.time(), tz=timezone.utc),
            buffer_ttl_seconds=_bucket_ttl_seconds(),
            **state,
        )
        if result["gap_detected"]:
            _collection_event("source_changed")
            redis.hset(metric_buckets.LOSS_KEY, "last_at", time.time())
    except Exception:
        _collection_event("flush_error")
        log.warning("Metrics flush to PostgreSQL failed", exc_info=True)


def _historical_points(rows: list[dict], scale: float) -> list[dict]:
    return [
        {
            "timestamp": row["bucket_start"].isoformat(),
            "count": int(row["count"]),
            "avg": round(float(row["avg_value"] or 0) / scale, 2),
            "min": round(float(row["min_value"] or 0) / scale, 2),
            "max": round(float(row["max_value"] or 0) / scale, 2),
            "sum": round(float(row["sum_value"] or 0) / scale, 2),
            "source_gap": bool(row["source_gap"]),
            "observed_at": row["last_observed_at"].isoformat(),
        }
        for row in reversed(rows)
    ]


_PERSISTED_COLLECTION_MAX_AGE = 600


def query_timeseries_snapshot(
    names: list[str],
    period: str = "minute",
    minutes: int = 60,
    *,
    persisted: bool = False,
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """Batch dashboard windows, declaring each series' source and watermark."""
    canonical = list(dict.fromkeys(get_metric_definition(name).name for name in names))
    source = (
        "redis_v2"
        if period == "minute" and not persisted and start is None and end is None
        else "postgresql_v2"
    )
    requested_start, requested_end = start, end
    now = time.time()
    data = {name: [] for name in canonical}
    status = {
        name: {
            "availability": "empty",
            "reason": "no_observations",
            "source": source,
            "observed_at": None,
            "age_seconds": None,
            "window_minutes": minutes,
        }
        for name in canonical
    }
    if not canonical:
        return {"data": data, "status": status}
    try:
        if (
            period not in {"minute", "hour", "day"}
            or not 1 <= minutes <= 11520
            or len(canonical) > 32
        ):
            raise ValueError("Invalid metric window")
        if source == "redis_v2":
            if len(canonical) * minutes > 12000:
                raise metric_buckets.MetricReadBudgetError(
                    "Metric point budget exceeded"
                )
            rows = _recent_buckets({name: (name, minutes) for name in canonical})
            from crate.db.cache_runtime import get_redis

            coverage = metric_buckets.live_coverage(get_redis())
            for name in canonical:
                scale = get_metric_definition(name).scale
                by_minute = {}
                for row in rows[name]:
                    by_minute.setdefault(int(row["minute"]), []).append(row)
                data[name] = [
                    {
                        "timestamp": datetime.fromtimestamp(
                            minute, tz=timezone.utc
                        ).isoformat(),
                        **_aggregate_rows(group, scale),
                        "source_gap": False,
                        "observed_at": datetime.fromtimestamp(
                            max(float(row["last_at"]) for row in group), tz=timezone.utc
                        ).isoformat(),
                    }
                    for minute, group in sorted(by_minute.items())
                ]
                summary = _summary_provenance(rows[name], scale, minutes, now)
                status[name].update(
                    {
                        key: summary[key]
                        for key in (
                            "availability",
                            "reason",
                            "observed_at",
                            "age_seconds",
                        )
                    }
                )
                reason = _live_coverage_reason(coverage, minutes)
                if reason:
                    status[name].update(availability="partial", reason=reason)
        else:
            from crate.db.queries.metric_minutes import (
                query_metric_minute_series_snapshot,
            )

            current_minute = datetime.fromtimestamp(_minute_bucket(), tz=timezone.utc)
            window_end = (
                datetime.fromisoformat(requested_end)
                if requested_end
                else current_minute
            )
            window_end = min(
                window_end.replace(tzinfo=window_end.tzinfo or timezone.utc).astimezone(
                    timezone.utc
                ),
                current_minute,
            ).replace(second=0, microsecond=0)
            window_start = (
                datetime.fromisoformat(requested_start)
                if requested_start
                else window_end - timedelta(minutes=minutes - 1)
            )
            window_start = max(
                window_start.replace(
                    tzinfo=window_start.tzinfo or timezone.utc
                ).astimezone(timezone.utc),
                current_minute - timedelta(days=8),
            ).replace(second=0, microsecond=0)
            if window_start > window_end:
                raise ValueError("Invalid metric bounds")
            minutes = int((window_end - window_start).total_seconds() // 60) + 1
            for value in status.values():
                value["window_minutes"] = minutes
            limit = (
                minutes
                if period == "minute"
                else math.ceil(minutes / (60 if period == "hour" else 1440)) + 1
            )
            history = query_metric_minute_series_snapshot(
                canonical,
                period=period,
                start=window_start,
                end=window_end,
                limit=limit,
            )
            rows, collection = history["series"], history["collection"]
            window_gap = any(
                datetime.fromisoformat(begin) <= window_end
                and datetime.fromisoformat(finish) >= window_start
                for begin, finish in collection.get("gaps", [])
            )
            checked_at = (
                datetime.fromisoformat(collection["checked_at"])
                if collection.get("checked_at")
                else None
            )
            collection_stale = (
                checked_at is not None
                and checked_at < window_end + timedelta(minutes=1)
                and now - checked_at.timestamp() > _PERSISTED_COLLECTION_MAX_AGE
            )
            for name in canonical:
                data[name] = _historical_points(
                    rows[name], get_metric_definition(name).scale
                )
                if data[name]:
                    observed = max(point["observed_at"] for point in data[name])
                    gap = window_gap or any(point["source_gap"] for point in data[name])
                    status[name].update(
                        availability="partial" if gap else "available",
                        reason="source_gap" if gap else None,
                        observed_at=observed,
                        age_seconds=max(
                            0, now - datetime.fromisoformat(observed).timestamp()
                        ),
                    )
                elif window_gap:
                    status[name].update(availability="partial", reason="source_gap")
                if collection_stale:
                    status[name].update(availability="stale", reason="collection_stale")
    except Exception as error:
        reason = (
            "read_budget"
            if isinstance(error, metric_buckets.MetricReadBudgetError)
            else "metric_source_unavailable"
        )
        log.debug("Failed to read metric timeseries snapshot", exc_info=True)
        data = {name: [] for name in canonical}
        for value in status.values():
            value.update(availability="unavailable", reason=reason)
    return {"data": data, "status": status}


def query_historical(
    name: str,
    period: str = "hour",
    start: str | None = None,
    end: str | None = None,
    limit: int = 168,
    *,
    tags: dict | None = None,
) -> list[dict]:
    """Read v2 minutes only; unverified legacy rollups are never combined."""
    try:
        from crate.db.queries.metric_minutes import query_metric_minute_snapshots

        scale = get_metric_definition(name).scale
        rows = query_metric_minute_snapshots(
            name=name, period=period, start=start, end=end, limit=limit, tags=tags
        )
        return _historical_points(rows, scale)
    except Exception:
        log.debug("Failed to query historical metrics", exc_info=True)
        return []
